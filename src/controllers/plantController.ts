import { PrismaClient, ProjectStatus } from '@prisma/client';
import { Request, Response } from 'express';

const prisma = new PrismaClient();

function toNumber(v: any): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toDate(v: any): Date | null {
  if (!v) return null;
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? null : d;
}

// =====================================================
// LIST client-only plants
// =====================================================

/** GET /api/client-data/plants */
export async function listPlants(req: Request, res: Response) {
  const projectNo = String(req.query.projectNo ?? '').trim();
  const projectName = String(req.query.projectName ?? '').trim();
  const company = String(req.query.company ?? '').trim();
  const status = String(req.query.status ?? '').trim().toUpperCase();

  const page = Math.max(1, Number(req.query.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize ?? 10)));
  const skip = (page - 1) * pageSize;

  const where: any = { isClientOnly: true };
  if (projectNo) where.plantCode = { contains: projectNo, mode: 'insensitive' };
  if (projectName) where.name = { contains: projectName, mode: 'insensitive' };
  if (company) where.companyName = { contains: company, mode: 'insensitive' };
  if (status && Object.values(ProjectStatus).includes(status as any)) {
    where.projectStatus = status as any;
  }

  const [total, rows] = await Promise.all([
    prisma.site.count({ where }),
    prisma.site.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: pageSize,
      select: {
        id: true,
        plantCode: true,
        name: true,
        companyName: true,
        projectTypeText: true,
        capacityKWp: true,
        locationProvince: true,
        codDate: true,
        projectStatus: true,
        createdAt: true,
      },
    }),
  ]);

  res.json({
    success: true,
    data: {
      page,
      pageSize,
      total,
      items: rows.map((r) => ({
        siteId: r.id,
        projectNo: r.plantCode,
        projectName: r.name,
        company: r.companyName,
        type: r.projectTypeText,
        systemSizeKWp: r.capacityKWp,
        locationProvince: r.locationProvince,
        codDate: r.codDate,
        status: r.projectStatus,
        createdAt: r.createdAt,
      })),
    },
  });
}

// =====================================================
// GET single plant detail
// =====================================================

/** GET /api/client-data/plants/:siteId */
export async function getPlantDetail(req: Request, res: Response) {
  const siteId = Number(req.params.siteId);
  if (!siteId) return res.status(400).json({ success: false, message: 'siteId is required' });

  const site = await prisma.site.findUnique({
    where: { id: siteId },
  });

  if (!site || !site.isClientOnly) {
    return res.status(404).json({ success: false, message: 'Plant not found' });
  }

  res.json({
    success: true,
    data: {
      siteId: site.id,
      projectNo: site.plantCode,
      projectName: site.name,
      company: site.companyName,
      ecpPpa: site.ecpPpa,
      type: site.projectTypeText,
      address: site.address,
      locationProvince: site.locationProvince,
      freeOmText: site.freeOmText,
      warrantyOutputPct: site.warrantyOutputPct,
      codDate: site.codDate,
      systemSizeKWp: site.capacityKWp,
      solarPanel: site.panelModel,
      panelBrand: site.panelBrand,
      panelSizeW: site.panelWatt,
      salePerson: site.salePerson,
      siteEngineer: site.siteEngineer,
      installationContractor: site.installationContractor,
      workEntryConditions: site.workEntryConditions,
      contactEmail: site.contactEmail,
      contactPhone: site.contactPhone,
      status: site.projectStatus,
      createdAt: site.createdAt,
    },
  });
}

// =====================================================
// CREATE plant (client-only, not synced)
// =====================================================

/** POST /api/client-data/plants */
export async function createPlant(req: Request, res: Response) {
  const body = req.body ?? {};

  const plantCode = String(body.plantCode ?? body.projectNo ?? '').trim();
  const name = String(body.name ?? body.projectName ?? '').trim();
  const capacityKWp = toNumber(
    body.capacityKWp ?? body.capacityKwp ?? body.systemSizeKWp ?? body.systemSizeKwp ?? 0,
  );

  if (!plantCode) return res.status(400).json({ success: false, message: 'plantCode (projectNo) is required' });
  if (!name) return res.status(400).json({ success: false, message: 'name (projectName) is required' });

  const projectStatus = String(body.projectStatus ?? body.status ?? 'ACTIVE').toUpperCase();
  const statusVal = Object.values(ProjectStatus).includes(projectStatus as any)
    ? (projectStatus as any)
    : ProjectStatus.ACTIVE;

  try {
    const created = await prisma.site.create({
      data: {
        plantCode,
        name,
        capacityKWp: capacityKWp ?? 0,
        isClientOnly: true,
        projectStatus: statusVal,
        companyName: body.companyName ?? body.company ?? null,
        ecpPpa: body.ecpPpa ?? null,
        projectTypeText: body.projectTypeText ?? body.type ?? null,
        address: body.address ?? null,
        locationProvince: body.locationProvince ?? null,
        freeOmText: body.freeOmText ?? null,
        warrantyOutputPct: toNumber(body.warrantyOutputPct ?? body.warrantyOutput) ?? null,
        codDate: toDate(body.codDate) ?? null,
        panelModel: body.panelModel ?? body.solarPanel ?? null,
        panelBrand: body.panelBrand ?? null,
        panelWatt: toNumber(body.panelWatt ?? body.panelSizeW) ?? null,
        salePerson: body.salePerson ?? null,
        siteEngineer: body.siteEngineer ?? null,
        installationContractor: body.installationContractor ?? null,
        workEntryConditions: body.workEntryConditions ?? null,
        contactEmail: body.contactEmail ?? null,
        contactPhone: body.contactPhone ?? null,
      },
      select: {
        id: true,
        plantCode: true,
        name: true,
        companyName: true,
        projectTypeText: true,
        capacityKWp: true,
        locationProvince: true,
        codDate: true,
        projectStatus: true,
        createdAt: true,
      },
    });

    res.json({
      success: true,
      data: {
        siteId: created.id,
        projectNo: created.plantCode,
        projectName: created.name,
        company: created.companyName,
        type: created.projectTypeText,
        systemSizeKWp: created.capacityKWp,
        locationProvince: created.locationProvince,
        codDate: created.codDate,
        status: created.projectStatus,
        createdAt: created.createdAt,
      },
    });
  } catch (err: any) {
    if (err?.code === 'P2002') {
      return res.status(409).json({ success: false, message: 'plantCode already exists' });
    }
    res.status(500).json({ success: false, message: err?.message ?? 'Create plant failed' });
  }
}

// =====================================================
// UPDATE plant
// =====================================================

/** PUT /api/client-data/plants/:siteId */
export async function updatePlant(req: Request, res: Response) {
  const siteId = Number(req.params.siteId);
  const body = req.body ?? {};
  if (!siteId) return res.status(400).json({ success: false, message: 'siteId is required' });

  const existing = await prisma.site.findUnique({ where: { id: siteId }, select: { isClientOnly: true } });
  if (!existing || !existing.isClientOnly) {
    return res.status(404).json({ success: false, message: 'Plant not found' });
  }

  const projectStatus = body.projectStatus ?? body.status;
  const statusVal =
    projectStatus && Object.values(ProjectStatus).includes(String(projectStatus).toUpperCase() as any)
      ? (String(projectStatus).toUpperCase() as any)
      : undefined;

  try {
    const updated = await prisma.site.update({
      where: { id: siteId },
      data: {
        plantCode: body.plantCode ?? body.projectNo ?? undefined,
        name: body.name ?? body.projectName ?? undefined,
        capacityKWp: toNumber(body.capacityKWp ?? body.capacityKwp ?? body.systemSizeKWp) ?? undefined,
        projectStatus: statusVal,
        companyName: body.companyName ?? body.company ?? undefined,
        ecpPpa: body.ecpPpa ?? undefined,
        projectTypeText: body.projectTypeText ?? body.type ?? undefined,
        address: body.address ?? undefined,
        locationProvince: body.locationProvince ?? undefined,
        freeOmText: body.freeOmText ?? undefined,
        warrantyOutputPct: toNumber(body.warrantyOutputPct ?? body.warrantyOutput) ?? undefined,
        codDate: toDate(body.codDate) ?? undefined,
        panelModel: body.panelModel ?? body.solarPanel ?? undefined,
        panelBrand: body.panelBrand ?? undefined,
        panelWatt: toNumber(body.panelWatt ?? body.panelSizeW) ?? undefined,
        salePerson: body.salePerson ?? undefined,
        siteEngineer: body.siteEngineer ?? undefined,
        installationContractor: body.installationContractor ?? undefined,
        workEntryConditions: body.workEntryConditions ?? undefined,
        contactEmail: body.contactEmail ?? undefined,
        contactPhone: body.contactPhone ?? undefined,
      },
      select: {
        id: true,
        plantCode: true,
        name: true,
        companyName: true,
        projectTypeText: true,
        capacityKWp: true,
        locationProvince: true,
        codDate: true,
        projectStatus: true,
      },
    });

    res.json({
      success: true,
      data: {
        siteId: updated.id,
        projectNo: updated.plantCode,
        projectName: updated.name,
        company: updated.companyName,
        type: updated.projectTypeText,
        systemSizeKWp: updated.capacityKWp,
        locationProvince: updated.locationProvince,
        codDate: updated.codDate,
        status: updated.projectStatus,
      },
    });
  } catch (err: any) {
    if (err?.code === 'P2002') {
      return res.status(409).json({ success: false, message: 'plantCode already exists' });
    }
    res.status(500).json({ success: false, message: err?.message ?? 'Update plant failed' });
  }
}

// =====================================================
// DELETE plant
// =====================================================

/** DELETE /api/client-data/plants/:siteId */
export async function deletePlant(req: Request, res: Response) {
  const siteId = Number(req.params.siteId);
  if (!siteId) return res.status(400).json({ success: false, message: 'siteId is required' });

  const existing = await prisma.site.findUnique({ where: { id: siteId }, select: { isClientOnly: true } });
  if (!existing || !existing.isClientOnly) {
    return res.status(404).json({ success: false, message: 'Plant not found' });
  }

  try {
    await prisma.site.delete({ where: { id: siteId } });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err?.message ?? 'Delete plant failed' });
  }
}
