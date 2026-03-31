import prisma from '../config/prisma';
import { huaweiOnDemand } from './huaweiService';

type ForecastTemplateRow = {
  month: number;
  globalKwhM2: number | null;
  eGridKwh: number | null;
  prRatio: number | null;
};

type MonthlyActualRow = {
  year: number;
  month: number;
  key: string;
  collectTime: number;
  irradiation: number | null;
  production: number | null;
  pr: number | null;
  gridImport: number | null;
  gridExport: number | null;
  consumption: number | null;
  revenue: number | null;
  selfProvide: number | null;
};

type DailyActualRow = MonthlyActualRow & {
  day: number;
  date: string;
  moduleTempC: number | null;
  downTimeClientHours: number | null;
};

export type MonthRangeItem = {
  year: number;
  month: number;
  key: string;
  start: Date;
  endExclusive: Date;
  label: string;
};

function asNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

export function calcVarPct(actual: number | null, forecast: number | null): number | null {
  if (actual == null || forecast == null || forecast === 0) return null;
  return Number((((actual - forecast) / forecast) * 100).toFixed(3));
}

function sumNullable(values: Array<number | null>): number | null {
  const nums = values.filter((v): v is number => v != null && Number.isFinite(v));
  if (!nums.length) return null;
  return Number(nums.reduce((acc, v) => acc + v, 0).toFixed(3));
}

function weightedAverage(pairs: Array<{ value: number | null; weight: number | null }>): number | null {
  let numerator = 0;
  let denominator = 0;
  for (const pair of pairs) {
    if (pair.value == null || pair.weight == null || !Number.isFinite(pair.value) || !Number.isFinite(pair.weight)) continue;
    numerator += pair.value * pair.weight;
    denominator += pair.weight;
  }
  if (!denominator) return null;
  return Number((numerator / denominator).toFixed(3));
}

export function parseMonthInput(value: string | null | undefined): MonthRangeItem | null {
  if (!value) return null;
  const match = /^([0-9]{4})-([0-9]{2})$/.exec(String(value).trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return null;
  const start = new Date(year, month - 1, 1, 0, 0, 0, 0);
  const endExclusive = new Date(year, month, 1, 0, 0, 0, 0);
  return {
    year,
    month,
    key: `${year}-${String(month).padStart(2, '0')}`,
    start,
    endExclusive,
    label: `${String(month).padStart(2, '0')}/${year}`,
  };
}

export function buildMonthRange(startMonth: string, endMonth?: string | null): MonthRangeItem[] {
  const start = parseMonthInput(startMonth);
  const end = parseMonthInput(endMonth ?? startMonth);
  if (!start || !end) throw Object.assign(new Error('Invalid month range (expected YYYY-MM)'), { statusCode: 400 });
  if (start.start.getTime() > end.start.getTime()) {
    throw Object.assign(new Error('startMonth must be before or equal to endMonth'), { statusCode: 400 });
  }

  const out: MonthRangeItem[] = [];
  let cursor = new Date(start.start);
  while (cursor.getTime() <= end.start.getTime()) {
    const year = cursor.getFullYear();
    const month = cursor.getMonth() + 1;
    out.push({
      year,
      month,
      key: `${year}-${String(month).padStart(2, '0')}`,
      start: new Date(year, month - 1, 1, 0, 0, 0, 0),
      endExclusive: new Date(year, month, 1, 0, 0, 0, 0),
      label: `${String(month).padStart(2, '0')}/${year}`,
    });
    cursor = new Date(year, month, 1, 0, 0, 0, 0);
  }
  return out;
}

async function getForecastTemplate(siteId: number): Promise<Map<number, ForecastTemplateRow>> {
  const rows = await prisma.siteForecastMonthly.findMany({
    where: { siteId },
    select: { month: true, globalKwhM2: true, eGridKwh: true, prRatio: true },
    orderBy: { month: 'asc' },
  });

  return new Map(rows.map((row) => [row.month, row]));
}

function mapMonthlyHuaweiRow(row: any): MonthlyActualRow | null {
  const collectTime = asNumber(row?.collectTime);
  if (collectTime == null) return null;
  const data = (row?.dataItemMap ?? {}) as Record<string, unknown>;
  const date = new Date(collectTime);
  const year = date.getFullYear();
  const month = date.getMonth() + 1;

  return {
    year,
    month,
    key: `${year}-${String(month).padStart(2, '0')}`,
    collectTime,
    irradiation: asNumber(data.radiation_intensity),
    production: asNumber(data.PVYield) ?? asNumber(data.inverter_power) ?? asNumber(data.inverterYield),
    pr: asNumber(data.performance_ratio),
    gridImport: asNumber(data.buyPower),
    gridExport: asNumber(data.ongrid_power),
    consumption: asNumber(data.use_power),
    revenue: asNumber(data.power_profit),
    selfProvide: asNumber(data.selfProvide) ?? asNumber(data.selfUsePower),
  };
}

function mapDailyHuaweiRow(row: any): DailyActualRow | null {
  const base = mapMonthlyHuaweiRow(row);
  if (!base) return null;
  const data = (row?.dataItemMap ?? {}) as Record<string, unknown>;
  const dateObj = new Date(base.collectTime);
  return {
    ...base,
    day: dateObj.getDate(),
    date: dateObj.toISOString().slice(0, 10),
    moduleTempC: asNumber(data.module_temp) ?? asNumber(data.temperature),
    downTimeClientHours: asNumber(data.down_time_client) ?? asNumber(data.downTimeClient),
  };
}

export async function fetchSiteMonthlyActualMap(siteId: number, months: MonthRangeItem[]): Promise<Map<string, MonthlyActualRow>> {
  if (!months.length) return new Map();
  const site = await prisma.site.findUnique({ where: { id: siteId }, select: { plantCode: true } });
  if (!site?.plantCode) return new Map();

  const bulk = await fetchBulkMonthlyActualMap([site.plantCode], months);
  return bulk.get(site.plantCode) ?? new Map();
}

/**
 * Fetch monthly KPI for multiple stations in batched Huawei calls.
 * Returns Map<plantCode, Map<monthKey, MonthlyActualRow>>.
 * Huawei supports comma-separated stationCodes — this avoids 1-request-per-site.
 */
export async function fetchBulkMonthlyActualMap(
  plantCodes: string[],
  months: MonthRangeItem[],
): Promise<Map<string, Map<string, MonthlyActualRow>>> {
  const result = new Map<string, Map<string, MonthlyActualRow>>();
  if (!plantCodes.length || !months.length) return result;

  const years = Array.from(new Set(months.map((item) => item.year))).sort((a, b) => a - b);
  const CHUNK_SIZE = 100;

  for (let i = 0; i < plantCodes.length; i += CHUNK_SIZE) {
    const chunk = plantCodes.slice(i, i + CHUNK_SIZE);
    const stationCodesStr = chunk.join(',');

    const apiResults = await Promise.allSettled(
      years.map((year) => huaweiOnDemand.postRaw<any>('/thirdData/getKpiStationMonth', {
        stationCodes: stationCodesStr,
        collectTime: new Date(year, 11, 31, 12, 0, 0, 0).getTime(),
      })),
    );

    for (const res of apiResults) {
      if (res.status !== 'fulfilled') continue;
      const rows = Array.isArray(res.value?.data) ? res.value.data : [];
      for (const row of rows) {
        const stationCode = String(row?.stationCode ?? '').trim();
        if (!stationCode) continue;
        const item = mapMonthlyHuaweiRow(row);
        if (!item) continue;

        let siteMap = result.get(stationCode);
        if (!siteMap) {
          siteMap = new Map();
          result.set(stationCode, siteMap);
        }
        siteMap.set(item.key, item);
      }
    }
  }

  return result;
}

// -------- DB Cache for Monthly Actuals --------

/**
 * Load cached monthly actuals from DB for given sites & months.
 * Returns same shape as fetchBulkMonthlyActualMap: Map<plantCode, Map<monthKey, MonthlyActualRow>>.
 */
export async function loadCachedMonthlyActuals(
  plantCodes: string[],
  months: MonthRangeItem[],
): Promise<Map<string, Map<string, MonthlyActualRow>>> {
  const result = new Map<string, Map<string, MonthlyActualRow>>();
  if (!plantCodes.length || !months.length) return result;

  const yearMonthPairs = months.map((m) => ({ year: m.year, month: m.month }));
  const years = Array.from(new Set(yearMonthPairs.map((p) => p.year)));

  const rows = await prisma.siteMonthlyActual.findMany({
    where: {
      plantCode: { in: plantCodes },
      year: { in: years },
    },
    select: {
      plantCode: true, year: true, month: true, key: true,
      collectTime: true, irradiation: true, production: true, pr: true,
      gridImport: true, gridExport: true, consumption: true, revenue: true, selfProvide: true,
    },
  });

  const monthKeys = new Set(months.map((m) => m.key));
  for (const row of rows) {
    if (!monthKeys.has(row.key)) continue;
    let siteMap = result.get(row.plantCode);
    if (!siteMap) {
      siteMap = new Map();
      result.set(row.plantCode, siteMap);
    }
    siteMap.set(row.key, {
      year: row.year,
      month: row.month,
      key: row.key,
      collectTime: row.collectTime ?? 0,
      irradiation: row.irradiation,
      production: row.production,
      pr: row.pr,
      gridImport: row.gridImport,
      gridExport: row.gridExport,
      consumption: row.consumption,
      revenue: row.revenue,
      selfProvide: row.selfProvide,
    });
  }
  return result;
}

/**
 * Fetch from Huawei API and upsert results into the DB cache.
 * Uses the same bulk logic but persists to SiteMonthlyActual.
 */
export async function refreshAndCacheMonthlyActuals(
  plantCodes: string[],
  months: MonthRangeItem[],
  siteIdByPlantCode: Map<string, number>,
): Promise<void> {
  if (!plantCodes.length || !months.length) return;

  try {
    const bulkData = await fetchBulkMonthlyActualMap(plantCodes, months);

    const upserts: Promise<any>[] = [];
    for (const [plantCode, monthMap] of bulkData) {
      const siteId = siteIdByPlantCode.get(plantCode);
      if (!siteId) continue;
      for (const [_key, actual] of monthMap) {
        upserts.push(
          prisma.siteMonthlyActual.upsert({
            where: { siteId_year_month: { siteId, year: actual.year, month: actual.month } },
            update: {
              plantCode,
              key: actual.key,
              collectTime: actual.collectTime,
              irradiation: actual.irradiation,
              production: actual.production,
              pr: actual.pr,
              gridImport: actual.gridImport,
              gridExport: actual.gridExport,
              consumption: actual.consumption,
              revenue: actual.revenue,
              selfProvide: actual.selfProvide,
            },
            create: {
              siteId,
              plantCode,
              year: actual.year,
              month: actual.month,
              key: actual.key,
              collectTime: actual.collectTime,
              irradiation: actual.irradiation,
              production: actual.production,
              pr: actual.pr,
              gridImport: actual.gridImport,
              gridExport: actual.gridExport,
              consumption: actual.consumption,
              revenue: actual.revenue,
              selfProvide: actual.selfProvide,
            },
          }),
        );
      }
    }

    await Promise.all(upserts);
    console.log(`✅ [PR Cache] Refreshed ${upserts.length} monthly actuals from Huawei`);
  } catch (err) {
    console.error('❌ [PR Cache] Failed to refresh monthly actuals:', err);
  }
}

export async function fetchSiteDailyActualMap(siteId: number, month: MonthRangeItem): Promise<Map<number, DailyActualRow>> {
  const site = await prisma.site.findUnique({ where: { id: siteId }, select: { plantCode: true } });
  if (!site?.plantCode) return new Map();

  // DB-first: try SiteDailyKpi
  try {
    const startDate = new Date(month.year, month.month - 1, 1, 0, 0, 0, 0);
    const endDate = new Date(month.year, month.month, 1, 0, 0, 0, 0);
    const dbRows: any[] = await (prisma as any).siteDailyKpi.findMany({
      where: { siteId, date: { gte: startDate, lt: endDate } },
      orderBy: { date: 'asc' },
    });

    if (dbRows.length > 0) {
      const map = new Map<number, DailyActualRow>();
      for (const r of dbRows) {
        const dateObj = new Date(r.date);
        const day = dateObj.getDate();
        map.set(day, {
          year: month.year,
          month: month.month,
          key: month.key,
          collectTime: r.collectTime ?? dateObj.getTime(),
          irradiation: r.irradiation,
          production: r.production,
          pr: r.pr,
          gridImport: r.gridImport,
          gridExport: r.gridExport,
          consumption: r.consumption,
          revenue: r.revenue,
          selfProvide: r.selfProvide,
          day,
          date: dateObj.toISOString().slice(0, 10),
          moduleTempC: r.moduleTempC,
          downTimeClientHours: r.downTimeClientHours,
        });
      }
      return map;
    }
  } catch (err: any) {
    console.warn(`⚠️ [PR] DB read error for daily KPI siteId=${siteId}:`, err?.message ?? err);
  }

  // Fallback: Huawei API (skip non-Huawei plantCodes)
  const isHuaweiPlant = site.plantCode.startsWith('NE=');
  if (!isHuaweiPlant) return new Map();
  try {
    const raw = await huaweiOnDemand.postRaw<any>('/thirdData/getKpiStationDay', {
      stationCodes: site.plantCode,
      collectTime: new Date(month.year, month.month - 1, 15, 12, 0, 0, 0).getTime(),
    });

    const rows = Array.isArray(raw?.data) ? raw.data : [];
    const map = new Map<number, DailyActualRow>();
    for (const row of rows) {
      const item = mapDailyHuaweiRow(row);
      if (!item) continue;
      map.set(item.day, item);
    }
    return map;
  } catch {
    return new Map();
  }
}

export async function summarizeSitePrRange(
  siteId: number,
  startMonth: string,
  endMonth?: string | null,
  preloadedActuals?: Map<string, MonthlyActualRow>,
) {
  const months = buildMonthRange(startMonth, endMonth);
  const forecastTemplate = await getForecastTemplate(siteId);
  const actualMap = preloadedActuals ?? await fetchSiteMonthlyActualMap(siteId, months);

  const detailRows = months.map((period) => {
    const actual = actualMap.get(period.key) ?? null;
    const forecast = forecastTemplate.get(period.month);
    return {
      month: period.key,
      monthName: period.label,
      irradiation: {
        actual: actual?.irradiation ?? null,
        forecast: forecast?.globalKwhM2 ?? null,
        varPct: calcVarPct(actual?.irradiation ?? null, forecast?.globalKwhM2 ?? null),
      },
      production: {
        actual: actual?.production ?? null,
        forecast: forecast?.eGridKwh ?? null,
        varPct: calcVarPct(actual?.production ?? null, forecast?.eGridKwh ?? null),
      },
      pr: {
        actual: actual?.pr ?? null,
        forecast: forecast?.prRatio ?? null,
        varPct: calcVarPct(actual?.pr ?? null, forecast?.prRatio ?? null),
      },
      grid: {
        actual: actual?.gridImport ?? null,
        forecast: null,
        varPct: null,
      },
      consumption: actual?.consumption ?? null,
      revenue: actual?.revenue ?? null,
    };
  });

  const irradiationActual = sumNullable(detailRows.map((row) => row.irradiation.actual));
  const irradiationForecast = sumNullable(detailRows.map((row) => row.irradiation.forecast));
  const productionActual = sumNullable(detailRows.map((row) => row.production.actual));
  const productionForecast = sumNullable(detailRows.map((row) => row.production.forecast));
  const gridActual = sumNullable(detailRows.map((row) => row.grid.actual));
  const consumptionActual = sumNullable(detailRows.map((row) => row.consumption));
  const revenueActual = sumNullable(detailRows.map((row) => row.revenue));

  const prActual = weightedAverage(
    detailRows.map((row) => ({ value: row.pr.actual, weight: row.production.actual })),
  );
  const prForecast = weightedAverage(
    detailRows.map((row) => ({ value: row.pr.forecast, weight: row.production.forecast })),
  );

  return {
    months,
    rows: detailRows,
    totals: {
      irradiation: {
        actual: irradiationActual,
        forecast: irradiationForecast,
        varPct: calcVarPct(irradiationActual, irradiationForecast),
      },
      production: {
        actual: productionActual,
        forecast: productionForecast,
        varPct: calcVarPct(productionActual, productionForecast),
      },
      pr: {
        actual: prActual,
        forecast: prForecast,
        varPct: calcVarPct(prActual, prForecast),
      },
      grid: {
        actual: gridActual,
      },
      consumptionActual,
      revenueActual,
    },
  };
}

export async function buildEnergyYieldPayload(siteId: number, monthValue: string) {
  const month = parseMonthInput(monthValue);
  if (!month) {
    throw Object.assign(new Error('Invalid month (expected YYYY-MM)'), { statusCode: 400 });
  }

  const site = await prisma.site.findUnique({ where: { id: siteId }, select: { id: true, name: true, plantCode: true, capacityKWp: true } });
  if (!site) {
    throw Object.assign(new Error('Site not found'), { statusCode: 404 });
  }

  const dailyMap = await fetchSiteDailyActualMap(siteId, month);
  const daysInMonth = new Date(month.year, month.month, 0).getDate();
  const monthTable = Array.from({ length: daysInMonth }, (_, index) => {
    const day = index + 1;
    const row = dailyMap.get(day) ?? null;
    return {
      day,
      date: `${month.key}-${String(day).padStart(2, '0')}`,
      production: row?.production ?? null,
      irradiation: row?.irradiation ?? null,
      fromGrid: row?.gridImport ?? null,
      feedToGrid: row?.gridExport ?? null,
      consumption: row?.consumption ?? null,
      revenue: row?.revenue ?? null,
      moduleTemp: row?.moduleTempC ?? null,
      downTime: row?.downTimeClientHours ?? null,
      fromPV: row?.selfProvide ?? null,
    };
  });

  // charts.production — Frontend EnergyProductionChart expects { date, production, irradiation }
  const production = monthTable.map((row) => ({
    date: row.date,
    label: String(row.day).padStart(2, '0'),
    production: row.production,
    irradiation: row.irradiation,
  }));

  // charts.trend — Frontend TrendChart (period="month") expects { day, pv, grid }
  const trend = monthTable.map((row) => ({
    date: row.date,
    day: String(row.day),
    pv: row.production != null ? Number((row.production / 1000).toFixed(3)) : null,
    grid: row.fromGrid != null ? Number((row.fromGrid / 1000).toFixed(3)) : null,
    consumption: row.consumption != null ? Number((row.consumption / 1000).toFixed(3)) : null,
    feedToGrid: row.feedToGrid != null ? Number((row.feedToGrid / 1000).toFixed(3)) : null,
    fromPV: row.fromPV != null ? Number((row.fromPV / 1000).toFixed(3)) : null,
  }));

  // summary — Frontend EnergySummary expects { yield, consumption, fromPV, fromGrid, feedToGrid }
  const toMWh = (vals: (number | null)[]) => {
    const s = sumNullable(vals);
    return s != null ? Number((s / 1000).toFixed(3)) : null;
  };
  const summary = {
    yield: toMWh(monthTable.map((row) => row.production)),
    consumption: toMWh(monthTable.map((row) => row.consumption)),
    feedToGrid: toMWh(monthTable.map((row) => row.feedToGrid)),
    fromPV: toMWh(monthTable.map((row) => row.fromPV)),
    fromGrid: toMWh(monthTable.map((row) => row.fromGrid)),
    revenue: sumNullable(monthTable.map((row) => row.revenue)),
  };

  const prReport = await summarizeSitePrRange(siteId, `${month.year}-01`, `${month.year}-12`);

  return {
    site: {
      siteId: site.id,
      plantCode: site.plantCode,
      plantName: site.name,
      systemSizeKWp: site.capacityKWp,
    },
    month: month.key,
    monthTable,
    charts: {
      production,
      trend,
    },
    summary,
    prReport,
  };
}
