"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.HuaweiService = exports.huaweiService = exports.huaweiBackup = exports.huaweiOnDemand = exports.huaweiAlarm = exports.huaweiMain = void 0;
exports.callWithFailover = callWithFailover;
const axios_1 = __importDefault(require("axios"));
const logger_1 = require("../config/logger");
const huaweiBudget_1 = require("./huaweiBudget");
const log = (0, logger_1.createLogger)('huawei');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const jitter = (ms) => ms + Math.floor(Math.random() * 350);
class HuaweiService {
    constructor(creds) {
        this.token = null;
        this.loginPromise = null;
        this.aliasLabels = new Set();
        this.stats = {
            login: 0,
            stations: 0,
            getStationRealKpi: 0,
            getDevList: 0,
            getDevRealKpi: 0,
            totalRequests: 0,
        };
        this.baseUrl = process.env.HUAWEI_API_BASE_URL || 'https://intl.fusionsolar.huawei.com';
        // -------- Throttle / Cooldown (global) --------
        this.throttleChain = Promise.resolve();
        // เริ่มต้นสูงไว้ก่อน (tenant บางที่ limit ต่ำมาก)
        this.minIntervalMs = Number(process.env.HUAWEI_MIN_INTERVAL_MS ?? 6500);
        this.baseMinIntervalMs = Number(process.env.HUAWEI_MIN_INTERVAL_MS ?? 6500);
        // ถ้าโดน 407/403/429 ให้พักทั้งระบบจนถึงเวลานี้
        this.cooldownUntil = 0;
        // login rate guard (เอกสาร: จำกัด 5 ครั้ง / 10 นาที)
        this.loginAttempts = []; // timestamps (ms)
        this.lastRequestAt = null;
        this.lastResponseAt = null;
        this.lastErrorAt = null;
        this.lastRateLimitAt = null;
        this.lastDecayCheckAt = 0;
        // -------- Circuit Breaker --------
        this.circuitBreakerFailures = 0;
        this.circuitBreakerOpenUntil = 0;
        this.CIRCUIT_BREAKER_THRESHOLD = Math.max(3, Number(process.env.HUAWEI_CIRCUIT_BREAKER_THRESHOLD ?? 5));
        this.CIRCUIT_BREAKER_RESET_MS = Math.max(30000, Number(process.env.HUAWEI_CIRCUIT_BREAKER_RESET_MS ?? 120000));
        const envUser = process.env.HUAWEI_USER;
        const envPass = process.env.HUAWEI_PASSWORD;
        this.userName = creds?.userName ?? envUser ?? '';
        this.systemCode = creds?.systemCode ?? envPass ?? '';
        this.label = creds?.label ?? creds?.userName ?? 'HUAWEI';
        this.aliasLabels.add(this.label);
        this.client = axios_1.default.create({
            baseURL: this.baseUrl,
            headers: { 'Content-Type': 'application/json' },
            timeout: 30000,
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
            const DECAY_QUIET_MS = 10 * 60000;
            const DECAY_CHECK_INTERVAL_MS = 60000;
            if (now - this.lastDecayCheckAt > DECAY_CHECK_INTERVAL_MS &&
                this.minIntervalMs > this.baseMinIntervalMs &&
                (this.lastRateLimitAt == null || now - this.lastRateLimitAt > DECAY_QUIET_MS)) {
                this.lastDecayCheckAt = now;
                const newMin = Math.max(this.baseMinIntervalMs, Math.floor(this.minIntervalMs * 0.85));
                if (newMin !== this.minIntervalMs) {
                    log.debug('Decaying minIntervalMs', { label: this.label, from: this.minIntervalMs, to: newMin });
                    this.minIntervalMs = newMin;
                }
            }
            // Global budget gate: wait if budget exhausted
            while ((0, huaweiBudget_1.isBudgetExhausted)()) {
                log.warn('Global request budget exhausted, waiting', { label: this.label, waitMs: 5000 });
                await sleep(5000);
            }
            const waitMyTurn = this.throttleChain.then(async () => {
                await sleep(jitter(this.minIntervalMs));
            });
            this.throttleChain = waitMyTurn.catch(() => undefined);
            await waitMyTurn;
            (0, huaweiBudget_1.recordBudgetRequest)();
            if (this.token) {
                config.headers = config.headers ?? {};
                config.headers['xsrf-token'] = this.token;
            }
            this.lastRequestAt = Date.now();
            log.debug('API request', { label: this.label, method: (config.method ?? 'GET').toUpperCase(), url: config.url ?? '' });
            return config;
        });
        // Response error handler (HTTP error cases)
        this.client.interceptors.response.use((r) => {
            this.lastResponseAt = Date.now();
            this.recordCircuitSuccess();
            return r;
        }, async (error) => {
            this.lastErrorAt = Date.now();
            this.recordCircuitFailure();
            const originalRequest = error.config;
            if (!originalRequest)
                return Promise.reject(error);
            const status = error.response?.status;
            const failCode = error.response?.data?.failCode;
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
                const retryAfterHeader = error.response?.headers?.['retry-after'];
                const retryAfterMs = retryAfterHeader != null && !Number.isNaN(Number(retryAfterHeader)) ? Number(retryAfterHeader) * 1000 : null;
                const baseDelay = Math.min(300000, 30000 * originalRequest._retryCount);
                const delay = retryAfterMs != null ? Math.max(baseDelay, retryAfterMs) : baseDelay;
                this.cooldownUntil = Date.now() + delay;
                this.lastRateLimitAt = Date.now();
                const newMin = Math.min(15000, Math.floor(this.minIntervalMs * 1.25));
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
        });
    }
    registerAlias(label) {
        const normalized = String(label ?? '').trim();
        if (!normalized)
            return;
        this.aliasLabels.add(normalized);
    }
    getAccountKey() {
        return `${this.baseUrl}::${this.userName}`;
    }
    getLabels() {
        return Array.from(this.aliasLabels);
    }
    getStats() {
        return { ...this.stats };
    }
    getCooldownRemainingMs() {
        return Math.max(0, this.cooldownUntil - Date.now());
    }
    isCoolingDown() {
        return this.getCooldownRemainingMs() > 0;
    }
    getRuntimeStatus() {
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
    isCircuitOpen() {
        if (this.circuitBreakerFailures < this.CIRCUIT_BREAKER_THRESHOLD)
            return false;
        if (Date.now() >= this.circuitBreakerOpenUntil) {
            // Half-open: allow one attempt through
            this.circuitBreakerFailures = this.CIRCUIT_BREAKER_THRESHOLD - 1;
            return false;
        }
        return true;
    }
    recordCircuitSuccess() {
        this.circuitBreakerFailures = 0;
    }
    recordCircuitFailure() {
        this.circuitBreakerFailures += 1;
        if (this.circuitBreakerFailures >= this.CIRCUIT_BREAKER_THRESHOLD) {
            this.circuitBreakerOpenUntil = Date.now() + this.CIRCUIT_BREAKER_RESET_MS;
            log.warn('Circuit breaker OPEN', { label: this.label, failures: this.circuitBreakerFailures, resetMs: this.CIRCUIT_BREAKER_RESET_MS });
        }
    }
    resetStats() {
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
    notifyRateLimit(opts) {
        const kind = opts?.kind ?? 'personal';
        const delayMs = opts?.delayMs ??
            (kind === 'personal'
                ? Number(process.env.HUAWEI_PERSONAL_RATE_LIMIT_PAUSE_MS ?? 300000)
                : Number(process.env.HUAWEI_SYSTEM_BUSY_PAUSE_MS ?? 60000));
        this.cooldownUntil = Math.max(this.cooldownUntil, Date.now() + delayMs);
        this.lastRateLimitAt = Date.now();
        const factor = kind === 'personal' ? 1.25 : 1.15;
        const newMin = Math.min(20000, Math.floor(this.minIntervalMs * factor));
        if (newMin !== this.minIntervalMs) {
            log.warn('Increasing minIntervalMs', { label: this.label, from: this.minIntervalMs, to: newMin });
            this.minIntervalMs = newMin;
        }
        log.debug('notifyRateLimit', { label: this.label, kind, delayMs, reason: opts?.reason ?? '' });
    }
    handleFailCodeFromBody(endpoint, body) {
        const failCode = Number(body?.failCode);
        if (!Number.isFinite(failCode))
            return;
        if (failCode === 407) {
            this.notifyRateLimit({ kind: 'personal', reason: `${endpoint} failCode=407` });
        }
        if (failCode === 403 || failCode === 429) {
            this.notifyRateLimit({ kind: 'system', delayMs: 60000, reason: `${endpoint} failCode=${failCode}` });
        }
    }
    bump(endpoint, meta) {
        this.stats.totalRequests += 1;
        this.stats[endpoint] += 1;
        log.debug('Huawei API call', { label: this.label, endpoint: String(endpoint), count: this.stats[endpoint], ...meta });
    }
    async ensureLoggedIn(opts) {
        const force = opts?.force ?? false;
        if (force) {
            this.token = null;
            delete this.client.defaults.headers.common['xsrf-token'];
        }
        if (this.token)
            return;
        if (!this.loginPromise) {
            this.loginPromise = this.login().finally(() => (this.loginPromise = null));
        }
        await this.loginPromise;
    }
    async login() {
        const userName = this.userName;
        const systemCode = this.systemCode;
        if (!userName || !systemCode) {
            throw new Error('Missing Huawei credentials (userName/systemCode)');
        }
        // login rate guard: ไม่ให้เกิน 5 ครั้ง / 10 นาที (กันโดน lock)
        const now = Date.now();
        this.loginAttempts = this.loginAttempts.filter((t) => now - t < 10 * 60000);
        if (this.loginAttempts.length >= 5) {
            const oldest = this.loginAttempts[0];
            const wait = Math.max(0, 10 * 60000 - (now - oldest));
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
        if (!this.token)
            throw new Error('Huawei login succeeded but xsrf-token header missing');
        this.client.defaults.headers.common['xsrf-token'] = this.token;
        log.info('Huawei Login Success', { label: this.label });
        log.debug('xsrf-token acquired', { label: this.label, token: this.token });
    }
    // ---------- Endpoint: stations ----------
    async stations(params) {
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
    async getStations(params) {
        return this.stations(params);
    }
    /**
     * Backward-compatible alias for older scripts.
     * Some code in this repo (e.g. src/scripts/seedDevices.ts) calls getStationList().
     */
    async getStationList(params) {
        return this.stations(params);
    }
    // ---------- Endpoint: getStationRealKpi ----------
    async getStationRealKpi(stationCodes) {
        await this.ensureLoggedIn();
        const stationCodesStr = Array.isArray(stationCodes) ? stationCodes.join(',') : stationCodes;
        this.bump('getStationRealKpi', { stationCodes: stationCodesStr });
        log.debug('POST /thirdData/getStationRealKpi', { label: this.label, stationCodes: stationCodesStr });
        const res = await this.client.post('/thirdData/getStationRealKpi', { stationCodes: stationCodesStr });
        this.handleFailCodeFromBody('getStationRealKpi', res.data);
        return res.data;
    }
    // ---------- Endpoint: getDevList ----------
    async getDevList(stationCodes) {
        await this.ensureLoggedIn();
        const stationCodesStr = Array.isArray(stationCodes) ? stationCodes.join(',') : stationCodes;
        this.bump('getDevList', { stationCodes: stationCodesStr });
        log.debug('POST /thirdData/getDevList', { label: this.label, stationCodes: stationCodesStr });
        const res = await this.client.post('/thirdData/getDevList', { stationCodes: stationCodesStr });
        this.handleFailCodeFromBody('getDevList', res.data);
        return res.data;
    }
    // ---------- Endpoint: getDevRealKpi ----------
    async getDevRealKpi(params) {
        await this.ensureLoggedIn();
        const body = { devTypeId: params.devTypeId };
        if (params.devIds)
            body.devIds = Array.isArray(params.devIds) ? params.devIds.join(',') : params.devIds;
        if (params.sns)
            body.sns = Array.isArray(params.sns) ? params.sns.join(',') : params.sns;
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
    async postRaw(endpoint, body) {
        await this.ensureLoggedIn();
        // keep stats consistent even if endpoint isn't listed in stats keys
        this.stats.totalRequests += 1;
        log.debug(`POST ${endpoint}`, { label: this.label, body });
        const res = await this.client.post(endpoint, body);
        this.handleFailCodeFromBody(endpoint, res.data);
        return res.data;
    }
    // ---------- Endpoint: getAlarmList ----------
    async getAlarmList(params) {
        await this.ensureLoggedIn();
        const body = {
            beginTime: params.beginTime,
            endTime: params.endTime,
            language: params.language ?? 'en_US',
        };
        if (params.stationCodes)
            body.stationCodes = Array.isArray(params.stationCodes) ? params.stationCodes.join(',') : params.stationCodes;
        if (params.sns)
            body.sns = Array.isArray(params.sns) ? params.sns.join(',') : params.sns;
        if (params.levels)
            body.levels = params.levels;
        if (params.devTypes)
            body.devTypes = params.devTypes;
        log.debug('POST /thirdData/getAlarmList', { label: this.label, body });
        const res = await this.client.post('/thirdData/getAlarmList', body);
        this.handleFailCodeFromBody('getAlarmList', res.data);
        return res.data;
    }
}
exports.HuaweiService = HuaweiService;
const baseUser = process.env.HUAWEI_USER;
const basePass = process.env.HUAWEI_PASSWORD;
const alarmUser = process.env.HUAWEI_ALARM_USER ?? baseUser;
const alarmPass = process.env.HUAWEI_ALARM_PASSWORD ?? basePass;
const ondemandUser = process.env.HUAWEI_ONDEMAND_USER ?? baseUser;
const ondemandPass = process.env.HUAWEI_ONDEMAND_PASSWORD ?? basePass;
const backupUser = process.env.HUAWEI_BACKUP_USER ?? baseUser;
const backupPass = process.env.HUAWEI_BACKUP_PASSWORD ?? basePass;
const huaweiServiceRegistry = new Map();
const warnedSharedCredentialKeys = new Set();
function makeRegistryKey(creds) {
    const baseUrl = process.env.HUAWEI_API_BASE_URL || 'https://intl.fusionsolar.huawei.com';
    return `${baseUrl}::${creds.userName}::${creds.systemCode}`;
}
function getOrCreateHuaweiService(creds) {
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
exports.huaweiMain = getOrCreateHuaweiService({ userName: baseUser, systemCode: basePass, label: 'MAIN' });
exports.huaweiAlarm = getOrCreateHuaweiService({ userName: alarmUser, systemCode: alarmPass, label: 'ALARM' });
exports.huaweiOnDemand = getOrCreateHuaweiService({ userName: ondemandUser, systemCode: ondemandPass, label: 'ONDEMAND' });
exports.huaweiBackup = getOrCreateHuaweiService({ userName: backupUser, systemCode: backupPass, label: 'BACKUP' });
exports.huaweiService = exports.huaweiMain;
async function callWithFailover(primary, backup, fn, opts) {
    const tag = opts?.tag ? ` ${opts.tag}` : '';
    const hasDistinctBackup = primary !== backup;
    try {
        const r = await fn(primary);
        const failCode = Number(r?.failCode);
        const shouldFailover = r?.success === false && (failCode === 407 || failCode === 403 || failCode === 429);
        if (!shouldFailover || !hasDistinctBackup)
            return r;
        log.warn('FAILOVER: primary returned failCode, switching to backup', { tag, failCode });
        return (await fn(backup));
    }
    catch (err) {
        const status = err?.response?.status;
        const failCode = Number(err?.response?.data?.failCode);
        const isRateLimit = status === 407 || status === 403 || status === 429 || failCode === 407 || failCode === 403 || failCode === 429;
        if (!isRateLimit || !hasDistinctBackup)
            throw err;
        log.warn('FAILOVER: primary error, switching to backup', { tag, status: status ?? '-', failCode: failCode ?? '-' });
        return (await fn(backup));
    }
}
