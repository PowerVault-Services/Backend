"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const prisma_1 = __importDefault(require("../config/prisma"));
const huaweiService_1 = require("../services/huaweiService");
const router = (0, express_1.Router)();
router.get('/pr', async (req, res) => {
    const siteId = Number(req.query.siteId);
    const granularity = String(req.query.granularity ?? 'month');
    const year = req.query.year != null ? Number(req.query.year) : null;
    const endDateIso = req.query.endDate != null ? String(req.query.endDate) : null;
    const collectTimeFromQuery = req.query.collectTime != null ? Number(req.query.collectTime) : null;
    if (!Number.isFinite(siteId))
        return res.status(400).json({ error: 'Invalid siteId' });
    if (!['month', 'day', 'year'].includes(granularity))
        return res.status(400).json({ error: 'Invalid granularity' });
    const site = await prisma_1.default.site.findUnique({ where: { id: siteId } });
    if (!site)
        return res.status(404).json({ error: 'Site not found' });
    if (!site.plantCode)
        return res.status(400).json({ error: 'Site plantCode is missing' });
    const varPct = (actual, forecast) => {
        if (actual == null || forecast == null || forecast === 0)
            return null;
        return ((actual - forecast) / forecast) * 100;
    };
    // ---- Forecast (monthly) from DB ----
    const forecastMonthly = await prisma_1.default.siteForecastMonthly.findMany({
        where: { siteId },
        select: { month: true, globalKwhM2: true, eGridKwh: true, prRatio: true },
        orderBy: { month: 'asc' },
    });
    // ---- Actual from Huawei ----
    // Huawei KPI fields for PR page (confirmed from sample responses):
    //  - radiation_intensity (Irradiation)
    //  - PVYield (Production)
    //  - performance_ratio (PR)
    const mapHuaweiItem = (r) => {
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
    let actualByMonth = new Map();
    let actualDaily = [];
    let actualByYear = [];
    // Huawei decides the window by collectTime.
    // Fallback logic so FE can call with either collectTime or year/endDate.
    const resolveCollectTime = () => {
        if (collectTimeFromQuery != null && Number.isFinite(collectTimeFromQuery))
            return collectTimeFromQuery;
        if (granularity === 'day') {
            const endDate = endDateIso ? new Date(endDateIso) : new Date();
            if (!Number.isNaN(endDate.getTime()))
                return endDate.getTime();
            return Date.now();
        }
        const y = Number.isFinite(year) ? year : new Date().getFullYear();
        // noon helps avoid timezone boundary weirdness
        return new Date(y, 11, 31, 12, 0, 0, 0).getTime();
    };
    try {
        const collectTime = resolveCollectTime();
        if (granularity === 'month') {
            const raw = await huaweiService_1.huaweiOnDemand.postRaw('/thirdData/getKpiStationMonth', {
                stationCodes: site.plantCode,
                collectTime,
            });
            const rows = Array.isArray(raw?.data) ? raw.data : [];
            for (const r of rows) {
                const x = mapHuaweiItem(r);
                if (!Number.isFinite(x.ct))
                    continue;
                const m = new Date(x.ct).getMonth() + 1;
                actualByMonth.set(m, { irradiation: x.irradiation, production: x.production, pr: x.pr });
            }
        }
        if (granularity === 'day') {
            const raw = await huaweiService_1.huaweiOnDemand.postRaw('/thirdData/getKpiStationDay', {
                stationCodes: site.plantCode,
                collectTime,
            });
            const rows = Array.isArray(raw?.data) ? raw.data : [];
            actualDaily = rows
                .map((r) => {
                const x = mapHuaweiItem(r);
                if (!Number.isFinite(x.ct))
                    return null;
                const date = new Date(x.ct).toISOString().slice(0, 10);
                return { date, irradiation: x.irradiation, production: x.production, pr: x.pr };
            })
                .filter(Boolean);
        }
        if (granularity === 'year') {
            const raw = await huaweiService_1.huaweiOnDemand.postRaw('/thirdData/getKpiStationYear', {
                stationCodes: site.plantCode,
                collectTime,
            });
            const rows = Array.isArray(raw?.data) ? raw.data : [];
            actualByYear = rows
                .map((r) => {
                const x = mapHuaweiItem(r);
                if (!Number.isFinite(x.ct))
                    return null;
                return {
                    year: new Date(x.ct).getFullYear(),
                    irradiation: x.irradiation,
                    production: x.production,
                    pr: x.pr,
                };
            })
                .filter(Boolean);
        }
    }
    catch (e) {
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
        const sum = (vals) => vals.reduce((acc, v) => acc + (v ?? 0), 0);
        const weightedAvg = (pairs) => {
            let num = 0;
            let den = 0;
            for (const p of pairs) {
                if (p.v == null || p.w == null)
                    continue;
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
    const y = Number.isFinite(year) ? year : new Date().getFullYear();
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
    const sites = await prisma_1.default.site.findMany({
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
    if (!Number.isFinite(siteId))
        return res.status(400).json({ error: 'Invalid siteId' });
    const site = await prisma_1.default.site.findUnique({ where: { id: siteId } });
    if (!site)
        return res.status(404).json({ error: 'Site not found' });
    const inverters = await prisma_1.default.inverter.findMany({
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
    const energySeries = await prisma_1.default.siteDailyEnergy.findMany({
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
    if (!Number.isFinite(inverterId))
        return res.status(400).json({ error: 'Invalid inverterId' });
    const inverter = await prisma_1.default.inverter.findUnique({
        where: { id: inverterId },
        include: { site: true },
    });
    if (!inverter)
        return res.status(404).json({ error: 'Inverter not found' });
    res.json({
        data: {
            id: inverter.id,
            name: inverter.name,
            model: inverter.model,
            serialNumber: inverter.serialNumber,
            softwareVersion: inverter.softwareVersion ?? null,
            deviceReplacementRecord: inverter.deviceReplacementRecord ?? null,
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
    if (!Number.isFinite(inverterId))
        return res.status(400).json({ error: 'Invalid inverterId' });
    const snap = await prisma_1.default.inverterKpiSnapshot.findFirst({
        where: { inverterId },
        orderBy: { ts: 'desc' },
        select: { id: true, ts: true },
    });
    if (!snap)
        return res.json({ data: { ts: null, strings: [] } });
    const strings = await prisma_1.default.inverterStringSnapshot.findMany({
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
    if (!Number.isFinite(inverterId))
        return res.status(400).json({ error: 'Invalid inverterId' });
    const now = new Date();
    const from = new Date(now);
    if (range === 'day')
        from.setHours(now.getHours() - 24);
    else if (range === 'week')
        from.setDate(now.getDate() - 7);
    else if (range === 'month')
        from.setDate(now.getDate() - 30);
    else
        return res.status(400).json({ error: 'Invalid range' });
    const allow = new Set(['activePower', 'dayEnergy', 'temperature', 'powerFactor']);
    if (!allow.has(metric))
        return res.status(400).json({ error: 'Invalid metric' });
    const rows = await prisma_1.default.inverterKpiSnapshot.findMany({
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
    const series = rows.map((r) => ({ t: r.ts, v: r[metric] }));
    res.json({ data: { metric, range, series } });
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
    if (!Number.isFinite(inverterId))
        return res.status(400).json({ error: 'Invalid inverterId' });
    const dateStr = req.query.date != null ? String(req.query.date) : null;
    const range = String(req.query.range ?? 'day');
    const tzOffsetMinutesRaw = req.query.tzOffsetMinutes != null ? Number(req.query.tzOffsetMinutes) : 0;
    if (!Number.isFinite(tzOffsetMinutesRaw))
        return res.status(400).json({ error: 'Invalid tzOffsetMinutes' });
    const tzOffsetMinutes = Math.trunc(tzOffsetMinutesRaw);
    const stringNo = req.query.stringNo != null ? Number(req.query.stringNo) : null;
    if (req.query.stringNo != null && !Number.isFinite(stringNo)) {
        return res.status(400).json({ error: 'Invalid stringNo' });
    }
    const includeDisconnected = String(req.query.includeDisconnected ?? 'false').toLowerCase() === 'true';
    let from;
    let to;
    if (dateStr) {
        const m = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(dateStr);
        if (!m)
            return res.status(400).json({ error: 'Invalid date (expected YYYY-MM-DD)' });
        const y = Number(m[1]);
        const mo = Number(m[2]);
        const d = Number(m[3]);
        if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) {
            return res.status(400).json({ error: 'Invalid date' });
        }
        // Interpret `date` as the user's local date. Convert local midnight to UTC using tzOffsetMinutes.
        const baseUtcMs = Date.UTC(y, mo - 1, d, 0, 0, 0, 0);
        const fromMs = baseUtcMs + tzOffsetMinutes * 60000;
        from = new Date(fromMs);
        to = new Date(fromMs + 24 * 60 * 60 * 1000);
    }
    else {
        const now = new Date();
        to = now;
        from = new Date(now);
        if (range === 'day')
            from.setHours(now.getHours() - 24);
        else if (range === 'week')
            from.setDate(now.getDate() - 7);
        else if (range === 'month')
            from.setDate(now.getDate() - 30);
        else
            return res.status(400).json({ error: 'Invalid range' });
    }
    const rows = await prisma_1.default.inverterKpiSnapshot.findMany({
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
    const seriesMap = new Map();
    for (const snap of rows) {
        const ts = snap.ts;
        const strings = Array.isArray(snap.strings) ? snap.strings : [];
        for (const s of strings) {
            const n = Number(s.stringNo);
            if (!Number.isFinite(n))
                continue;
            if (stringNo != null && n !== stringNo)
                continue;
            if (!includeDisconnected && String(s.status) === 'Disconnected')
                continue;
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
exports.default = router;
