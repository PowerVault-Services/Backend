import { pickOnDemandClient } from './huaweiPool';

const DEFAULT_TTL_MS = Number(process.env.HUAWEI_KPI_CACHE_TTL_MS ?? 5 * 60 * 1000);
const ENDPOINT_TTL_MS: Record<string, number> = {
  '/thirdData/getKpiStationHour': Number(process.env.HUAWEI_KPI_HOUR_CACHE_TTL_MS ?? 60 * 1000),
  '/thirdData/getKpiStationDay': Number(process.env.HUAWEI_KPI_DAY_CACHE_TTL_MS ?? DEFAULT_TTL_MS),
  '/thirdData/getKpiStationMonth': Number(process.env.HUAWEI_KPI_MONTH_CACHE_TTL_MS ?? DEFAULT_TTL_MS),
  '/thirdData/getKpiStationYear': Number(process.env.HUAWEI_KPI_YEAR_CACHE_TTL_MS ?? DEFAULT_TTL_MS),
};

const DEBUG = String(process.env.HUAWEI_KPI_CACHE_DEBUG ?? '').trim() === '1';

type CacheEntry<T> = {
  expiresAt: number;
  value: T;
};

const cache = new Map<string, CacheEntry<any>>();
const inflight = new Map<string, Promise<any>>();

const stats = {
  hits: 0,
  misses: 0,
  stores: 0,
  coalesced: 0,
};

function normalizeStationCodes(stationCodes: string[] | string): string {
  return Array.isArray(stationCodes) ? stationCodes.join(',') : stationCodes;
}

function getTtl(endpoint: string): number {
  const ttl = ENDPOINT_TTL_MS[endpoint] ?? DEFAULT_TTL_MS;
  return Number.isFinite(ttl) && ttl > 0 ? ttl : DEFAULT_TTL_MS;
}

function makeKey(endpoint: string, stationCodes: string[] | string, collectTime: number): string {
  return `${endpoint}::${normalizeStationCodes(stationCodes)}::${collectTime}`;
}

export function getPlantKpiCacheStats() {
  return {
    ...stats,
    entries: cache.size,
    inflight: inflight.size,
  };
}

export async function getCachedPlantKpi<T = any>(params: {
  endpoint: string;
  stationCodes: string[] | string;
  collectTime: number;
  bypassCache?: boolean;
}): Promise<T> {
  const { endpoint, stationCodes, collectTime, bypassCache = false } = params;
  const key = makeKey(endpoint, stationCodes, collectTime);
  const now = Date.now();

  if (!bypassCache) {
    const cached = cache.get(key);
    if (cached && cached.expiresAt > now) {
      stats.hits += 1;
      if (DEBUG) {
        console.log(`[KPI-CACHE] hit ${endpoint} ${normalizeStationCodes(stationCodes)} @ ${collectTime}`);
      }
      return cached.value as T;
    }

    const pending = inflight.get(key);
    if (pending) {
      stats.coalesced += 1;
      if (DEBUG) {
        console.log(`[KPI-CACHE] coalesced ${endpoint} ${normalizeStationCodes(stationCodes)} @ ${collectTime}`);
      }
      return pending as Promise<T>;
    }
  }

  stats.misses += 1;
  const client = pickOnDemandClient();
  const task = (async () => {
    const value = await client.postRaw<T>(endpoint, {
      stationCodes: normalizeStationCodes(stationCodes),
      collectTime,
    });

    const failCode = Number((value as any)?.failCode);
    const isSuccess = failCode === 0 || (value as any)?.success === true;
    if (isSuccess) {
      cache.set(key, {
        expiresAt: Date.now() + getTtl(endpoint),
        value,
      });
      stats.stores += 1;
      if (DEBUG) {
        console.log(`[KPI-CACHE] store ${endpoint} ${normalizeStationCodes(stationCodes)} @ ${collectTime}`);
      }
    }

    return value;
  })();

  if (!bypassCache) {
    inflight.set(key, task);
  }

  try {
    return await task;
  } finally {
    inflight.delete(key);
  }
}

export function clearPlantKpiCacheForStation(plantCode: string) {
  for (const key of cache.keys()) {
    if (key.includes(`::${plantCode}::`) || key.includes(`,${plantCode}::`) || key.includes(`::${plantCode},`)) {
      cache.delete(key);
    }
  }
}
