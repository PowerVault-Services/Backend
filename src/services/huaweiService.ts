import axios, { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import { createLogger } from '../config/logger';
import { isBudgetExhausted, recordBudgetRequest } from './huaweiBudget';

const log = createLogger('huawei');


type RetryRequestConfig = InternalAxiosRequestConfig & {
  _retry?: boolean;
  _retryCount?: number;
};

type HuaweiCreds = {
  userName: string;
  systemCode: string;
  label?: string; 
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const jitter = (ms: number) => ms + Math.floor(Math.random() * 350);

export type HuaweiStation = {
  plantCode?: string;
  stationCode?: string;
  plantName?: string;
  stationName?: string;
  capacity?: number;
  plantAddress?: string;
  stationAddr?: string;
  latitude?: string | number;
  longitude?: string | number;
};

export type HuaweiDevice = {
  id: number | string; 
  devDn?: string;
  devName?: string;
  esnCode?: string;
  stationCode?: string;
  devTypeId?: number;
  model?: string;
  invType?: string;
  softwareVersion?: string;
  latitude?: number;
  longitude?: number;
};

class HuaweiService {
  private client: AxiosInstance;
  private token: string | null = null;
  private loginPromise: Promise<void> | null = null;
  private userName: string;
  private systemCode: string;
  private label: string;
  private aliasLabels = new Set<string>();

  private stats = {
    login: 0,
    stations: 0,
    getStationRealKpi: 0,
    getDevList: 0,
    getDevRealKpi: 0,
    totalRequests: 0,
  };

  private baseUrl = process.env.HUAWEI_API_BASE_URL || 'https://intl.fusionsolar.huawei.com';

  // -------- Throttle / Cooldown (global) --------
  private throttleChain: Promise<void> = Promise.resolve();

  // เริ่มต้นสูงไว้ก่อน (tenant บางที่ limit ต่ำมาก)
  private minIntervalMs = Number(process.env.HUAWEI_MIN_INTERVAL_MS ?? 6500);
  private baseMinIntervalMs = Number(process.env.HUAWEI_MIN_INTERVAL_MS ?? 6500);

  // ถ้าโดน 407/403/429 ให้พักทั้งระบบจนถึงเวลานี้
  private cooldownUntil = 0;

  // login rate guard (เอกสาร: จำกัด 5 ครั้ง / 10 นาที)
  private loginAttempts: number[] = []; // timestamps (ms)
  private lastRequestAt: number | null = null;
  private lastResponseAt: number | null = null;
  private lastErrorAt: number | null = null;
  private lastRateLimitAt: number | null = null;
  private lastDecayCheckAt = 0;

  // -------- Circuit Breaker --------
  private circuitBreakerFailures = 0;
  private circuitBreakerOpenUntil = 0;
  private readonly CIRCUIT_BREAKER_THRESHOLD = Math.max(3, Number(process.env.HUAWEI_CIRCUIT_BREAKER_THRESHOLD ?? 5));
  private readonly CIRCUIT_BREAKER_RESET_MS = Math.max(30_000, Number(process.env.HUAWEI_CIRCUIT_BREAKER_RESET_MS ?? 120_000));

  constructor(creds?: HuaweiCreds) {
    const envUser = process.env.HUAWEI_USER;
    const envPass = process.env.HUAWEI_PASSWORD;

    this.userName = creds?.userName ?? envUser ?? '';
    this.systemCode = creds?.systemCode ?? envPass ?? '';
    this.label = creds?.label ?? creds?.userName ?? 'HUAWEI';
    this.aliasLabels.add(this.label);

    this.client = axios.create({
      baseURL: this.baseUrl,
      headers: { 'Content-Type': 'application/json' },
      timeout: 30_000,
    });

    // Global throttle + cooldown + circuit breaker + แนบ token
    this.client.interceptors.request.use(async (config) => {
      // Circuit breaker: reject immediately if open
      if (this.isCircuitOpen()) {
        throw new Error(`[${this.label}] Circuit breaker is OPEN. Skipping request to ${config.url}`);
      }

      const now = Date.now();
      if (now < this.cooldownUntil) {
        const wait = this.cooldownUntil - now;
        log.warn('Huawei cooldown active', { label: this.label, waitMs: wait });
        await sleep(jitter(wait));
      }

      // Decay minIntervalMs back toward base when no 407 for 10+ minutes
      const DECAY_QUIET_MS = 10 * 60_000;
      const DECAY_CHECK_INTERVAL_MS = 60_000;
      if (
        now - this.lastDecayCheckAt > DECAY_CHECK_INTERVAL_MS &&
        this.minIntervalMs > this.baseMinIntervalMs &&
        (this.lastRateLimitAt == null || now - this.lastRateLimitAt > DECAY_QUIET_MS)
      ) {
        this.lastDecayCheckAt = now;
        const newMin = Math.max(this.baseMinIntervalMs, Math.floor(this.minIntervalMs * 0.85));
        if (newMin !== this.minIntervalMs) {
          log.debug('Decaying minIntervalMs', { label: this.label, from: this.minIntervalMs, to: newMin });
          this.minIntervalMs = newMin;
        }
      }

      // Global budget gate: wait if budget exhausted
      while (isBudgetExhausted()) {
        log.warn('Global request budget exhausted, waiting', { label: this.label, waitMs: 5000 });
        await sleep(5_000);
      }

      const waitMyTurn = this.throttleChain.then(async () => {
        await sleep(jitter(this.minIntervalMs));
      });

      this.throttleChain = waitMyTurn.catch(() => undefined);
      await waitMyTurn;

      recordBudgetRequest();

      if (this.token) {
        config.headers = config.headers ?? {};
        config.headers['xsrf-token'] = this.token;
      }

      this.lastRequestAt = Date.now();

      log.debug('API request', { label: this.label, method: (config.method ?? 'GET').toUpperCase(), url: config.url ?? '' });
      return config;
    });

    // Response error handler (HTTP error cases)
    this.client.interceptors.response.use(
      (r) => {
        this.lastResponseAt = Date.now();
        this.recordCircuitSuccess();
        return r;
      },
      async (error: AxiosError) => {
        this.lastErrorAt = Date.now();
        this.recordCircuitFailure();
        const originalRequest = error.config as RetryRequestConfig | undefined;
        if (!originalRequest) return Promise.reject(error);

        const status = error.response?.status;
        const failCode = (error.response?.data as any)?.failCode;

        const isAuthError = status === 401 || failCode === 305;
        const isRateLimit = status === 407 || failCode === 407;

        // ---- token หมดอายุ -> relogin แล้ว retry 1 ครั้ง ----
        if (isAuthError && !originalRequest._retry) {
          originalRequest._retry = true;
          log.info('Huawei token expired, relogin and retry', { label: this.label });
          await this.ensureLoggedIn({ force: true });
          return this.client(originalRequest);
        }

        // ---- rate limit (HTTP 407) ----
        if (isRateLimit) {
          originalRequest._retryCount = (originalRequest._retryCount ?? 0) + 1;

          const retryAfterHeader = (error.response?.headers as any)?.['retry-after'];
          const retryAfterMs =
            retryAfterHeader != null && !Number.isNaN(Number(retryAfterHeader)) ? Number(retryAfterHeader) * 1000 : null;

          const baseDelay = Math.min(300_000, 30_000 * originalRequest._retryCount);
          const delay = retryAfterMs != null ? Math.max(baseDelay, retryAfterMs) : baseDelay;

          this.cooldownUntil = Date.now() + delay;
          this.lastRateLimitAt = Date.now();

          const newMin = Math.min(15_000, Math.floor(this.minIntervalMs * 1.25));
          if (newMin !== this.minIntervalMs) {
            log.warn('Increasing minIntervalMs', { label: this.label, from: this.minIntervalMs, to: newMin });
            this.minIntervalMs = newMin;
          }

          if (originalRequest._retryCount <= 3) {
            log.warn('Huawei rate limit (407), cooling down then retry', { label: this.label, delayMs: delay, retryCount: originalRequest._retryCount });
            await sleep(jitter(delay));
            return this.client(originalRequest);
          }
        }

        return Promise.reject(error);
      }
    );
  }
  public registerAlias(label?: string | null) {
    const normalized = String(label ?? '').trim();
    if (!normalized) return;
    this.aliasLabels.add(normalized);
  }

  public getAccountKey() {
    return `${this.baseUrl}::${this.userName}`;
  }

  public getLabels() {
    return Array.from(this.aliasLabels);
  }

  public getStats() {
    return { ...this.stats };
  }

  public getCooldownRemainingMs() {
    return Math.max(0, this.cooldownUntil - Date.now());
  }

  public isCoolingDown() {
    return this.getCooldownRemainingMs() > 0;
  }

  public getRuntimeStatus() {
    return {
      accountKey: this.getAccountKey(),
      labels: this.getLabels(),
      hasToken: !!this.token,
      minIntervalMs: this.minIntervalMs,
      baseMinIntervalMs: this.baseMinIntervalMs,
      cooldownRemainingMs: this.getCooldownRemainingMs(),
      circuitBreakerOpen: this.isCircuitOpen(),
      circuitBreakerFailures: this.circuitBreakerFailures,
      lastRequestAt: this.lastRequestAt,
      lastResponseAt: this.lastResponseAt,
      lastErrorAt: this.lastErrorAt,
      lastRateLimitAt: this.lastRateLimitAt,
      stats: this.getStats(),
    };
  }

  public isCircuitOpen(): boolean {
    if (this.circuitBreakerFailures < this.CIRCUIT_BREAKER_THRESHOLD) return false;
    if (Date.now() >= this.circuitBreakerOpenUntil) {
      // Half-open: allow one attempt through
      this.circuitBreakerFailures = this.CIRCUIT_BREAKER_THRESHOLD - 1;
      return false;
    }
    return true;
  }

  private recordCircuitSuccess() {
    this.circuitBreakerFailures = 0;
  }

  private recordCircuitFailure() {
    this.circuitBreakerFailures += 1;
    if (this.circuitBreakerFailures >= this.CIRCUIT_BREAKER_THRESHOLD) {
      this.circuitBreakerOpenUntil = Date.now() + this.CIRCUIT_BREAKER_RESET_MS;
      log.warn('Circuit breaker OPEN', { label: this.label, failures: this.circuitBreakerFailures, resetMs: this.CIRCUIT_BREAKER_RESET_MS });
    }
  }

  public resetStats() {
    this.stats = {
      login: 0,
      stations: 0,
      getStationRealKpi: 0,
      getDevList: 0,
      getDevRealKpi: 0,
      totalRequests: 0,
    };
  }

  /**
   * Huawei บาง tenant ตอบ rate limit เป็น HTTP 200 แต่มี { success:false, failCode:407 }
   * -> ต้อง handle จาก body
   */
  public notifyRateLimit(opts?: { kind?: 'personal' | 'system'; delayMs?: number; reason?: string }) {
    const kind = opts?.kind ?? 'personal';
    const delayMs =
      opts?.delayMs ??
      (kind === 'personal'
        ? Number(process.env.HUAWEI_PERSONAL_RATE_LIMIT_PAUSE_MS ?? 300_000)
        : Number(process.env.HUAWEI_SYSTEM_BUSY_PAUSE_MS ?? 60_000));

    this.cooldownUntil = Math.max(this.cooldownUntil, Date.now() + delayMs);
    this.lastRateLimitAt = Date.now();

    const factor = kind === 'personal' ? 1.25 : 1.15;
    const newMin = Math.min(20_000, Math.floor(this.minIntervalMs * factor));
    if (newMin !== this.minIntervalMs) {
      log.warn('Increasing minIntervalMs', { label: this.label, from: this.minIntervalMs, to: newMin });
      this.minIntervalMs = newMin;
    }

    log.debug('notifyRateLimit', { label: this.label, kind, delayMs, reason: opts?.reason ?? '' });
  }

  private handleFailCodeFromBody(endpoint: string, body: any) {
    const failCode = Number(body?.failCode);
    if (!Number.isFinite(failCode)) return;

    if (failCode === 407) {
      this.notifyRateLimit({ kind: 'personal', reason: `${endpoint} failCode=407` });
    }
    if (failCode === 403 || failCode === 429) {
      this.notifyRateLimit({ kind: 'system', delayMs: 60_000, reason: `${endpoint} failCode=${failCode}` });
    }
  }

  private bump(endpoint: keyof HuaweiService['stats'], meta?: any) {
    this.stats.totalRequests += 1;
    this.stats[endpoint] += 1;
    log.debug('Huawei API call', { label: this.label, endpoint: String(endpoint), count: this.stats[endpoint], ...meta });
  }

  public async ensureLoggedIn(opts?: { force?: boolean }) {
    const force = opts?.force ?? false;

    if (force) {
      this.token = null;
      delete this.client.defaults.headers.common['xsrf-token'];
    }
    if (this.token) return;

    if (!this.loginPromise) {
      this.loginPromise = this.login().finally(() => (this.loginPromise = null));
    }
    await this.loginPromise;
  }

  private async login() {
    const userName = this.userName;
    const systemCode = this.systemCode;

    if (!userName || !systemCode) {
      throw new Error('Missing Huawei credentials (userName/systemCode)');
    }

    // login rate guard: ไม่ให้เกิน 5 ครั้ง / 10 นาที (กันโดน lock)
    const now = Date.now();
    this.loginAttempts = this.loginAttempts.filter((t) => now - t < 10 * 60_000);
    if (this.loginAttempts.length >= 5) {
      const oldest = this.loginAttempts[0];
      const wait = Math.max(0, 10 * 60_000 - (now - oldest));
      log.warn('Login rate guard waiting', { label: this.label, waitSec: Math.ceil(wait / 1000) });
      await sleep(jitter(wait));
    }

    this.loginAttempts.push(Date.now());
    this.bump('login');
    log.debug('POST /thirdData/login', { label: this.label });

    const response = await this.client.post('/thirdData/login', { userName, systemCode });

    if (!response.data?.success) {
      log.error('Huawei Login Failed', { label: this.label, data: response.data });
      throw new Error('Huawei Login Failed');
    }

    const token = response.headers['xsrf-token'];
    this.token = Array.isArray(token) ? token[0] : token ?? null;

    if (!this.token) throw new Error('Huawei login succeeded but xsrf-token header missing');

    this.client.defaults.headers.common['xsrf-token'] = this.token;
    log.info('Huawei Login Success', { label: this.label });
    log.debug('xsrf-token acquired', { label: this.label, token: this.token });
  }

  // ---------- Endpoint: stations ----------
  public async stations(params?: { pageNo?: number; pageSize?: number }) {
    await this.ensureLoggedIn();
    const pageNo = params?.pageNo ?? 1;
    const pageSize = params?.pageSize ?? 100;

    this.bump('stations', { pageNo, pageSize });
    log.debug('POST /thirdData/stations', { label: this.label, pageNo, pageSize });

    const res = await this.client.post('/thirdData/stations', { pageNo, pageSize });
    this.handleFailCodeFromBody('stations', res.data);
    return res.data;
  }

  // alias กันโค้ดเก่าเรียก getStations
  public async getStations(params?: { pageNo?: number; pageSize?: number }) {
    return this.stations(params);
  }

  /**
   * Backward-compatible alias for older scripts.
   * Some code in this repo (e.g. src/scripts/seedDevices.ts) calls getStationList().
   */
  public async getStationList(params?: { pageNo?: number; pageSize?: number }) {
    return this.stations(params);
  }

  // ---------- Endpoint: getStationRealKpi ----------
  public async getStationRealKpi(stationCodes: string[] | string) {
    await this.ensureLoggedIn();
    const stationCodesStr = Array.isArray(stationCodes) ? stationCodes.join(',') : stationCodes;

    this.bump('getStationRealKpi', { stationCodes: stationCodesStr });
    log.debug('POST /thirdData/getStationRealKpi', { label: this.label, stationCodes: stationCodesStr });

    const res = await this.client.post('/thirdData/getStationRealKpi', { stationCodes: stationCodesStr });
    this.handleFailCodeFromBody('getStationRealKpi', res.data);
    return res.data;
  }

  // ---------- Endpoint: getDevList ----------
  public async getDevList(stationCodes: string[] | string) {
    await this.ensureLoggedIn();
    const stationCodesStr = Array.isArray(stationCodes) ? stationCodes.join(',') : stationCodes;

    this.bump('getDevList', { stationCodes: stationCodesStr });
    log.debug('POST /thirdData/getDevList', { label: this.label, stationCodes: stationCodesStr });

    const res = await this.client.post('/thirdData/getDevList', { stationCodes: stationCodesStr });
    this.handleFailCodeFromBody('getDevList', res.data);
    return res.data;
  }

  // ---------- Endpoint: getDevRealKpi ----------
  public async getDevRealKpi(params: { devTypeId: number; devIds?: string[] | string; sns?: string[] | string }) {
    await this.ensureLoggedIn();

    const body: any = { devTypeId: params.devTypeId };
    if (params.devIds) body.devIds = Array.isArray(params.devIds) ? params.devIds.join(',') : params.devIds;
    if (params.sns) body.sns = Array.isArray(params.sns) ? params.sns.join(',') : params.sns;

    this.bump('getDevRealKpi', {
      devTypeId: params.devTypeId,
      devCount: Array.isArray(params.devIds) ? params.devIds.length : undefined,
    });
    log.debug('POST /thirdData/getDevRealKpi', { label: this.label, devTypeId: body.devTypeId, devIds: body.devIds ? String(body.devIds).slice(0, 120) : undefined });

    const res = await this.client.post('/thirdData/getDevRealKpi', body);
    this.handleFailCodeFromBody('getDevRealKpi', res.data);
    return res.data;
  }

  /**
   * Generic helper for calling any Huawei Northbound endpoint.
   * Useful for report/PR KPI APIs that are not wrapped yet.
   */
  public async postRaw<T = any>(endpoint: string, body: any): Promise<T> {
    await this.ensureLoggedIn();

    // keep stats consistent even if endpoint isn't listed in stats keys
    this.stats.totalRequests += 1;
    log.debug(`POST ${endpoint}`, { label: this.label, body });

    const res = await this.client.post(endpoint, body);
    this.handleFailCodeFromBody(endpoint, res.data);
    return res.data as T;
  }
  
    // ---------- Endpoint: getAlarmList ----------
  public async getAlarmList(params: {
    stationCodes?: string[] | string;
    sns?: string[] | string;
    beginTime: number;
    endTime: number;
    language?: string;
    levels?: string;  // "1,2,3,4"
    devTypes?: string;
  }) {
    await this.ensureLoggedIn();

    const body: any = {
      beginTime: params.beginTime,
      endTime: params.endTime,
      language: params.language ?? 'en_US',
    };

    if (params.stationCodes) body.stationCodes = Array.isArray(params.stationCodes) ? params.stationCodes.join(',') : params.stationCodes;
    if (params.sns) body.sns = Array.isArray(params.sns) ? params.sns.join(',') : params.sns;
    if (params.levels) body.levels = params.levels;
    if (params.devTypes) body.devTypes = params.devTypes;

    log.debug('POST /thirdData/getAlarmList', { label: this.label, body });

    const res = await this.client.post('/thirdData/getAlarmList', body);
    this.handleFailCodeFromBody('getAlarmList', res.data);
    return res.data;
  }
}



const baseUser = process.env.HUAWEI_USER!;
const basePass = process.env.HUAWEI_PASSWORD!;

const alarmUser = process.env.HUAWEI_ALARM_USER ?? baseUser;
const alarmPass = process.env.HUAWEI_ALARM_PASSWORD ?? basePass;

const ondemandUser = process.env.HUAWEI_ONDEMAND_USER ?? baseUser;
const ondemandPass = process.env.HUAWEI_ONDEMAND_PASSWORD ?? basePass;

const backupUser = process.env.HUAWEI_BACKUP_USER ?? baseUser;
const backupPass = process.env.HUAWEI_BACKUP_PASSWORD ?? basePass;

const extra1User = process.env.HUAWEI_EXTRA1_USER ?? baseUser;
const extra1Pass = process.env.HUAWEI_EXTRA1_PASSWORD ?? basePass;

const huaweiServiceRegistry = new Map<string, HuaweiService>();
const warnedSharedCredentialKeys = new Set<string>();

function makeRegistryKey(creds: HuaweiCreds) {
  const baseUrl = process.env.HUAWEI_API_BASE_URL || 'https://intl.fusionsolar.huawei.com';
  return `${baseUrl}::${creds.userName}::${creds.systemCode}`;
}

function getOrCreateHuaweiService(creds: HuaweiCreds) {
  const key = makeRegistryKey(creds);
  const existing = huaweiServiceRegistry.get(key);
  if (existing) {
    existing.registerAlias(creds.label);
    if (!warnedSharedCredentialKeys.has(key)) {
      warnedSharedCredentialKeys.add(key);
      log.warn('Huawei logical clients share same API account, reusing session', { labels: existing.getLabels(), userName: creds.userName });
    }
    return existing;
  }

  const service = new HuaweiService(creds);
  huaweiServiceRegistry.set(key, service);
  return service;
}

export const huaweiMain = getOrCreateHuaweiService({ userName: baseUser, systemCode: basePass, label: 'MAIN' });
export const huaweiAlarm = getOrCreateHuaweiService({ userName: alarmUser, systemCode: alarmPass, label: 'ALARM' });
export const huaweiOnDemand = getOrCreateHuaweiService({ userName: ondemandUser, systemCode: ondemandPass, label: 'ONDEMAND' });
export const huaweiBackup = getOrCreateHuaweiService({ userName: backupUser, systemCode: backupPass, label: 'BACKUP' });
export const huaweiExtra1 = getOrCreateHuaweiService({ userName: extra1User, systemCode: extra1Pass, label: 'EXTRA1' });

export const huaweiService = huaweiMain;
export { HuaweiService };

export async function callWithFailover<T>(
  primary: HuaweiService,
  backup: HuaweiService,
  fn: (svc: HuaweiService) => Promise<T>,
  opts?: { tag?: string }
): Promise<T> {
  const tag = opts?.tag ? ` ${opts.tag}` : '';
  const hasDistinctBackup = primary !== backup;

  try {
    const r: any = await fn(primary);
    const failCode = Number(r?.failCode);
    const shouldFailover = r?.success === false && (failCode === 407 || failCode === 403 || failCode === 429);
    if (!shouldFailover || !hasDistinctBackup) return r as T;

    log.warn('FAILOVER: primary returned failCode, switching to backup', { tag, failCode });
    return (await fn(backup)) as T;
  } catch (err: any) {
    const status = err?.response?.status;
    const failCode = Number(err?.response?.data?.failCode);
    const isRateLimit = status === 407 || status === 403 || status === 429 || failCode === 407 || failCode === 403 || failCode === 429;
    if (!isRateLimit || !hasDistinctBackup) throw err;

    log.warn('FAILOVER: primary error, switching to backup', { tag, status: status ?? '-', failCode: failCode ?? '-' });
    return (await fn(backup)) as T;
  }
}
