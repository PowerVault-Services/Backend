	import { Router } from 'express';
	import prisma from '../config/prisma';
	import { huaweiOnDemand } from '../services/huaweiService';

	const router = Router();

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
    const sites = await prisma.site.findMany({
      select: {
        id: true,
        plantCode: true,
        name: true,
        capacityKWp: true,
        address: true,
        latitude: true,
        longitude: true,
        updatedAt: true,
      },
      orderBy: { name: 'asc' },
    });
    res.json({ data: sites });
  });


  router.get('/sites/:siteId/overview', async (req, res) => {
    const siteId = Number(req.params.siteId);
    if (!Number.isFinite(siteId)) return res.status(400).json({ error: 'Invalid siteId' });

    const site = await prisma.site.findUnique({ where: { id: siteId } });
    if (!site) return res.status(404).json({ error: 'Site not found' });


    const inverters = await prisma.inverter.findMany({
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
      },
      orderBy: { name: 'asc' },
    });


    const last7Days = new Date();
    last7Days.setDate(last7Days.getDate() - 7);

	    const energySeries = await prisma.siteDailyEnergy.findMany({
	      where: { siteId, date: { gte: last7Days } },
	      select: { date: true, energyKWh: true },
	      orderBy: { date: 'asc' },
	    });

    res.json({
      data: {
        site: {
          id: site.id,
          plantCode: site.plantCode,
          name: site.name,
          capacityKWp: site.capacityKWp,
        },
        inverters,
        energySeries,
        lastUpdatedAt: new Date().toISOString(),
      },
    });
  });


  router.get('/inverters/:inverterId', async (req, res) => {
    const inverterId = Number(req.params.inverterId);
    if (!Number.isFinite(inverterId)) return res.status(400).json({ error: 'Invalid inverterId' });

    const inverter = await prisma.inverter.findUnique({
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

  export default router;
