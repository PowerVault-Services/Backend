import { Router } from 'express';
import prisma from '../config/prisma';

const router = Router();

router.get('/', async (req, res) => {
  const tab = String(req.query.tab ?? 'active'); // active | historical
  const page = Math.max(1, Number(req.query.page ?? 1));
  const pageSize = Math.min(100, Math.max(10, Number(req.query.pageSize ?? 20)));
  const skip = (page - 1) * pageSize;

  const siteId = req.query.siteId ? Number(req.query.siteId) : null;
  const inverterId = req.query.inverterId ? Number(req.query.inverterId) : null;
  const severity = req.query.severity ? Number(req.query.severity) : null;
  const alarmId = String(req.query.alarmId ?? '').trim();
  const sn = String(req.query.sn ?? '').trim();
  const q = String(req.query.q ?? '').trim();

  const from = req.query.from ? new Date(String(req.query.from)) : null;
  const to = req.query.to ? new Date(String(req.query.to)) : null;

  const where: any = {};
  // "Active" / "Historical" is derived by backend (Huawei API provides mostly current alarms).
  // Use status as primary, and clearedAt as secondary for robustness.
  if (tab === 'active') {
    where.status = 'ACTIVE';
    where.clearedAt = null;
  } else if (tab === 'historical') {
    where.status = 'CLEARED';
    where.clearedAt = { not: null };
  }

  if (Number.isFinite(siteId as any)) where.siteId = siteId;
  if (Number.isFinite(inverterId as any)) where.inverterId = inverterId;
  if (Number.isFinite(severity as any)) where.severity = severity;
  if (q) where.name = { contains: q, mode: 'insensitive' };

  // filter by alarmId from Huawei (stored in raw.alarmId)
  if (alarmId) {
    where.raw = { path: ['alarmId'], equals: alarmId };
  }

  // filter by inverter serial number (sn)
  if (sn) {
    const inv = await prisma.inverter.findUnique({ where: { serialNumber: sn }, select: { id: true } });
    if (inv?.id) where.inverterId = inv.id;
    else {
      return res.json({
        success: true,
        data: { list: [], pagination: { page, pageSize, total: 0, totalPages: 0 } },
      });
    }
  }

  if (from || to) {
    where.occurredAt = {};
    if (from) where.occurredAt.gte = from;
    if (to) where.occurredAt.lte = to;
  }

  const [total, rows] = await Promise.all([
    prisma.alarm.count({ where }),
    prisma.alarm.findMany({
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
        deviceName: a.inverter?.name ?? (a.raw as any)?.devName ?? null,
        alarmName: a.name,
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

  const where: any = {};
  if (tab === 'active') {
    where.status = 'ACTIVE';
    where.clearedAt = null;
  } else if (tab === 'historical') {
    where.status = 'CLEARED';
    where.clearedAt = { not: null };
  }

  if (Number.isFinite(siteId as any)) where.siteId = siteId;
  if (Number.isFinite(inverterId as any)) where.inverterId = inverterId;
  if (Number.isFinite(severity as any)) where.severity = severity;
  if (q) where.name = { contains: q, mode: 'insensitive' };
  if (alarmId) where.raw = { path: ['alarmId'], equals: alarmId };

  if (sn) {
    const inv = await prisma.inverter.findUnique({ where: { serialNumber: sn }, select: { id: true } });
    if (inv?.id) where.inverterId = inv.id;
    else {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="alarms.csv"`);
      return res.send('id,severity,plantName,deviceName,alarmName,alarmId,occurredAt,clearedAt,status\n');
    }
  }

  if (from || to) {
    where.occurredAt = {};
    if (from) where.occurredAt.gte = from;
    if (to) where.occurredAt.lte = to;
  }

  const rows = await prisma.alarm.findMany({
    where,
    orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
    include: { site: true, inverter: true },
    take: 50_000,
  });

  const esc = (v: any) => {
    const s = v == null ? '' : String(v);
    const needs = /[",\n]/.test(s);
    const body = s.replace(/"/g, '""');
    return needs ? `"${body}"` : body;
  };

  const header = ['id', 'severity', 'plantName', 'deviceName', 'alarmName', 'alarmId', 'occurredAt', 'clearedAt', 'status'];
  const lines = [header.join(',')];
  for (const a of rows) {
    lines.push(
      [
        a.id,
        a.severity ?? '',
        a.site?.name ?? '',
        a.inverter?.name ?? (a.raw as any)?.devName ?? '',
        a.name ?? '',
        (a.raw as any)?.alarmId ?? '',
        a.occurredAt ? a.occurredAt.toISOString() : '',
        a.clearedAt ? a.clearedAt.toISOString() : '',
        a.status ?? '',
      ]
        .map(esc)
        .join(',')
    );
  }

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="alarms-${tab}.csv"`);
  res.send(lines.join('\n'));
});

export default router;