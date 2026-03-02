	import { Router } from 'express';
	import prisma from '../config/prisma';

	const router = Router();

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
