import axios, { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from 'axios';


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

  // ถ้าโดน 407/403/429 ให้พักทั้งระบบจนถึงเวลานี้
  private cooldownUntil = 0;

  // login rate guard (เอกสาร: จำกัด 5 ครั้ง / 10 นาที)
  private loginAttempts: number[] = []; // timestamps (ms)

  /**
   * โหมด log (เปิดด้วย HUAWEI_API_DEBUG=1)
   */
  private debug = String(process.env.HUAWEI_API_DEBUG ?? '').trim() === '1';

  constructor(creds?: HuaweiCreds) {
    const envUser = process.env.HUAWEI_USER;
    const envPass = process.env.HUAWEI_PASSWORD;

    this.userName = creds?.userName ?? envUser ?? '';
    this.systemCode = creds?.systemCode ?? envPass ?? '';
    this.label = creds?.label ?? creds?.userName ?? 'HUAWEI';

    this.client = axios.create({
      baseURL: this.baseUrl,
      headers: { 'Content-Type': 'application/json' },
      timeout: 30_000,
    });

    // Global throttle + cooldown + แนบ token
    this.client.interceptors.request.use(async (config) => {
      const now = Date.now();
      if (now < this.cooldownUntil) {
        const wait = this.cooldownUntil - now;
        console.warn(`🧊 [${this.label}] Huawei cooldown active. Waiting ${wait}ms...`);
        await sleep(jitter(wait));
      }

      const waitMyTurn = this.throttleChain.then(async () => {
        await sleep(jitter(this.minIntervalMs));
      });

      this.throttleChain = waitMyTurn.catch(() => undefined);
      await waitMyTurn;

      if (this.token) {
        config.headers = config.headers ?? {};
        config.headers['xsrf-token'] = this.token;
      }
      
      if (this.debug) {
        const method = (config.method ?? 'GET').toUpperCase();
        console.log(`➡️  [${this.label}] ${method} ${config.url ?? ''}`);
      }
      return config;
    });

    // Response error handler (HTTP error cases)
    this.client.interceptors.response.use(
      (r) => r,
      async (error: AxiosError) => {
        const originalRequest = error.config as RetryRequestConfig | undefined;
        if (!originalRequest) return Promise.reject(error);

        const status = error.response?.status;
        const failCode = (error.response?.data as any)?.failCode;

        const isAuthError = status === 401 || failCode === 305;
        const isRateLimit = status === 407 || failCode === 407;

        // ---- token หมดอายุ -> relogin แล้ว retry 1 ครั้ง ----
        if (isAuthError && !originalRequest._retry) {
          originalRequest._retry = true;
          console.log(`🔄 [${this.label}] Huawei token expired. Relogin and retry...`);
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

          const newMin = Math.min(15_000, Math.floor(this.minIntervalMs * 1.25));
          if (newMin !== this.minIntervalMs) {
            console.warn(`🐢 [${this.label}] Increasing Huawei minIntervalMs: ${this.minIntervalMs} -> ${newMin}`);
            this.minIntervalMs = newMin;
          }

          if (originalRequest._retryCount <= 8) {
            console.warn(`[${this.label}] Huawei rate limit (407). Cooling down ${delay}ms then retry...`);
            await sleep(jitter(delay));
            return this.client(originalRequest);
          }
        }

        return Promise.reject(error);
      }
    );
  }
  public getStats() {
    return { ...this.stats };
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

    const factor = kind === 'personal' ? 1.25 : 1.15;
    const newMin = Math.min(20_000, Math.floor(this.minIntervalMs * factor));
    if (newMin !== this.minIntervalMs) {
      console.warn(`🐢 Increasing Huawei minIntervalMs: ${this.minIntervalMs} -> ${newMin}`);
      this.minIntervalMs = newMin;
    }

    if (this.debug) {
      console.warn(`🧊 [${this.label}] notifyRateLimit kind=${kind} delayMs=${delayMs} reason=${opts?.reason ?? ''}`);
    }
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
    if (this.debug) {
      const extra = meta ? ` ${JSON.stringify(meta)}` : '';
      console.log(`📡 [${this.label}] Huawei API ${String(endpoint)} #${this.stats[endpoint]}${extra}`);
    }
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
      console.warn(`🧊 Login rate guard: waiting ${Math.ceil(wait / 1000)}s before next login attempt`);
      await sleep(jitter(wait));
    }

    this.loginAttempts.push(Date.now());
    this.bump('login');
    if (this.debug) console.log('📡 POST /thirdData/login');

    const response = await this.client.post('/thirdData/login', { userName, systemCode });

    if (!response.data?.success) {
      console.error('❌ Huawei Login Failed:', response.data);
      throw new Error('Huawei Login Failed');
    }

    const token = response.headers['xsrf-token'];
    this.token = Array.isArray(token) ? token[0] : token ?? null;

    if (!this.token) throw new Error('Huawei login succeeded but xsrf-token header missing');

    this.client.defaults.headers.common['xsrf-token'] = this.token;
    console.log(`✅ [${this.label}] Huawei Login Success`);
    console.log(`[${this.label}] xsrf-token:`, this.token);
  }

  // ---------- Endpoint: stations ----------
  public async stations(params?: { pageNo?: number; pageSize?: number }) {
    await this.ensureLoggedIn();
    const pageNo = params?.pageNo ?? 1;
    const pageSize = params?.pageSize ?? 100;

    this.bump('stations', { pageNo, pageSize });
    if (this.debug) console.log(`📡 POST /thirdData/stations`, { pageNo, pageSize });

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
    if (this.debug) console.log(`📡 POST /thirdData/getStationRealKpi`, { stationCodes: stationCodesStr });

    const res = await this.client.post('/thirdData/getStationRealKpi', { stationCodes: stationCodesStr });
    this.handleFailCodeFromBody('getStationRealKpi', res.data);
    return res.data;
  }

  // ---------- Endpoint: getDevList ----------
  public async getDevList(stationCodes: string[] | string) {
    await this.ensureLoggedIn();
    const stationCodesStr = Array.isArray(stationCodes) ? stationCodes.join(',') : stationCodes;

    this.bump('getDevList', { stationCodes: stationCodesStr });
    if (this.debug) console.log(`📡 POST /thirdData/getDevList`, { stationCodes: stationCodesStr });

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
    if (this.debug)
      console.log(`📡 POST /thirdData/getDevRealKpi`, {
        ...body,
        devIds: body.devIds ? String(body.devIds).slice(0, 120) : undefined,
      });

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
    if (this.debug) console.log(`📡 [${this.label}] POST ${endpoint}`, body);

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

    if (this.debug) console.log(`📡 [${this.label}] POST /thirdData/getAlarmList`, body);

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

export const huaweiMain = new HuaweiService({ userName: baseUser, systemCode: basePass, label: 'MAIN' });
export const huaweiAlarm = new HuaweiService({ userName: alarmUser, systemCode: alarmPass, label: 'ALARM' });
export const huaweiOnDemand = new HuaweiService({ userName: ondemandUser, systemCode: ondemandPass, label: 'ONDEMAND' });
export const huaweiBackup = new HuaweiService({ userName: backupUser, systemCode: backupPass, label: 'BACKUP' });

export const huaweiService = huaweiMain;
export { HuaweiService };

export async function callWithFailover<T>(
  primary: HuaweiService,
  backup: HuaweiService,
  fn: (svc: HuaweiService) => Promise<T>,
  opts?: { tag?: string }
): Promise<T> {
  const tag = opts?.tag ? ` ${opts.tag}` : '';
  try {
    const r: any = await fn(primary);
    const failCode = Number(r?.failCode);
    const shouldFailover = r?.success === false && (failCode === 407 || failCode === 403 || failCode === 429);
    if (!shouldFailover) return r as T;

    console.warn(`⚠️ [FAILOVER]${tag} primary returned failCode=${failCode}. Switching to BACKUP...`);
    return (await fn(backup)) as T;
  } catch (err: any) {
    const status = err?.response?.status;
    const failCode = Number(err?.response?.data?.failCode);
    const isRateLimit = status === 407 || status === 403 || status === 429 || failCode === 407 || failCode === 403 || failCode === 429;
    if (!isRateLimit) throw err;

    console.warn(`⚠️ [FAILOVER]${tag} primary error status=${status ?? '-'} failCode=${failCode ?? '-'} -> BACKUP`);
    return (await fn(backup)) as T;
  }
}
