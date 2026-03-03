"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const prisma_1 = __importDefault(require("../config/prisma"));
const alarmSyncService_1 = require("../services/alarmSyncService");
const router = (0, express_1.Router)();
const lastAutoRefresh = new Map();
router.get('/', async (req, res) => {
    const tab = String(req.query.tab ?? 'active'); // active | historical
    const page = Math.max(1, Number(req.query.page ?? 1));
    const pageSize = Math.min(100, Math.max(10, Number(req.query.pageSize ?? 20)));
    const skip = (page - 1) * pageSize;
    const siteId = req.query.siteId ? Number(req.query.siteId) : null;
    const inverterId = req.query.inverterId ? Number(req.query.inverterId) : null;
    const refreshFlag = String(req.query.refresh ?? '').trim();
    const forceRefresh = refreshFlag === '1';
    const disableAutoRefresh = refreshFlag === '0';
    const shouldAutoRefresh = !disableAutoRefresh &&
        tab === 'active' &&
        page === 1 &&
        (Number.isFinite(siteId) || Number.isFinite(inverterId));
    // on-demand alarm refresh for this site/inverter
    if (forceRefresh || shouldAutoRefresh) {
        try {
            const minIntervalMs = Number(process.env.HUAWEI_ALARM_AUTO_REFRESH_MIN_INTERVAL_MS ?? 60000);
            const key = Number.isFinite(siteId) && siteId ? `site:${siteId}` : Number.isFinite(inverterId) && inverterId ? `inv:${inverterId}` : 'na';
            const now = Date.now();
            const last = lastAutoRefresh.get(key) ?? 0;
            // cooldown is skipped when forceRefresh=1
            if (forceRefresh || now - last >= minIntervalMs) {
                lastAutoRefresh.set(key, now);
                if (Number.isFinite(siteId) && siteId) {
                    const s = await prisma_1.default.site.findUnique({ where: { id: siteId }, select: { plantCode: true } });
                    if (s?.plantCode)
                        await (0, alarmSyncService_1.syncAlarmsForStationsOnDemand)([s.plantCode], 24);
                }
                else if (Number.isFinite(inverterId) && inverterId) {
                    const inv = await prisma_1.default.inverter.findUnique({ where: { id: inverterId }, select: { stationCode: true } });
                    if (inv?.stationCode)
                        await (0, alarmSyncService_1.syncAlarmsForStationsOnDemand)([inv.stationCode], 24);
                }
            }
        }
        catch (e) {
            console.warn('⚠️ ONDEMAND alarm refresh failed:', e?.message ?? e);
        }
    }
    const severity = req.query.severity ? Number(req.query.severity) : null;
    const alarmId = String(req.query.alarmId ?? '').trim();
    const sn = String(req.query.sn ?? '').trim();
    const q = String(req.query.q ?? '').trim();
    const from = req.query.from ? new Date(String(req.query.from)) : null;
    const to = req.query.to ? new Date(String(req.query.to)) : null;
    const where = {};
    // "Active" / "Historical" is derived by backend (Huawei API provides mostly current alarms).
    // Use status as primary, and clearedAt as secondary for robustness.
    if (tab === 'active') {
        where.status = 'ACTIVE';
        where.clearedAt = null;
    }
    else if (tab === 'historical') {
        where.status = 'CLEARED';
        where.clearedAt = { not: null };
    }
    if (Number.isFinite(siteId))
        where.siteId = siteId;
    if (Number.isFinite(inverterId))
        where.inverterId = inverterId;
    if (Number.isFinite(severity))
        where.severity = severity;
    if (q)
        where.name = { contains: q, mode: 'insensitive' };
    // filter by alarmId from Huawei (stored in raw.alarmId)
    if (alarmId) {
        where.raw = { path: ['alarmId'], equals: alarmId };
    }
    // filter by inverter serial number (sn)
    if (sn) {
        const inv = await prisma_1.default.inverter.findUnique({ where: { serialNumber: sn }, select: { id: true } });
        if (inv?.id)
            where.inverterId = inv.id;
        else {
            return res.json({
                success: true,
                data: { list: [], pagination: { page, pageSize, total: 0, totalPages: 0 } },
            });
        }
    }
    if (from || to) {
        where.occurredAt = {};
        if (from)
            where.occurredAt.gte = from;
        if (to)
            where.occurredAt.lte = to;
    }
    const [total, rows] = await Promise.all([
        prisma_1.default.alarm.count({ where }),
        prisma_1.default.alarm.findMany({
            where,
            orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
            skip,
            take: pageSize,
            include: { site: true, inverter: true },
        }),
    ]);
    res.json({
        success: true,
        data: {
            list: rows.map((a) => ({
                id: a.id,
                severity: a.severity,
                plantName: a.site?.name ?? null,
                deviceName: a.inverter?.name ?? a.raw?.devName ?? null,
                alarmName: a.name,
                alarmId: a.raw?.alarmId ?? null,
                sn: a.inverter?.serialNumber ?? a.raw?.esnCode ?? null,
                occurredAt: a.occurredAt,
                clearedAt: a.clearedAt,
                status: a.status,
                raw: a.raw,
            })),
            pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
        },
    });
});
// --- Export CSV ---
// GET /api/alarms/export?tab=active&...
router.get('/export', async (req, res) => {
    const tab = String(req.query.tab ?? 'active');
    const siteId = req.query.siteId ? Number(req.query.siteId) : null;
    const inverterId = req.query.inverterId ? Number(req.query.inverterId) : null;
    const severity = req.query.severity ? Number(req.query.severity) : null;
    const alarmId = String(req.query.alarmId ?? '').trim();
    const sn = String(req.query.sn ?? '').trim();
    const q = String(req.query.q ?? '').trim();
    const from = req.query.from ? new Date(String(req.query.from)) : null;
    const to = req.query.to ? new Date(String(req.query.to)) : null;
    const where = {};
    if (tab === 'active') {
        where.status = 'ACTIVE';
        where.clearedAt = null;
    }
    else if (tab === 'historical') {
        where.status = 'CLEARED';
        where.clearedAt = { not: null };
    }
    if (Number.isFinite(siteId))
        where.siteId = siteId;
    if (Number.isFinite(inverterId))
        where.inverterId = inverterId;
    if (Number.isFinite(severity))
        where.severity = severity;
    if (q)
        where.name = { contains: q, mode: 'insensitive' };
    if (alarmId)
        where.raw = { path: ['alarmId'], equals: alarmId };
    if (sn) {
        const inv = await prisma_1.default.inverter.findUnique({ where: { serialNumber: sn }, select: { id: true } });
        if (inv?.id)
            where.inverterId = inv.id;
        else {
            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="alarms.csv"`);
            return res.send('id,severity,plantName,deviceName,alarmName,alarmId,occurredAt,clearedAt,status\n');
        }
    }
    if (from || to) {
        where.occurredAt = {};
        if (from)
            where.occurredAt.gte = from;
        if (to)
            where.occurredAt.lte = to;
    }
    const rows = await prisma_1.default.alarm.findMany({
        where,
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        include: { site: true, inverter: true },
        take: 50000,
    });
    const esc = (v) => {
        const s = v == null ? '' : String(v);
        const needs = /[",\n]/.test(s);
        const body = s.replace(/"/g, '""');
        return needs ? `"${body}"` : body;
    };
    const header = ['id', 'severity', 'plantName', 'deviceName', 'alarmName', 'alarmId', 'occurredAt', 'clearedAt', 'status'];
    const lines = [header.join(',')];
    for (const a of rows) {
        lines.push([
            a.id,
            a.severity ?? '',
            a.site?.name ?? '',
            a.inverter?.name ?? a.raw?.devName ?? '',
            a.name ?? '',
            a.raw?.alarmId ?? '',
            a.occurredAt ? a.occurredAt.toISOString() : '',
            a.clearedAt ? a.clearedAt.toISOString() : '',
            a.status ?? '',
        ]
            .map(esc)
            .join(','));
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="alarms-${tab}.csv"`);
    res.send(lines.join('\n'));
});
exports.default = router;
