// src/routes/homepageRoutes.ts
import { Router } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
export const homepageRoutes = Router();

function calcPlantStatus(inverters: { status: string | null; lastSyncAt: Date | null }[]) {
  if (!inverters || inverters.length === 0) return 'Disconnected';

  // อย่าตัด Disconnected ด้วย threshold เวลา เพราะ cron อาจ sync ทีละ plant
  // ถ้ายังไม่เคย sync เลย (lastSyncAt = null ทุกตัว) ค่อยถือว่า disconnected
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
    // 1) Plant status counts (derive จาก inverter)
    const sites = await prisma.site.findMany({
      select: { id: true, plantCode: true, name: true },
      take: 5000,
    });

    // ดึง inverter เฉพาะ field ที่ใช้คำนวณ
    const siteIds = sites.map((s) => s.id);
    const inverters = await prisma.inverter.findMany({
      where: { siteId: { in: siteIds } },
      select: { siteId: true, status: true, lastSyncAt: true },
    });

    const bySite = new Map<number, { status: string | null; lastSyncAt: Date | null }[]>();
    for (const inv of inverters) {
      if (!bySite.has(inv.siteId)) bySite.set(inv.siteId, []);
      bySite.get(inv.siteId)!.push({ status: inv.status, lastSyncAt: inv.lastSyncAt });
    }

    let normal = 0;
    let faulty = 0;
    let disconnected = 0;

    for (const s of sites) {
      const list = bySite.get(s.id) ?? [];
      const st = calcPlantStatus(list);
      if (st === 'Normal') normal++;
      else if (st === 'Faulty') faulty++;
      else disconnected++;
    }

    // 2) Active alarms (ยังไม่มี sync) -> placeholder
    const alarms = {
      critical: 0,
      major: 0,
      minor: 0,
      warning: 0,
      supported: false, // บอก FE ว่ายังไม่พร้อม
    };

    // 3) Notification alarms list (ยังไม่มี sync) -> placeholder
    const notifications: any[] = [];

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
 *
 * Returns:
 *  - list: ตาราง plant
 *  - pagination
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
        },
      }),
    ]);

    const siteIds = sites.map((s) => s.id);

    // ดึง inverter เพื่อ sum current power + status
    const invs = await prisma.inverter.findMany({
      where: { siteId: { in: siteIds } },
      select: { siteId: true, activePower: true, status: true, lastSyncAt: true },
    });

    const invBySite = new Map<number, typeof invs>();
    for (const inv of invs) {
      if (!invBySite.has(inv.siteId)) invBySite.set(inv.siteId, []);
      invBySite.get(inv.siteId)!.push(inv);
    }

    // yield today (จาก SiteDailyEnergy วันนี้)
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const energyRows = await prisma.siteDailyEnergy.findMany({
      where: { siteId: { in: siteIds }, date: today },
      select: { siteId: true, yieldKWh: true },
    });
    const energyMap = new Map<number, number>();
    for (const r of energyRows) energyMap.set(r.siteId, safeNum(r.yieldKWh));

    // total yield: ตอนนี้คุณยังไม่ได้เก็บเป็น site-level
    // เราจะคำนวณแบบ “รวม totalEnergy ล่าสุดของแต่ละ inverter” (ถ้ามี)
    // (ถ้าไม่มี field นี้ก็จะได้ 0)
    const latestSnaps = await prisma.inverterKpiSnapshot.findMany({
      where: { inverter: { siteId: { in: siteIds } } },
      orderBy: [{ ts: 'desc' }],
      select: { inverterId: true, totalEnergy: true, ts: true },
      take: 20000,
    });

    // เลือก snapshot ล่าสุดต่อ inverter (เอาอันแรกที่เจอเพราะ order desc)
    const latestTotalByInv = new Map<number, number>();
    for (const s of latestSnaps) {
      if (!latestTotalByInv.has(s.inverterId) && s.totalEnergy != null) {
        latestTotalByInv.set(s.inverterId, safeNum(s.totalEnergy));
      }
    }

    // map inverterId -> siteId
    const invIdToSiteId = new Map<number, number>();
    for (const inv of invs) {
      // inverter.id ไม่ได้ select มา ต้องหาอีกรอบถ้าต้องการละเอียดมาก
      // ทางออก minimal: ไม่ใช้ invIdToSiteId (คำนวณ total yield แบบ 0 ไปก่อน)
    }

    // ใน mode minimal: totalYieldKWh จะเป็น 0 จนกว่าจะทำ phase 2 (เก็บ site-level total yield)
    // ถ้าคุณต้องการเปิด totalYield แบบคำนวณจริง ให้ผมปรับ select inverter.id แล้วรวมจาก latestTotalByInv ได้
    const list = sites.map((s) => {
      const invList = invBySite.get(s.id) ?? [];
      // activePower ใน DB เก็บเป็น kW แล้ว (อ้างอิงจากค่าที่เห็น เช่น 8.266)
      const currentPowerKW = invList.reduce((sum, inv) => sum + safeNum(inv.activePower), 0);

      const status = calcPlantStatus(invList.map((x) => ({ status: x.status, lastSyncAt: x.lastSyncAt })));
      const yieldTodayKWh = energyMap.get(s.id) ?? 0;

      const capacity = safeNum(s.capacityKWp);
      const specificEnergy = capacity > 0 ? yieldTodayKWh / capacity : 0;

      return {
        siteId: s.id,
        plantCode: s.plantCode,
        plantName: s.name,
        address: s.address,
        status, // Normal/Faulty/Disconnected
        gridConnectionDate: null, // phase 2: ต้องเก็บจาก /thirdData/stations
        totalStringCapacityKWp: capacity, // ใช้ capacity แทนชั่วคราว
        optimizerQuantity: null, // phase 2: นับจาก getDevList devType optimizer
        currentPowerKW: Number(currentPowerKW.toFixed(3)),
        specificEnergyKWhPerKWp: Number(specificEnergy.toFixed(4)),
        yieldTodayKWh: Number(yieldTodayKWh.toFixed(3)),
        totalYieldKWh: null, // phase 2: เก็บ site-level หรือ sum จาก inverter totalEnergy
        performanceRatio: null, // phase 2: ต้องมี expected/irradiance ฯลฯ
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
