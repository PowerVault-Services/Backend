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

  const years = Array.from(new Set(months.map((item) => item.year))).sort((a, b) => a - b);
  const results = await Promise.allSettled(
    years.map((year) => huaweiOnDemand.postRaw<any>('/thirdData/getKpiStationMonth', {
      stationCodes: site.plantCode,
      collectTime: new Date(year, 11, 31, 12, 0, 0, 0).getTime(),
    })),
  );

  const map = new Map<string, MonthlyActualRow>();
  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    const rows = Array.isArray(result.value?.data) ? result.value.data : [];
    for (const row of rows) {
      const item = mapMonthlyHuaweiRow(row);
      if (!item) continue;
      map.set(item.key, item);
    }
  }
  return map;
}

export async function fetchSiteDailyActualMap(siteId: number, month: MonthRangeItem): Promise<Map<number, DailyActualRow>> {
  const site = await prisma.site.findUnique({ where: { id: siteId }, select: { plantCode: true } });
  if (!site?.plantCode) return new Map();

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

export async function summarizeSitePrRange(siteId: number, startMonth: string, endMonth?: string | null) {
  const months = buildMonthRange(startMonth, endMonth);
  const forecastTemplate = await getForecastTemplate(siteId);
  const actualMap = await fetchSiteMonthlyActualMap(siteId, months);

  const detailRows = months.map((period) => {
    const actual = actualMap.get(period.key) ?? null;
    const forecast = forecastTemplate.get(period.month);
    return {
      month: period.key,
      label: period.label,
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
        importActual: actual?.gridImport ?? null,
        exportActual: actual?.gridExport ?? null,
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
  const gridImportActual = sumNullable(detailRows.map((row) => row.grid.importActual));
  const gridExportActual = sumNullable(detailRows.map((row) => row.grid.exportActual));
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
        importActual: gridImportActual,
        exportActual: gridExportActual,
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
      energyProducedKWh: row?.production ?? null,
      radiationWhM2: row?.irradiation ?? null,
      fromGridKWh: row?.gridImport ?? null,
      feedToGridKWh: row?.gridExport ?? null,
      consumptionKWh: row?.consumption ?? null,
      revenueBaht: row?.revenue ?? null,
      moduleTempC: row?.moduleTempC ?? null,
      downTimeClientHours: row?.downTimeClientHours ?? null,
      fromPvKWh: row?.selfProvide ?? null,
    };
  });

  const productionVsRadiation = monthTable.map((row) => ({
    date: row.date,
    label: String(row.day).padStart(2, '0'),
    energyProducedKWh: row.energyProducedKWh,
    radiationWhM2: row.radiationWhM2,
  }));

  const energyTrend = monthTable.map((row) => ({
    date: row.date,
    label: String(row.day),
    yieldMWh: row.energyProducedKWh != null ? Number((row.energyProducedKWh / 1000).toFixed(3)) : null,
    consumptionMWh: row.consumptionKWh != null ? Number((row.consumptionKWh / 1000).toFixed(3)) : null,
    feedToGridMWh: row.feedToGridKWh != null ? Number((row.feedToGridKWh / 1000).toFixed(3)) : null,
    fromPvMWh: row.fromPvKWh != null ? Number((row.fromPvKWh / 1000).toFixed(3)) : null,
    fromGridMWh: row.fromGridKWh != null ? Number((row.fromGridKWh / 1000).toFixed(3)) : null,
  }));

  const summary = {
    yieldMWh: sumNullable(monthTable.map((row) => row.energyProducedKWh)) != null
      ? Number(((sumNullable(monthTable.map((row) => row.energyProducedKWh)) ?? 0) / 1000).toFixed(3))
      : null,
    consumptionMWh: sumNullable(monthTable.map((row) => row.consumptionKWh)) != null
      ? Number(((sumNullable(monthTable.map((row) => row.consumptionKWh)) ?? 0) / 1000).toFixed(3))
      : null,
    feedToGridMWh: sumNullable(monthTable.map((row) => row.feedToGridKWh)) != null
      ? Number(((sumNullable(monthTable.map((row) => row.feedToGridKWh)) ?? 0) / 1000).toFixed(3))
      : null,
    fromPvMWh: sumNullable(monthTable.map((row) => row.fromPvKWh)) != null
      ? Number(((sumNullable(monthTable.map((row) => row.fromPvKWh)) ?? 0) / 1000).toFixed(3))
      : null,
    fromGridMWh: sumNullable(monthTable.map((row) => row.fromGridKWh)) != null
      ? Number(((sumNullable(monthTable.map((row) => row.fromGridKWh)) ?? 0) / 1000).toFixed(3))
      : null,
    revenueBaht: sumNullable(monthTable.map((row) => row.revenueBaht)),
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
      productionVsRadiation,
      energyTrend,
    },
    summary,
    prReport,
  };
}
