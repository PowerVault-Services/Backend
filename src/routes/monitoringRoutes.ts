	import { Router } from 'express';
	import prisma from '../config/prisma';
	import { huaweiOnDemand } from '../services/huaweiService';
	import { getFleetSyncCoverageSnapshot, syncPlantOnDemand } from '../services/syncService';
	import { getEnergyManagementSeries, getMonitoringHomeRealtime } from '../services/monitoringHomeService';
import { buildMonthRange, summarizeSitePrRange, loadCachedMonthlyActuals, refreshAndCacheMonthlyActuals } from '../services/siteAnalyticsService';
import { getAlarmReconciliationSnapshot } from '../services/alarmSyncService';
import { getCronStatus } from '../jobs/cron';

	const router = Router();


	router.get('/sync/status', async (_req, res) => {
		return res.json({ ok: true, data: getCronStatus() });
	});

	router.get('/sync/coverage', async (_req, res) => {
		const snapshot = await getFleetSyncCoverageSnapshot();
		return res.json({ ok: true, data: snapshot });
	});

	router.get('/sync/alarm-reconciliation', async (_req, res) => {
		const snapshot = await getAlarmReconciliationSnapshot();
		return res.json({ ok: true, data: snapshot });
	});

	router.get('/pr/sites', async (req, res) => {
		const now = new Date();
		const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

		const startMonth = String(req.query.startMonth ?? '').trim() || currentMonth;
		const endMonth = String(req.query.endMonth ?? '').trim() || startMonth;
		const q = String(req.query.q ?? '').trim();
		const requestedIds = String(req.query.siteIds ?? '').trim();

		let months: ReturnType<typeof buildMonthRange> = [];
		try {
			months = buildMonthRange(startMonth, endMonth);
		} catch (e: any) {
			return res.status(e?.statusCode ?? 400).json({ error: e?.message ?? 'Invalid month range' });
		}

		const siteIdList = requestedIds
			? requestedIds.split(',').map((v) => Number(v.trim())).filter((v) => Number.isFinite(v))
			: [];

		const sites = await prisma.site.findMany({
			where: {
				...(siteIdList.length ? { id: { in: siteIdList } } : {}),
				...(q
					? {
						OR: [
							{ name: { contains: q, mode: 'insensitive' } },
							{ plantCode: { contains: q, mode: 'insensitive' } },
						],
					}
					: {}),
			},
			select: { id: true, name: true, plantCode: true, capacityKWp: true },
			orderBy: { name: 'asc' },
			take: 200,
		});

		// 1) Load cached actuals from DB (instant)
		const plantCodes = sites.map((s) => s.plantCode).filter((c): c is string => !!c);
		const cachedActuals = await loadCachedMonthlyActuals(plantCodes, months);

		const rows = await Promise.all(
			sites.map(async (site) => {
				const siteActuals = (site.plantCode ? cachedActuals.get(site.plantCode) : undefined) ?? new Map();
				const summary = await summarizeSitePrRange(site.id, startMonth, endMonth, siteActuals);
				return {
					siteId: site.id,
					plantName: site.name,
					plantCode: site.plantCode,
					systemSizeKWp: site.capacityKWp,
					period: { startMonth, endMonth },
					totals: summary.totals,
					months: summary.rows,
				};
			}),
		);

		// 2) Respond immediately with DB-cached data
		res.json({ data: { months, list: rows } });

		// 3) Background: refresh cache from Huawei API for next request
		const siteIdByPlantCode = new Map(sites.filter((s) => s.plantCode).map((s) => [s.plantCode!, s.id]));
		refreshAndCacheMonthlyActuals(plantCodes, months, siteIdByPlantCode).catch(() => {});
	});

	router.get('/pr/export', async (req, res) => {
		const startMonth = String(req.query.startMonth ?? '').trim();
		const endMonth = String(req.query.endMonth ?? req.query.startMonth ?? '').trim();
		const requestedIds = String(req.query.siteIds ?? '').trim();
		if (!startMonth) return res.status(400).json({ error: 'startMonth is required (YYYY-MM)' });
		if (!requestedIds) return res.status(400).json({ error: 'siteIds is required' });

		const siteIds = requestedIds.split(',').map((v) => Number(v.trim())).filter((v) => Number.isFinite(v));
		const sites = await prisma.site.findMany({
			where: { id: { in: siteIds } },
			select: { id: true, name: true, plantCode: true },
			orderBy: { name: 'asc' },
		});

		const esc = (value: any) => {
			const str = value == null ? '' : String(value);
			return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
		};

		const lines = [
			[
				'plantName',
				'plantCode',
				'periodStart',
				'periodEnd',
				'irradiationActual',
				'irradiationForecast',
				'irradiationVarPct',
				'productionActual',
				'productionForecast',
				'productionVarPct',
				'prActual',
				'prForecast',
				'prVarPct',
			].join(','),
		];

		for (const site of sites) {
			const summary = await summarizeSitePrRange(site.id, startMonth, endMonth || startMonth);
			lines.push([
				site.name,
				site.plantCode,
				startMonth,
				endMonth || startMonth,
				summary.totals.irradiation.actual,
				summary.totals.irradiation.forecast,
				summary.totals.irradiation.varPct,
				summary.totals.production.actual,
				summary.totals.production.forecast,
				summary.totals.production.varPct,
				summary.totals.pr.actual,
				summary.totals.pr.forecast,
				summary.totals.pr.varPct,
			].map(esc).join(','));
		}

		res.setHeader('Content-Type', 'text/csv; charset=utf-8');
		res.setHeader('Content-Disposition', `attachment; filename="pr-summary-${startMonth}-${endMonth || startMonth}.csv"`);
		return res.send(lines.join('\n'));
	});

	router.get('/pr', async (req, res) => {
		const siteId = Number(req.query.siteId);
		const granularity = String(req.query.granularity ?? 'month');
		const year = req.query.year != null ? Number(req.query.year) : null;
		const endDateIso = req.query.endDate != null ? String(req.query.endDate) : null;
		const collectTimeFromQuery = req.query.collectTime != null ? Number(req.query.collectTime) : null;

		if (!Number.isFinite(siteId)) return res.status(400).json({ error: 'Invalid siteId' });
		if (!['month', 'day', 'year'].includes(granularity)) return res.status(400).json({ error: 'Invalid granularity' });

		const site = await prisma.site.findUnique({ where: { id: siteId } });
		if (!site) return res.status(404).json({ error: 'Site not found' });
		if (!site.plantCode) return res.status(400).json({ error: 'Site plantCode is missing' });

		const varPct = (actual: number | null, forecast: number | null) => {
			if (actual == null || forecast == null || forecast === 0) return null;
			return ((actual - forecast) / forecast) * 100;
		};

		// ---- Forecast (monthly) from DB ----
		const forecastMonthly = await prisma.siteForecastMonthly.findMany({
			where: { siteId },
			select: { month: true, globalKwhM2: true, eGridKwh: true, prRatio: true },
			orderBy: { month: 'asc' },
		});

		// ---- Actual from Huawei ----
		// Huawei KPI fields for PR page (confirmed from sample responses):
		//  - radiation_intensity (Irradiation)
		//  - PVYield (Production)
		//  - performance_ratio (PR)
		const mapHuaweiItem = (r: any) => {
			const ct = Number(r?.collectTime);
			const map = r?.dataItemMap ?? {};
			const irradiation = Number.isFinite(Number(map.radiation_intensity)) ? Number(map.radiation_intensity) : null;
			const production = Number.isFinite(Number(map.PVYield))
				? Number(map.PVYield)
				: Number.isFinite(Number(map.inverter_power))
					? Number(map.inverter_power)
					: null;
			const pr = Number.isFinite(Number(map.performance_ratio)) ? Number(map.performance_ratio) : null;
			return { ct, irradiation, production, pr };
		};

		let actualByMonth = new Map<number, { irradiation: number | null; production: number | null; pr: number | null }>();
		let actualDaily: Array<{ date: string; irradiation: number | null; production: number | null; pr: number | null }> = [];
		let actualByYear: Array<{ year: number; irradiation: number | null; production: number | null; pr: number | null }> = [];

		// Huawei decides the window by collectTime.
		// Fallback logic so FE can call with either collectTime or year/endDate.
		const resolveCollectTime = (): number => {
			if (collectTimeFromQuery != null && Number.isFinite(collectTimeFromQuery)) return collectTimeFromQuery;

			if (granularity === 'day') {
				const endDate = endDateIso ? new Date(endDateIso) : new Date();
				if (!Number.isNaN(endDate.getTime())) return endDate.getTime();
				return Date.now();
			}

			const y = Number.isFinite(year as any) ? (year as number) : new Date().getFullYear();
			// noon helps avoid timezone boundary weirdness
			return new Date(y, 11, 31, 12, 0, 0, 0).getTime();
		};

		try {
			const collectTime = resolveCollectTime();

			if (granularity === 'month') {
				const raw: any = await huaweiOnDemand.postRaw('/thirdData/getKpiStationMonth', {
					stationCodes: site.plantCode,
					collectTime,
				});

				const rows: any[] = Array.isArray(raw?.data) ? raw.data : [];
				for (const r of rows) {
					const x = mapHuaweiItem(r);
					if (!Number.isFinite(x.ct)) continue;
					const m = new Date(x.ct).getMonth() + 1;
					actualByMonth.set(m, { irradiation: x.irradiation, production: x.production, pr: x.pr });
				}
			}

			if (granularity === 'day') {
				const raw: any = await huaweiOnDemand.postRaw('/thirdData/getKpiStationDay', {
					stationCodes: site.plantCode,
					collectTime,
				});

				const rows: any[] = Array.isArray(raw?.data) ? raw.data : [];
				actualDaily = rows
					.map((r) => {
						const x = mapHuaweiItem(r);
						if (!Number.isFinite(x.ct)) return null;
						const date = new Date(x.ct).toISOString().slice(0, 10);
						return { date, irradiation: x.irradiation, production: x.production, pr: x.pr };
					})
					.filter(Boolean) as any;
			}

			if (granularity === 'year') {
				const raw: any = await huaweiOnDemand.postRaw('/thirdData/getKpiStationYear', {
					stationCodes: site.plantCode,
					collectTime,
				});

				const rows: any[] = Array.isArray(raw?.data) ? raw.data : [];
				actualByYear = rows
					.map((r) => {
						const x = mapHuaweiItem(r);
						if (!Number.isFinite(x.ct)) return null;
						return {
							year: new Date(x.ct).getFullYear(),
							irradiation: x.irradiation,
							production: x.production,
							pr: x.pr,
						};
					})
					.filter(Boolean) as any;
			}
		} catch (e: any) {
			// If Huawei is rate-limited/unavailable, still return forecast so UI works.
			console.warn('⚠️ /monitoring/pr: Huawei fetch failed:', e?.message ?? e);
		}

		if (granularity === 'day') {
			return res.json({
				data: {
					siteId,
					granularity,
					collectTime: resolveCollectTime(),
					rows: actualDaily.map((d) => ({
						date: d.date,
						irradiation: { actual: d.irradiation, forecast: null, varPct: null },
						production: { actual: d.production, forecast: null, varPct: null },
						pr: { actual: d.pr, forecast: null, varPct: null },
					})),
				},
			});
		}

		if (granularity === 'year') {
			// Forecast yearly derived from monthly forecast
			// Explicit accumulator type avoids TS "acc is possibly null" on union arrays
			const sum = (vals: Array<number | null>) => vals.reduce<number>((acc, v) => acc + (v ?? 0), 0);
			const weightedAvg = (pairs: Array<{ v: number | null; w: number | null }>) => {
				let num = 0;
				let den = 0;
				for (const p of pairs) {
					if (p.v == null || p.w == null) continue;
					num += p.v * p.w;
					den += p.w;
				}
				return den === 0 ? null : num / den;
			};

			const forecastIrrYear = sum(forecastMonthly.map((x) => x.globalKwhM2 ?? null));
			const forecastProdYear = sum(forecastMonthly.map((x) => x.eGridKwh ?? null));
			const forecastPrYear = weightedAvg(forecastMonthly.map((x) => ({ v: x.prRatio ?? null, w: x.eGridKwh ?? null })));

			return res.json({
				data: {
					siteId,
					granularity,
					collectTime: resolveCollectTime(),
					forecast: {
						irradiation: forecastIrrYear,
						production: forecastProdYear,
						pr: forecastPrYear,
					},
					rows: actualByYear.map((yRow) => ({
						year: yRow.year,
						irradiation: { actual: yRow.irradiation, forecast: forecastIrrYear, varPct: varPct(yRow.irradiation, forecastIrrYear) },
						production: { actual: yRow.production, forecast: forecastProdYear, varPct: varPct(yRow.production, forecastProdYear) },
						pr: { actual: yRow.pr, forecast: forecastPrYear, varPct: varPct(yRow.pr, forecastPrYear) },
					})),
				},
			});
		}

		const y = Number.isFinite(year as any) ? (year as number) : new Date().getFullYear();
		const rows = Array.from({ length: 12 }, (_, i) => {
			const month = i + 1;
			const f = forecastMonthly.find((x) => x.month === month);
			const a = actualByMonth.get(month) ?? { irradiation: null, production: null, pr: null };

			const forecastIrr = f?.globalKwhM2 ?? null;
			const forecastProd = f?.eGridKwh ?? null;
			const forecastPr = f?.prRatio ?? null;

			return {
				month,
				irradiation: {
					actual: a.irradiation,
					forecast: forecastIrr,
					varPct: varPct(a.irradiation, forecastIrr),
				},
				production: {
					actual: a.production,
					forecast: forecastProd,
					varPct: varPct(a.production, forecastProd),
				},
				pr: {
					actual: a.pr,
					forecast: forecastPr,
					varPct: varPct(a.pr, forecastPr),
				},
			};
		});

		return res.json({ data: { siteId, granularity, year: y, collectTime: resolveCollectTime(), rows } });
	});

  // list sites
  router.get('/sites', async (_req, res) => {
    const sites = (await prisma.site.findMany({
      select: {
        id: true,
        plantCode: true,
        name: true,
        capacityKWp: true,
        address: true,
        latitude: true,
        longitude: true,
        gridConnectionDate: true,
        currentPowerKW: true,
        dayEnergyKWh: true,
        monthEnergyKWh: true,
        totalEnergyKWh: true,
        dayUseEnergyKWh: true,
        dayOnGridEnergyKWh: true,
        plantHealthState: true,
        lastPlantSyncAt: true,
        updatedAt: true,
      },
      orderBy: { name: 'asc' },
    } as any)) as any[];
    res.json({ data: sites });
  });


  router.get('/sites/:siteId/overview', async (req, res) => {
    const siteId = Number(req.params.siteId);
    if (!Number.isFinite(siteId)) return res.status(400).json({ error: 'Invalid siteId' });

    const loadSiteBundle = async () => {
      const site = await prisma.site.findUnique({ where: { id: siteId } });
      if (!site) return null;

      const inverters = (await prisma.inverter.findMany({
        where: { siteId },
        select: {
          id: true,
          name: true,
          model: true,
          serialNumber: true,
          activePower: true,
          lastDailyEnergy: true,
          status: true,
          lastSyncAt: true,
          softwareVersion: true,
        },
        orderBy: { name: 'asc' },
      } as any)) as any[];

      return { site, inverters };
    };

    let bundle = await loadSiteBundle();
    if (!bundle) return res.status(404).json({ error: 'Site not found' });

    let { site, inverters } = bundle;

    const refreshFlag = String(req.query.refresh ?? '').trim().toLowerCase();
    const forceRefresh = refreshFlag === '1' || refreshFlag === 'true' || refreshFlag === 'full';
    const softRefresh = forceRefresh || refreshFlag === 'soft';
    const onDemandStaleMs = Number(process.env.HUAWEI_ONDEMAND_SITE_STALE_MS ?? 5 * 60_000);
    const siteIsStale = !site.lastPlantSyncAt || Date.now() - site.lastPlantSyncAt.getTime() >= onDemandStaleMs;
    const hasRealtime = !!(site.lastPlantSyncAt || site.currentPowerKW != null || site.dayEnergyKWh != null || site.totalEnergyKWh != null);
    const hasInventory = inverters.length > 0;
    const hasLiveInverterData = inverters.some((inv) => !!inv.lastSyncAt);
    const needsHydration = !hasRealtime || !hasInventory || !hasLiveInverterData;

    let hydration: any = {
      attempted: false,
      trigger: null,
      hasRealtime,
      hasInventory,
      hasLiveInverterData,
    };

    if ((forceRefresh || softRefresh || siteIsStale || needsHydration) && site.plantCode) {
      try {
        hydration.attempted = true;
        hydration.trigger = forceRefresh ? 'force' : softRefresh ? 'soft' : siteIsStale ? 'stale' : 'missing_data';

		const syncResult = await (syncPlantOnDemand as any)(site.plantCode, {
		forceSiteRealtime: forceRefresh || !hasRealtime || siteIsStale,
		includeInventory: forceRefresh || !hasInventory,
		includeDeviceDetail: forceRefresh || !hasInventory || !hasLiveInverterData,
		});
        hydration.syncResult = syncResult;

        bundle = await loadSiteBundle();
        if (!bundle) return res.status(404).json({ error: 'Site not found' });
        site = bundle.site;
        inverters = bundle.inverters;
      } catch (e: any) {
        hydration.error = e?.message ?? String(e);
        console.warn('⚠️ /monitoring/sites/:siteId/overview on-demand refresh failed:', e?.message ?? e);
      }
    }

    const last7Days = new Date();
    last7Days.setDate(last7Days.getDate() - 7);

    const energySeries = await prisma.siteDailyEnergy.findMany({
      where: { siteId, date: { gte: last7Days } },
      select: { date: true, energyKWh: true },
      orderBy: { date: 'asc' },
    });

    const finalHasRealtime = !!(site.lastPlantSyncAt || site.currentPowerKW != null || site.dayEnergyKWh != null || site.totalEnergyKWh != null);
    const finalHasInventory = inverters.length > 0;
    const finalHasLiveInverterData = inverters.some((inv) => !!inv.lastSyncAt);

    hydration = {
      ...hydration,
      hasRealtime: finalHasRealtime,
      hasInventory: finalHasInventory,
      hasLiveInverterData: finalHasLiveInverterData,
      ready: finalHasRealtime || finalHasInventory,
    };

    res.json({
      data: {
        site: {
          id: site.id,
          plantCode: site.plantCode,
          name: site.name,
          capacityKWp: site.capacityKWp,
          gridConnectionDate: site.gridConnectionDate,
          currentPowerKW: site.currentPowerKW,
          dayEnergyKWh: site.dayEnergyKWh,
          monthEnergyKWh: site.monthEnergyKWh,
          totalEnergyKWh: site.totalEnergyKWh,
          dayUseEnergyKWh: site.dayUseEnergyKWh,
          dayOnGridEnergyKWh: site.dayOnGridEnergyKWh,
          plantHealthState: site.plantHealthState,
          lastPlantSyncAt: site.lastPlantSyncAt,
        },
        inverters,
        energySeries,
        hydration,
        lastUpdatedAt: site.updatedAt,
      },
    });
  });

  router.post('/sites/:siteId/refresh', async (req, res) => {
    const siteId = Number(req.params.siteId);
    if (!Number.isFinite(siteId)) return res.status(400).json({ error: 'Invalid siteId' });

    const site: any = await prisma.site.findUnique({ where: { id: siteId } });
    if (!site) return res.status(404).json({ error: 'Site not found' });
    if (!site.plantCode) return res.status(400).json({ error: 'Site plantCode is missing' });

    const mode = String((req.query.mode ?? req.body?.mode ?? 'full')).trim().toLowerCase();
    const full = mode !== 'site';

    const result = await (syncPlantOnDemand as any) (site.plantCode, {
      forceSiteRealtime: true,
      forceDeviceDetail: full,
      includeDeviceDetail: full,
    });

    const refreshed = await prisma.site.findUnique({ where: { id: siteId } });
    const inverterCount = await prisma.inverter.count({ where: { siteId } });

    res.json({
      success: true,
      data: {
        mode: full ? 'full' : 'site',
        refreshResult: result,
        site: refreshed,
        inverterCount,
      },
    });
  });


  router.get('/inverters/:inverterId', async (req, res) => {
    const inverterId = Number(req.params.inverterId);
    if (!Number.isFinite(inverterId)) return res.status(400).json({ error: 'Invalid inverterId' });

    const inverter: any = await prisma.inverter.findUnique({
      where: { id: inverterId },
      include: { site: true },
    });

    if (!inverter) return res.status(404).json({ error: 'Inverter not found' });

    res.json({
      data: {
        id: inverter.id,
        name: inverter.name,
        model: inverter.model,
        serialNumber: inverter.serialNumber,
        softwareVersion: (inverter as any).softwareVersion ?? null,
        deviceReplacementRecord: (inverter as any).deviceReplacementRecord ?? null,
        stationCode: inverter.stationCode,
        site: {
          id: inverter.site.id,
          name: inverter.site.name,
          plantCode: inverter.site.plantCode,
        },
        realtime: {
          activePower: inverter.activePower,
          dayEnergy: inverter.lastDailyEnergy,
          status: inverter.status,
          lastSyncAt: inverter.lastSyncAt,
        },
      },
    });
  });


  router.get('/inverters/:inverterId/strings/latest', async (req, res) => {
    const inverterId = Number(req.params.inverterId);
    if (!Number.isFinite(inverterId)) return res.status(400).json({ error: 'Invalid inverterId' });

    const snap = await prisma.inverterKpiSnapshot.findFirst({
      where: { inverterId },
      orderBy: { ts: 'desc' },
      select: { id: true, ts: true },
    });

    if (!snap) return res.json({ data: { ts: null, strings: [] } });

    const strings = await prisma.inverterStringSnapshot.findMany({
      where: { snapshotId: snap.id },
      select: { stringNo: true, voltage: true, current: true, status: true },
      orderBy: { stringNo: 'asc' },
    });

    res.json({ data: { ts: snap.ts, strings } });
  });

  router.get('/inverters/:inverterId/history', async (req, res) => {
    const inverterId = Number(req.params.inverterId);
    const metric = String(req.query.metric ?? 'activePower');
    const range = String(req.query.range ?? 'day');

    if (!Number.isFinite(inverterId)) return res.status(400).json({ error: 'Invalid inverterId' });

    const now = new Date();
    const from = new Date(now);

    if (range === 'day') from.setHours(now.getHours() - 24);
    else if (range === 'week') from.setDate(now.getDate() - 7);
    else if (range === 'month') from.setDate(now.getDate() - 30);
    else return res.status(400).json({ error: 'Invalid range' });


    const allow = new Set(['activePower', 'dayEnergy', 'temperature', 'powerFactor']);
    if (!allow.has(metric)) return res.status(400).json({ error: 'Invalid metric' });

    const rows = await prisma.inverterKpiSnapshot.findMany({
      where: { inverterId, ts: { gte: from } },
      orderBy: { ts: 'asc' },
      select: {
        ts: true,
        activePower: true,
        dayEnergy: true,
        temperature: true,
        powerFactor: true,
      },
    });

    const series = rows.map((r: any) => ({ t: r.ts, v: r[metric] }));
    res.json({ data: { metric, range, series } });
  });


	router.get('/sites/:siteId/energy-management', async (req, res) => {
		const siteId = Number(req.params.siteId);
		if (!Number.isFinite(siteId)) return res.status(400).json({ error: 'Invalid siteId' });

		const view = String(req.query.view ?? 'day').trim().toLowerCase();
		if (!['day', 'month', 'year', 'lifetime'].includes(view)) {
			return res.status(400).json({ error: 'Invalid view' });
		}

		try {
			const data = await getEnergyManagementSeries(siteId, {
				view: view as 'day' | 'month' | 'year' | 'lifetime',
				date: req.query.date != null ? String(req.query.date) : null,
			});

			return res.json({ data });
		} catch (e: any) {
			return res.status(e?.statusCode ?? 500).json({ error: e?.message ?? 'Internal error' });
		}
	});

	router.get('/sites/:siteId/home-realtime', async (req, res) => {
		const siteId = Number(req.params.siteId);
		if (!Number.isFinite(siteId)) return res.status(400).json({ error: 'Invalid siteId' });

		const refreshRaw = String(req.query.refresh ?? '').trim().toLowerCase();
		const refresh = refreshRaw === '1' || refreshRaw === 'true' || refreshRaw === 'full' ? 'force' : 'auto';

		try {
			const data = await getMonitoringHomeRealtime(siteId, { refresh });
			return res.json({ data });
		} catch (e: any) {
			return res.status(e?.statusCode ?? 500).json({ error: e?.message ?? 'Internal error' });
		}
	});

	router.get('/sites/:siteId/energy-flow', async (req, res) => {
		const siteId = Number(req.params.siteId);
		if (!Number.isFinite(siteId)) return res.status(400).json({ error: 'Invalid siteId' });

		const refreshRaw = String(req.query.refresh ?? '').trim().toLowerCase();
		const refresh = refreshRaw === '1' || refreshRaw === 'true' || refreshRaw === 'full' ? 'force' : 'auto';

		try {
			const data = await getMonitoringHomeRealtime(siteId, { refresh });
			return res.json({
				data: {
					siteId: data.siteId,
					plantCode: data.plantCode,
					plantName: data.plantName,
					fetchedAt: data.fetchedAt,
					siteRefresh: data.siteRefresh,
					energyFlow: data.energyFlow,
				},
			});
		} catch (e: any) {
			return res.status(e?.statusCode ?? 500).json({ error: e?.message ?? 'Internal error' });
		}
	});

	router.get('/sites/:siteId/summary-cards', async (req, res) => {
		const siteId = Number(req.params.siteId);
		if (!Number.isFinite(siteId)) return res.status(400).json({ error: 'Invalid siteId' });

		const refreshRaw = String(req.query.refresh ?? '').trim().toLowerCase();
		const refresh = refreshRaw === '1' || refreshRaw === 'true' || refreshRaw === 'full' ? 'force' : 'auto';

		try {
			const data = await getMonitoringHomeRealtime(siteId, { refresh });
			return res.json({
				data: {
					siteId: data.siteId,
					plantCode: data.plantCode,
					plantName: data.plantName,
					fetchedAt: data.fetchedAt,
					siteRefresh: data.siteRefresh,
					summaryCards: data.summaryCards,
					supportingData: data.supportingData,
				},
			});
		} catch (e: any) {
			return res.status(e?.statusCode ?? 500).json({ error: e?.message ?? 'Internal error' });
		}
	});

	// Historical PV string current (for Historical Information graph)
	// GET /api/monitoring/inverters/:inverterId/strings/history
	// Query:
	//  - date=YYYY-MM-DD (optional) : if provided, returns that local day window (needs tzOffsetMinutes)
	//  - tzOffsetMinutes (optional, default 0): same semantics as JS Date.getTimezoneOffset()
	//  - range=day|week|month (optional, default day): used when date is not provided
	//  - stringNo (optional): fetch only one PV string series
	//  - includeDisconnected=true (optional): include "Disconnected" points (default false)
	router.get('/inverters/:inverterId/strings/history', async (req, res) => {
		const inverterId = Number(req.params.inverterId);
		if (!Number.isFinite(inverterId)) return res.status(400).json({ error: 'Invalid inverterId' });

		const dateStr = req.query.date != null ? String(req.query.date) : null;
		const range = String(req.query.range ?? 'day');
		const tzOffsetMinutesRaw = req.query.tzOffsetMinutes != null ? Number(req.query.tzOffsetMinutes) : 0;
		if (!Number.isFinite(tzOffsetMinutesRaw)) return res.status(400).json({ error: 'Invalid tzOffsetMinutes' });
		const tzOffsetMinutes = Math.trunc(tzOffsetMinutesRaw);

		const stringNo = req.query.stringNo != null ? Number(req.query.stringNo) : null;
		if (req.query.stringNo != null && !Number.isFinite(stringNo)) {
			return res.status(400).json({ error: 'Invalid stringNo' });
		}

		const includeDisconnected = String(req.query.includeDisconnected ?? 'false').toLowerCase() === 'true';

		let from: Date;
		let to: Date;

		if (dateStr) {
			const m = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(dateStr);
			if (!m) return res.status(400).json({ error: 'Invalid date (expected YYYY-MM-DD)' });
			const y = Number(m[1]);
			const mo = Number(m[2]);
			const d = Number(m[3]);
			if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) {
				return res.status(400).json({ error: 'Invalid date' });
			}

			// Interpret `date` as the user's local date. Convert local midnight to UTC using tzOffsetMinutes.
			const baseUtcMs = Date.UTC(y, mo - 1, d, 0, 0, 0, 0);
			const fromMs = baseUtcMs + tzOffsetMinutes * 60_000;
			from = new Date(fromMs);
			to = new Date(fromMs + 24 * 60 * 60 * 1000);
		} else {
			const now = new Date();
			to = now;
			from = new Date(now);
			if (range === 'day') from.setHours(now.getHours() - 24);
			else if (range === 'week') from.setDate(now.getDate() - 7);
			else if (range === 'month') from.setDate(now.getDate() - 30);
			else return res.status(400).json({ error: 'Invalid range' });
		}

		const rows = await prisma.inverterKpiSnapshot.findMany({
			where: { inverterId, ts: { gte: from, lt: to } },
			orderBy: { ts: 'asc' },
			select: {
				ts: true,
				strings: {
					select: { stringNo: true, voltage: true, current: true, status: true },
					orderBy: { stringNo: 'asc' },
				},
			},
		});

		const seriesMap = new Map<
			number,
			{ stringNo: number; points: Array<{ t: Date; current: number | null; voltage: number | null; status: string | null }> }
		>();

		for (const snap of rows as any[]) {
			const ts = snap.ts as Date;
			const strings = Array.isArray(snap.strings) ? snap.strings : [];
			for (const s of strings) {
				const n = Number(s.stringNo);
				if (!Number.isFinite(n)) continue;
				if (stringNo != null && n !== stringNo) continue;
				if (!includeDisconnected && String(s.status) === 'Disconnected') continue;

				let bucket = seriesMap.get(n);
				if (!bucket) {
					bucket = { stringNo: n, points: [] };
					seriesMap.set(n, bucket);
				}

				bucket.points.push({
					t: ts,
					current: s.current != null && Number.isFinite(Number(s.current)) ? Number(s.current) : null,
					voltage: s.voltage != null && Number.isFinite(Number(s.voltage)) ? Number(s.voltage) : null,
					status: s.status ?? null,
				});
			}
		}

		const seriesByString = Array.from(seriesMap.values()).sort((a, b) => a.stringNo - b.stringNo);

		res.json({
			data: {
				inverterId,
				date: dateStr,
				tzOffsetMinutes,
				range: dateStr ? null : range,
				from,
				to,
				stringNo,
				includeDisconnected,
				seriesByString,
			},
		});
	});

  export default router;
