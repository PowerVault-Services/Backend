// src/routes/alarmRoutes.ts
import { Router } from 'express';
import prisma from '../config/prisma';

const alarmRoutes = Router();

function parseDateParam(v: any): Date | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;

  // numeric ms
  if (/^\d{10,13}$/.test(s)) {
    const ms = Number(s);
    if (!Number.isFinite(ms)) return null;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  // ISO date string
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * GET /api/alarms
 * Query:
 *  - tab=active|history
 *  - project (plant name)
 *  - sn (inverter serial)
 *  - alarmName
 *  - alarmId (Huawei alarmId inside raw.alarmId)
 *  - severity (1-4)
 *  - from,to (ISO string or ms) -> filter occurredAt
 *  - page,pageSize
 */
alarmRoutes.get('/', async (req, res) => {
  try {
    const tab = String(req.query.tab ?? 'active'); // active|history

    const project = String(req.query.project ?? '').trim();
    const sn = String(req.query.sn ?? '').trim();
    const alarmName = String(req.query.alarmName ?? '').trim();
    const alarmId = String(req.query.alarmId ?? '').trim();
    const severity = req.query.severity != null ? Number(req.query.severity) : null;

    const from = parseDateParam(req.query.from);
    const to = parseDateParam(req.query.to);

    const page = Math.max(1, Number(req.query.page ?? 1));
    const pageSize = Math.min(100, Math.max(10, Number(req.query.pageSize ?? 20)));
    const skip = (page - 1) * pageSize;

    const where: any = {};


    if (tab === 'active') where.clearedAt = null;
    else if (tab === 'history') where.clearedAt = { not: null };
    else return res.status(400).json({ success: false, message: 'Invalid tab' });
    if (severity != null && Number.isFinite(severity)) where.severity = severity;
    if (alarmName) where.name = { contains: alarmName, mode: 'insensitive' };
    if (project) where.site = { name: { contains: project, mode: 'insensitive' } };
    if (sn) where.inverter = { serialNumber: { contains: sn, mode: 'insensitive' } };
    if (alarmId) {
      const n = Number(alarmId);
      if (Number.isFinite(n)) where.raw = { path: ['alarmId'], equals: n };
      else where.raw = { path: ['alarmId'], equals: alarmId }; // เผื่อบาง tenant ส่งเป็น string
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
        select: {
          id: true,
          name: true,
          severity: true,
          status: true,
          occurredAt: true,
          clearedAt: true,
          site: { select: { id: true, name: true, plantCode: true } },
          inverter: { select: { id: true, name: true, serialNumber: true } },
          raw: true,
        },
      }),
    ]);

    res.json({
      success: true,
      data: {
        list: rows,
        pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
      },
    });
  } catch (e: any) {
    res.status(500).json({ success: false, message: e?.message ?? 'Internal error' });
  }
});

export default alarmRoutes;
