// src/routes/homepageRoutes.ts
import { Router } from 'express';
import prisma from '../config/prisma';
export const homepageRoutes = Router();

function calcPlantStatusFromHealth(healthState: number | null | undefined): 'Normal' | 'Faulty' | 'Disconnected' {
  if (healthState === 3) return 'Normal';
  if (healthState === 2) return 'Faulty';
  if (healthState === 1) return 'Disconnected';
  return 'Disconnected';
}

function calcPlantStatus(inverters: { status: string | null; lastSyncAt: Date | null }[]) {
  if (!inverters || inverters.length === 0) return 'Disconnected';

  const neverSyncedAll = inverters.every((inv) => !inv.lastSyncAt);
  if (neverSyncedAll) return 'Disconnected';

  const faulty = inverters.some((inv) => String(inv.status ?? '').toLowerCase() === 'fault');
  if (faulty) return 'Faulty';

  return 'Normal';
}

function safeNum(n: any) {
  const x = Number(n);
  return Number.isFinite(x) ? x : 0;
}

/**
 * GET /api/homepage/summary
 * สำหรับกราฟวงกลม Plant Status + Active Alarms + Notification Alarms (placeholder)
 */
homepageRoutes.get('/summary', async (_req, res) => {
  try {
    const sites = (await prisma.site.findMany({
      select: { id: true, plantHealthState: true },
      take: 5000,
    } as any)) as any[];

    let normal = 0;
    let faulty = 0;
    let disconnected = 0;

    for (const s of sites) {
      const st = calcPlantStatusFromHealth(s.plantHealthState);
      if (st === 'Normal') normal++;
      else if (st === 'Faulty') faulty++;
      else disconnected++;
    }

    const active = await prisma.alarm.findMany({
      where: { status: 'ACTIVE', clearedAt: null },
      select: { severity: true },
      take: 500000,
    });

    const alarms = {
      critical: active.filter((a) => Number(a.severity) === 4).length,
      major: active.filter((a) => Number(a.severity) === 3).length,
      minor: active.filter((a) => Number(a.severity) === 2).length,
      warning: active.filter((a) => Number(a.severity) === 1).length,
      supported: true,
    };

    const latest = await prisma.alarm.findMany({
      where: { status: 'ACTIVE', clearedAt: null },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: 5,
      include: { site: true, inverter: true },
    });
    const notifications = latest.map((a) => ({
      plantName: a.site?.name ?? null,
      detail: a.name,
      severity: a.severity,
      occurredAt: a.occurredAt,
      inverterName: a.inverter?.name ?? null,
    }));

    res.json({
      success: true,
      data: {
        plantStatus: { normal, faulty, disconnected },
        activeAlarms: alarms,
        notificationAlarms: notifications,
      },
    });
  } catch (e: any) {
    res.status(500).json({ success: false, message: e?.message ?? 'Internal error' });
  }
});

/**
 * GET /api/homepage/plants
 * Query:
 *  - q: search by plant name
 *  - page, pageSize
 */
homepageRoutes.get('/plants', async (req, res) => {
  try {
    const q = String(req.query.q ?? '').trim();
    const page = Math.max(1, Number(req.query.page ?? 1));
    const pageSize = Math.min(100, Math.max(10, Number(req.query.pageSize ?? 20)));
    const skip = (page - 1) * pageSize;

    const where: any = {};
    if (q) {
      where.OR = [{ name: { contains: q, mode: 'insensitive' } }, { plantCode: { contains: q, mode: 'insensitive' } }];
    }

    const [total, sites] = await Promise.all([
      prisma.site.count({ where }),
      prisma.site.findMany({
        where,
        orderBy: [{ name: 'asc' }],
        skip,
        take: pageSize,
        select: {
          id: true,
          plantCode: true,
          name: true,
          address: true,
          capacityKWp: true,
          updatedAt: true,
          gridConnectionDate: true,
          currentPowerKW: true,
          dayEnergyKWh: true,
          totalEnergyKWh: true,
          plantHealthState: true,
        },
      } as any) as any,
    ]);

    const siteIds = sites.map((s: any) => s.id);
    const invs = await prisma.inverter.findMany({
      where: { siteId: { in: siteIds } },
      select: { siteId: true, activePower: true, status: true, lastSyncAt: true },
    });

    const invBySite = new Map<number, typeof invs>();
    for (const inv of invs) {
      if (!invBySite.has(inv.siteId)) invBySite.set(inv.siteId, []);
      invBySite.get(inv.siteId)!.push(inv);
    }

    const list = sites.map((s: any) => {
      const invList = invBySite.get(s.id) ?? [];
      const fallbackCurrentPowerKW = invList.reduce((sum, inv) => sum + safeNum(inv.activePower), 0);

      const status = s.plantHealthState != null ? calcPlantStatusFromHealth(s.plantHealthState) : calcPlantStatus(invList);
      const yieldTodayKWh = safeNum(s.dayEnergyKWh);
      const capacity = safeNum(s.capacityKWp);
      const specificEnergy = capacity > 0 ? yieldTodayKWh / capacity : 0;
      const currentPowerKW = s.currentPowerKW != null ? safeNum(s.currentPowerKW) : fallbackCurrentPowerKW;

      return {
        siteId: s.id,
        plantCode: s.plantCode,
        plantName: s.name,
        address: s.address,
        status,
        gridConnectionDate: s.gridConnectionDate,
        totalStringCapacityKWp: capacity,
        optimizerQuantity: null,
        currentPowerKW: Number(currentPowerKW.toFixed(3)),
        specificEnergyKWhPerKWp: Number(specificEnergy.toFixed(4)),
        yieldTodayKWh: Number(yieldTodayKWh.toFixed(3)),
        totalYieldKWh: s.totalEnergyKWh != null ? Number(safeNum(s.totalEnergyKWh).toFixed(3)) : null,
        performanceRatio: null,
        lastUpdatedAt: s.updatedAt,
      };
    });

    res.json({
      success: true,
      data: {
        list,
        pagination: {
          page,
          pageSize,
          total,
          totalPages: Math.ceil(total / pageSize),
        },
      },
    });
  } catch (e: any) {
    res.status(500).json({ success: false, message: e?.message ?? 'Internal error' });
  }
});
