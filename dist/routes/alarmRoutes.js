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
function getAckMeta(raw) {
    const meta = raw?._meta ?? {};
    const acknowledgedAt = meta?.acknowledgedAt ? new Date(String(meta.acknowledgedAt)) : null;
    const acknowledgedBy = meta?.acknowledgedBy ?? null;
    const deletedAt = meta?.deletedAt ? new Date(String(meta.deletedAt)) : null;
    const deletedBy = meta?.deletedBy ?? null;
    return { acknowledgedAt, acknowledgedBy, deletedAt, deletedBy };
}
function getDeviceType(a) {
    const raw = a?.raw;
    // Prefer Huawei alarm payload if present
    const devTypeName = raw?.devTypeName ?? raw?.deviceTypeName ?? null;
    const devTypeId = raw?.devTypeId ?? raw?.deviceTypeId ?? null;
    // Fallback to inverter model (best-effort)
    const model = a?.inverter?.model ?? null;
    return {
        deviceType: devTypeName ?? model,
        deviceTypeId: devTypeId != null ? Number(devTypeId) : null,
    };
}
function getSeverityText(a) {
    const raw = a?.raw;
    const t = raw?.levName ?? raw?.severityName ?? null;
    if (t)
        return String(t);
    const sev = a?.severity != null ? Number(a.severity) : null;
    const map = { 1: 'Warning', 2: 'Minor', 3: 'Major', 4: 'Critical' };
    return sev != null && map[sev] ? map[sev] : null;
}
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
    // Hide soft-deleted alarms by default (stored in raw._meta.deletedAt)
    const includeDeleted = String(req.query.includeDeleted ?? '').trim() === '1';
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
    const filteredRows = includeDeleted
        ? rows
        : rows.filter((a) => {
            const { deletedAt } = getAckMeta(a.raw);
            return !deletedAt;
        });
    res.json({
        success: true,
        data: {
            list: filteredRows.map((a) => {
                const { acknowledgedAt, acknowledgedBy, deletedAt } = getAckMeta(a.raw);
                const { deviceType, deviceTypeId } = getDeviceType(a);
                const severityText = getSeverityText(a);
                const canAcknowledge = !acknowledgedAt && !deletedAt;
                const canDelete = !deletedAt;
                return {
                    id: a.id,
                    severity: a.severity,
                    severityText,
                    plantName: a.site?.name ?? null,
                    deviceType,
                    deviceTypeId,
                    deviceName: a.inverter?.name ?? a.raw?.devName ?? null,
                    alarmName: a.name,
                    alarmId: a.raw?.alarmId ?? null,
                    sn: a.inverter?.serialNumber ?? a.raw?.esnCode ?? null,
                    occurredAt: a.occurredAt,
                    occurrenceTime: a.occurredAt,
                    clearedAt: a.clearedAt,
                    status: a.status,
                    acknowledgedAt,
                    acknowledgedBy,
                    deletedAt,
                    // UI actions column (Operation)
                    operation: {
                        viewDetails: true,
                        acknowledge: canAcknowledge,
                        delete: canDelete,
                    },
                    raw: a.raw,
                };
            }),
            pagination: {
                page,
                pageSize,
                total: includeDeleted ? total : filteredRows.length,
                totalPages: Math.ceil((includeDeleted ? total : filteredRows.length) / pageSize),
            },
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
// --- Alarm details ---
// GET /api/alarms/:id
router.get('/:id', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id))
        return res.status(400).json({ success: false, message: 'Invalid id' });
    const a = await prisma_1.default.alarm.findUnique({
        where: { id },
        include: { site: true, inverter: true },
    });
    if (!a)
        return res.status(404).json({ success: false, message: 'Alarm not found' });
    const { acknowledgedAt, acknowledgedBy, deletedAt, deletedBy } = getAckMeta(a.raw);
    const { deviceType, deviceTypeId } = getDeviceType(a);
    const severityText = getSeverityText(a);
    res.json({
        success: true,
        data: {
            id: a.id,
            severity: a.severity,
            severityText,
            plantName: a.site?.name ?? null,
            plantCode: a.site?.plantCode ?? null,
            inverterId: a.inverterId,
            inverterName: a.inverter?.name ?? null,
            deviceType,
            deviceTypeId,
            deviceName: a.inverter?.name ?? a.raw?.devName ?? null,
            sn: a.inverter?.serialNumber ?? a.raw?.esnCode ?? null,
            alarmName: a.name,
            alarmId: a.raw?.alarmId ?? null,
            occurredAt: a.occurredAt,
            occurrenceTime: a.occurredAt,
            clearedAt: a.clearedAt,
            status: a.status,
            acknowledgedAt,
            acknowledgedBy,
            deletedAt,
            deletedBy,
            raw: a.raw,
        },
    });
});
// --- Acknowledge ---
// POST /api/alarms/:id/acknowledge
router.post('/:id/acknowledge', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id))
        return res.status(400).json({ success: false, message: 'Invalid id' });
    const user = req?.user;
    const acknowledgedBy = user?.username ?? user?.email ?? user?.id ?? 'system';
    const a = await prisma_1.default.alarm.findUnique({ where: { id } });
    if (!a)
        return res.status(404).json({ success: false, message: 'Alarm not found' });
    const raw = a.raw ?? {};
    raw._meta = raw._meta ?? {};
    if (raw._meta.deletedAt) {
        return res.status(409).json({ success: false, message: 'Alarm already deleted' });
    }
    if (!raw._meta.acknowledgedAt) {
        raw._meta.acknowledgedAt = new Date().toISOString();
        raw._meta.acknowledgedBy = acknowledgedBy;
    }
    const updated = await prisma_1.default.alarm.update({ where: { id }, data: { raw } });
    const { acknowledgedAt, acknowledgedBy: by } = getAckMeta(updated.raw);
    res.json({ success: true, data: { id: updated.id, acknowledgedAt, acknowledgedBy: by } });
});
// --- Soft delete ---
// DELETE /api/alarms/:id
router.delete('/:id', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id))
        return res.status(400).json({ success: false, message: 'Invalid id' });
    const user = req?.user;
    const deletedBy = user?.username ?? user?.email ?? user?.id ?? 'system';
    const a = await prisma_1.default.alarm.findUnique({ where: { id } });
    if (!a)
        return res.status(404).json({ success: false, message: 'Alarm not found' });
    const raw = a.raw ?? {};
    raw._meta = raw._meta ?? {};
    if (!raw._meta.deletedAt) {
        raw._meta.deletedAt = new Date().toISOString();
        raw._meta.deletedBy = deletedBy;
    }
    const updated = await prisma_1.default.alarm.update({ where: { id }, data: { raw } });
    const { deletedAt, deletedBy: by } = getAckMeta(updated.raw);
    res.json({ success: true, data: { id: updated.id, deletedAt, deletedBy: by } });
});
exports.default = router;
