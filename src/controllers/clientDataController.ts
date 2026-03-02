import {
  LayoutType,
  PrismaClient,
  ProjectStatus,
  JobType,
} from '@prisma/client';
import { Request, Response } from 'express';
import path from 'path';

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

function parseLayoutType(typeParam: string): LayoutType | null {
  const t = String(typeParam || '').toUpperCase();
  if (t === 'PV_LAYOUT') return LayoutType.PV_LAYOUT;
  if (t === 'PV_STRING_LAYOUT') return LayoutType.PV_STRING_LAYOUT;
  return null;
}

// =====================================================
// LIST: PowerVault (Thailand)
// =====================================================

/**
 * GET /api/client-data/thailand/projects
 * Query:
 *  - projectNo (maps to Site.plantCode)
 *  - projectName (Site.name)
 *  - systemSizeKWp (Site.capacityKWp exact)
 *  - endWarrantyBefore (ISO date)
 *  - status (ACTIVE/INACTIVE/MAINTENANCE)
 *  - page, pageSize
 */
export async function listProjectsThailand(req: Request, res: Response) {
  const projectNo = String(req.query.projectNo ?? '').trim();
  const projectName = String(req.query.projectName ?? '').trim();
  const systemSizeKWp = toNumber(req.query.systemSizeKWp);
  const endWarrantyBefore = toDate(req.query.endWarrantyBefore);
  const status = String(req.query.status ?? '').trim().toUpperCase();

  const page = Math.max(1, Number(req.query.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize ?? 10)));
  const skip = (page - 1) * pageSize;

  const where: any = {};
  if (projectNo) where.plantCode = { contains: projectNo, mode: 'insensitive' };
  if (projectName) where.name = { contains: projectName, mode: 'insensitive' };
  if (systemSizeKWp !== null) where.capacityKWp = systemSizeKWp;
  if (endWarrantyBefore) where.warrantyEnd = { lte: endWarrantyBefore };
  if (status && Object.values(ProjectStatus).includes(status as any)) {
    where.projectStatus = status as any;
  }

  const [total, rows] = await Promise.all([
    prisma.site.count({ where }),
    prisma.site.findMany({
      where,
      orderBy: { name: 'asc' },
      skip,
      take: pageSize,
      select: {
        id: true,
        plantCode: true,
        name: true,
        capacityKWp: true,
        warrantyEnd: true,
        projectStatus: true,
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
        systemSizeKWp: r.capacityKWp,
        endWarranty: r.warrantyEnd,
        status: r.projectStatus,
      })),
    },
  });
}

// =====================================================
// LIST: PowerVault Service (table with Job + Description)
// =====================================================

/**
 * GET /api/client-data/service/entries
 * Query:
 *  - projectNo, projectName, systemSizeKWp
 *  - job (SERVICE/CLEANING/INSPECTION/OM)
 *  - page, pageSize
 */
export async function listProjectsService(req: Request, res: Response) {
  const projectNo = String(req.query.projectNo ?? '').trim();
  const projectName = String(req.query.projectName ?? '').trim();
  const systemSizeKWp = toNumber(req.query.systemSizeKWp);
  const job = String(req.query.job ?? '').trim().toUpperCase();

  const page = Math.max(1, Number(req.query.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize ?? 10)));
  const skip = (page - 1) * pageSize;

  const where: any = {
    site: {},
  };
  if (projectNo) where.site.plantCode = { contains: projectNo, mode: 'insensitive' };
  if (projectName) where.site.name = { contains: projectName, mode: 'insensitive' };
  if (systemSizeKWp !== null) where.site.capacityKWp = systemSizeKWp;
  if (job && Object.values(JobType).includes(job as any)) where.job = job as any;

  const [total, rows] = await Promise.all([
    prisma.serviceEntry.count({ where }),
    prisma.serviceEntry.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: pageSize,
      include: {
        site: {
          select: { id: true, plantCode: true, name: true, capacityKWp: true },
        },
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
        entryId: r.id,
        siteId: r.siteId,
        projectNo: r.site.plantCode,
        projectName: r.site.name,
        systemSizeKWp: r.site.capacityKWp,
        job: r.job,
        description: r.description,
        createdAt: r.createdAt,
      })),
    },
  });
}

// =====================================================
// PROJECT CRUD (Site)
// =====================================================

/** POST /api/client-data/thailand/projects */
export async function createProject(req: Request, res: Response) {
  const body = req.body ?? {};

  const plantCode = String(body.plantCode ?? body.projectNo ?? '').trim();
  const name = String(body.name ?? body.projectName ?? '').trim();
  // UI payload uses `capacityKwp` (lowercase p) while our DB field is `capacityKWp`.
  // Accept both to keep frontend + backend in sync.
  const capacityKWp = toNumber(
    body.capacityKWp ??
      body.capacityKwp ??
      body.systemSizeKWp ??
      body.systemSizeKwp,
  );
  if (!plantCode) return res.status(400).json({ success: false, message: 'plantCode (projectNo) is required' });
  if (!name) return res.status(400).json({ success: false, message: 'name (projectName) is required' });
  if (capacityKWp === null) {
    return res
      .status(400)
      .json({ success: false, message: 'capacityKWp (capacityKwp / systemSizeKWp) is required' });
  }

  const projectStatus = String(body.projectStatus ?? body.status ?? 'ACTIVE').toUpperCase();
  const statusVal = Object.values(ProjectStatus).includes(projectStatus as any)
    ? (projectStatus as any)
    : ProjectStatus.ACTIVE;

  try {
    const created = await prisma.site.create({
      data: {
        plantCode,
        name,
        capacityKWp,
        address: body.address ?? null,
        latitude: toNumber(body.latitude) ?? null,
        longitude: toNumber(body.longitude) ?? null,
        pvModuleCount: toNumber(body.pvModuleCount ?? body.pvModuleEA) ?? null,
        contactPhone: body.contactPhone ?? null,
        contactEmail: body.contactEmail ?? null,
        projectStatus: statusVal,
        warrantyStart: toDate(body.warrantyStart ?? body.startWarranty) ?? null,
        warrantyEnd: toDate(body.warrantyEnd ?? body.endWarranty) ?? null,
        companyName: body.companyName ?? null,
        ecpPpa: body.ecpPpa ?? null,
        projectTypeText: body.projectTypeText ?? body.type ?? null,
        freeOmText: body.freeOmText ?? null,
        warrantyOutputPct: toNumber(body.warrantyOutputPct ?? body.warrantyOutput) ?? null,
        codDate: toDate(body.codDate) ?? null,
        panelBrand: body.panelBrand ?? null,
        panelModel: body.panelModel ?? null,
        panelWatt: toNumber(body.panelWatt) ?? null,
        inverterCount: toNumber(body.inverterCount ?? body.inverterEA) ?? null,
        inverterBrand: body.inverterBrand ?? null,
        siteEngineer: body.siteEngineer ?? null,
        responsiblePerson1: body.responsiblePerson1 ?? null,
        responsiblePerson2: body.responsiblePerson2 ?? null,
        remark: body.remark ?? null,
        siteImageUrl: body.siteImageUrl ?? null,
      },
      select: {
        id: true,
        plantCode: true,
        name: true,
        capacityKWp: true,
        warrantyEnd: true,
        projectStatus: true,
      },
    });

    // Return the same shape as the table row so UI can append without an extra GET.
    res.json({
      success: true,
      data: {
        siteId: created.id,
        projectNo: created.plantCode,
        projectName: created.name,
        systemSizeKWp: created.capacityKWp,
        endWarranty: created.warrantyEnd,
        status: created.projectStatus,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err?.message ?? 'Create project failed' });
  }
}

/** PUT /api/client-data/thailand/projects/:siteId */
export async function updateProject(req: Request, res: Response) {
  const siteId = Number(req.params.siteId);
  const body = req.body ?? {};
  if (!siteId) return res.status(400).json({ success: false, message: 'siteId is required' });

  const projectStatus = body.projectStatus ?? body.status;
  const statusVal = projectStatus && Object.values(ProjectStatus).includes(String(projectStatus).toUpperCase() as any)
    ? (String(projectStatus).toUpperCase() as any)
    : undefined;

  try {
    const updated = await prisma.site.update({
      where: { id: siteId },
      data: {
        plantCode: body.plantCode ?? body.projectNo ?? undefined,
        name: body.name ?? body.projectName ?? undefined,
        capacityKWp:
          toNumber(
            body.capacityKWp ??
              body.capacityKwp ??
              body.systemSizeKWp ??
              body.systemSizeKwp,
          ) ?? undefined,
        address: body.address ?? undefined,
        latitude: toNumber(body.latitude) ?? undefined,
        longitude: toNumber(body.longitude) ?? undefined,
        pvModuleCount: toNumber(body.pvModuleCount ?? body.pvModuleEA) ?? undefined,
        contactPhone: body.contactPhone ?? undefined,
        contactEmail: body.contactEmail ?? undefined,
        projectStatus: statusVal,
        warrantyStart: toDate(body.warrantyStart ?? body.startWarranty) ?? undefined,
        warrantyEnd: toDate(body.warrantyEnd ?? body.endWarranty) ?? undefined,
        companyName: body.companyName ?? undefined,
        ecpPpa: body.ecpPpa ?? undefined,
        projectTypeText: body.projectTypeText ?? body.type ?? undefined,
        freeOmText: body.freeOmText ?? undefined,
        warrantyOutputPct: toNumber(body.warrantyOutputPct ?? body.warrantyOutput) ?? undefined,
        codDate: toDate(body.codDate) ?? undefined,
        panelBrand: body.panelBrand ?? undefined,
        panelModel: body.panelModel ?? undefined,
        panelWatt: toNumber(body.panelWatt) ?? undefined,
        inverterCount: toNumber(body.inverterCount ?? body.inverterEA) ?? undefined,
        inverterBrand: body.inverterBrand ?? undefined,
        siteEngineer: body.siteEngineer ?? undefined,
        responsiblePerson1: body.responsiblePerson1 ?? undefined,
        responsiblePerson2: body.responsiblePerson2 ?? undefined,
        remark: body.remark ?? undefined,
        siteImageUrl: body.siteImageUrl ?? undefined,
      },
      select: {
        id: true,
        plantCode: true,
        name: true,
        capacityKWp: true,
        warrantyEnd: true,
        projectStatus: true,
      },
    });

    res.json({
      success: true,
      data: {
        siteId: updated.id,
        projectNo: updated.plantCode,
        projectName: updated.name,
        systemSizeKWp: updated.capacityKWp,
        endWarranty: updated.warrantyEnd,
        status: updated.projectStatus,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err?.message ?? 'Update project failed' });
  }
}

/** DELETE /api/client-data/thailand/projects/:siteId */
export async function deleteProject(req: Request, res: Response) {
  const siteId = Number(req.params.siteId);
  if (!siteId) return res.status(400).json({ success: false, message: 'siteId is required' });

  try {
    await prisma.site.delete({ where: { id: siteId } });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err?.message ?? 'Delete project failed' });
  }
}

// =====================================================
// PROJECT DETAIL (all tabs)
// =====================================================

/** GET /api/client-data/projects/:siteId */
export async function getProjectDetail(req: Request, res: Response) {
  const siteId = Number(req.params.siteId);
  if (!siteId) return res.status(400).json({ success: false, message: 'siteId is required' });

  const site = await prisma.site.findUnique({
    where: { id: siteId },
    include: {
      warrantySupplierItems: { orderBy: [{ category: 'asc' }, { itemName: 'asc' }] },
      warrantyCustomerItems: { orderBy: [{ category: 'asc' }, { itemName: 'asc' }] },
      layouts: true,
      forecastMonthly: { orderBy: { month: 'asc' } },
      forecastYearly: { orderBy: { year: 'asc' } },
      otherRows: { orderBy: { createdAt: 'desc' } },
      serviceEntries: { orderBy: { createdAt: 'desc' } },
    },
  });

  if (!site) return res.status(404).json({ success: false, message: 'Project not found' });

  res.json({ success: true, data: site });
}

// =====================================================
// WARRANTY CRUD
// =====================================================

export async function createWarrantySupplierItem(req: Request, res: Response) {
  const siteId = Number(req.params.siteId);
  const body = req.body ?? {};
  if (!siteId) return res.status(400).json({ success: false, message: 'siteId is required' });
  if (!body.category || !body.itemName) {
    return res.status(400).json({ success: false, message: 'category and itemName are required' });
  }

  const created = await prisma.siteWarrantySupplierItem.create({
    data: {
      siteId,
      category: String(body.category),
      itemName: String(body.itemName),
      supplierName: body.supplierName ?? null,
      productName: body.productName ?? null,
      quantity: toNumber(body.quantity) ?? null,
      startWarranty: toDate(body.startWarranty) ?? null,
      endWarranty: toDate(body.endWarranty) ?? null,
      warrantyYears: toNumber(body.warrantyYears) ?? null,
    },
  });
  res.json({ success: true, data: created });
}

export async function updateWarrantySupplierItem(req: Request, res: Response) {
  const itemId = Number(req.params.itemId);
  const body = req.body ?? {};
  if (!itemId) return res.status(400).json({ success: false, message: 'itemId is required' });

  const updated = await prisma.siteWarrantySupplierItem.update({
    where: { id: itemId },
    data: {
      category: body.category ?? undefined,
      itemName: body.itemName ?? undefined,
      supplierName: body.supplierName ?? undefined,
      productName: body.productName ?? undefined,
      quantity: toNumber(body.quantity) ?? undefined,
      startWarranty: toDate(body.startWarranty) ?? undefined,
      endWarranty: toDate(body.endWarranty) ?? undefined,
      warrantyYears: toNumber(body.warrantyYears) ?? undefined,
    },
  });
  res.json({ success: true, data: updated });
}

export async function deleteWarrantySupplierItem(req: Request, res: Response) {
  const itemId = Number(req.params.itemId);
  if (!itemId) return res.status(400).json({ success: false, message: 'itemId is required' });

  await prisma.siteWarrantySupplierItem.delete({ where: { id: itemId } });
  res.json({ success: true });
}

export async function createWarrantyCustomerItem(req: Request, res: Response) {
  const siteId = Number(req.params.siteId);
  const body = req.body ?? {};
  if (!siteId) return res.status(400).json({ success: false, message: 'siteId is required' });
  if (!body.category || !body.itemName) {
    return res.status(400).json({ success: false, message: 'category and itemName are required' });
  }

  const created = await prisma.siteWarrantyCustomerItem.create({
    data: {
      siteId,
      category: String(body.category),
      itemName: String(body.itemName),
      warrantyYears: toNumber(body.warrantyYears) ?? null,
    },
  });
  res.json({ success: true, data: created });
}

export async function updateWarrantyCustomerItem(req: Request, res: Response) {
  const itemId = Number(req.params.itemId);
  const body = req.body ?? {};
  if (!itemId) return res.status(400).json({ success: false, message: 'itemId is required' });

  const updated = await prisma.siteWarrantyCustomerItem.update({
    where: { id: itemId },
    data: {
      category: body.category ?? undefined,
      itemName: body.itemName ?? undefined,
      warrantyYears: toNumber(body.warrantyYears) ?? undefined,
    },
  });
  res.json({ success: true, data: updated });
}

export async function deleteWarrantyCustomerItem(req: Request, res: Response) {
  const itemId = Number(req.params.itemId);
  if (!itemId) return res.status(400).json({ success: false, message: 'itemId is required' });

  await prisma.siteWarrantyCustomerItem.delete({ where: { id: itemId } });
  res.json({ success: true });
}

// =====================================================
// LAYOUT
// =====================================================

/**
 * POST /api/client-data/projects/:siteId/layouts/:type
 * Multipart: file
 * type: PV_LAYOUT | PV_STRING_LAYOUT
 */
export async function upsertLayout(req: Request, res: Response) {
  const siteId = Number(req.params.siteId);
  const typeParamRaw = req.params.type;
  const typeParam = Array.isArray(typeParamRaw) ? typeParamRaw[0] : typeParamRaw;

  if (!typeParam) {
    return res.status(400).json({ message: "Missing layout type in params" });
  }

  const type = parseLayoutType(typeParam);
  const file = (req as any).file as Express.Multer.File | undefined;

  if (!siteId) return res.status(400).json({ success: false, message: 'siteId is required' });
  if (!type) return res.status(400).json({ success: false, message: 'type must be PV_LAYOUT or PV_STRING_LAYOUT' });
  if (!file) return res.status(400).json({ success: false, message: 'file is required' });

  const fileUrl = `/uploads/${path.basename(file.path)}`;

  const row = await prisma.siteLayout.upsert({
    where: { siteId_type: { siteId, type } },
    create: { siteId, type, fileUrl },
    update: { fileUrl },
  });

  res.json({ success: true, data: row });
}

// =====================================================
// FORECAST
// =====================================================

/**
 * PUT /api/client-data/projects/:siteId/forecast/pvsyst
 * body: { rows: [{ month, globalKwhM2, eGridKwh, prRatio }] }
 */
export async function upsertForecastMonthly(req: Request, res: Response) {
  const siteId = Number(req.params.siteId);
  const rows = (req.body?.rows ?? req.body) as any;
  if (!siteId) return res.status(400).json({ success: false, message: 'siteId is required' });
  if (!Array.isArray(rows)) return res.status(400).json({ success: false, message: 'rows must be an array' });

  await prisma.$transaction(
    rows.map((r) => {
      const month = Number(r.month);
      return prisma.siteForecastMonthly.upsert({
        where: { siteId_month: { siteId, month } },
        create: {
          siteId,
          month,
          globalKwhM2: toNumber(r.globalKwhM2) ?? null,
          eGridKwh: toNumber(r.eGridKwh) ?? null,
          prRatio: toNumber(r.prRatio) ?? null,
        },
        update: {
          globalKwhM2: toNumber(r.globalKwhM2) ?? null,
          eGridKwh: toNumber(r.eGridKwh) ?? null,
          prRatio: toNumber(r.prRatio) ?? null,
        },
      });
    }),
  );

  res.json({ success: true });
}

/**
 * PUT /api/client-data/projects/:siteId/forecast/warranty-energy
 * body: { rows: [{ year, degradationPct, annualProductionKwh, warrantyEnergyOutputKwh }] }
 */
export async function upsertForecastYearly(req: Request, res: Response) {
  const siteId = Number(req.params.siteId);
  const rows = (req.body?.rows ?? req.body) as any;
  if (!siteId) return res.status(400).json({ success: false, message: 'siteId is required' });
  if (!Array.isArray(rows)) return res.status(400).json({ success: false, message: 'rows must be an array' });

  await prisma.$transaction(
    rows.map((r) => {
      const year = Number(r.year);
      return prisma.siteForecastYearly.upsert({
        where: { siteId_year: { siteId, year } },
        create: {
          siteId,
          year,
          degradationPct: toNumber(r.degradationPct) ?? null,
          annualProductionKwh: toNumber(r.annualProductionKwh) ?? null,
          warrantyEnergyOutputKwh: toNumber(r.warrantyEnergyOutputKwh) ?? null,
        },
        update: {
          degradationPct: toNumber(r.degradationPct) ?? null,
          annualProductionKwh: toNumber(r.annualProductionKwh) ?? null,
          warrantyEnergyOutputKwh: toNumber(r.warrantyEnergyOutputKwh) ?? null,
        },
      });
    }),
  );

  res.json({ success: true });
}

// =====================================================
// OTHER TAB
// =====================================================

export async function createOtherRow(req: Request, res: Response) {
  const siteId = Number(req.params.siteId);
  const body = req.body ?? {};
  if (!siteId) return res.status(400).json({ success: false, message: 'siteId is required' });

  const created = await prisma.siteOtherRow.create({
    data: {
      siteId,
      status: body.status ?? null,
      description: body.description ?? null,
      remark: body.remark ?? null,
    },
  });

  res.json({ success: true, data: created });
}

export async function updateOtherRow(req: Request, res: Response) {
  const rowId = Number(req.params.rowId);
  const body = req.body ?? {};
  if (!rowId) return res.status(400).json({ success: false, message: 'rowId is required' });

  const updated = await prisma.siteOtherRow.update({
    where: { id: rowId },
    data: {
      status: body.status ?? undefined,
      description: body.description ?? undefined,
      remark: body.remark ?? undefined,
    },
  });

  res.json({ success: true, data: updated });
}

export async function deleteOtherRow(req: Request, res: Response) {
  const rowId = Number(req.params.rowId);
  if (!rowId) return res.status(400).json({ success: false, message: 'rowId is required' });

  await prisma.siteOtherRow.delete({ where: { id: rowId } });
  res.json({ success: true });
}

// =====================================================
// SERVICE ENTRY CRUD
// =====================================================

/** POST /api/client-data/service/entries */
export async function createServiceEntry(req: Request, res: Response) {
  const body = req.body ?? {};
  const siteId = Number(body.siteId);
  const job = String(body.job ?? '').trim().toUpperCase();
  if (!siteId) return res.status(400).json({ success: false, message: 'siteId is required' });
  if (!job || !Object.values(JobType).includes(job as any)) {
    return res.status(400).json({ success: false, message: 'job must be SERVICE/CLEANING/INSPECTION/OM' });
  }

  const created = await prisma.serviceEntry.create({
    data: {
      siteId,
      job: job as any,
      description: body.description ?? null,
    },
  });

  res.json({ success: true, data: created });
}

/** PUT /api/client-data/service/entries/:entryId */
export async function updateServiceEntry(req: Request, res: Response) {
  const entryId = Number(req.params.entryId);
  const body = req.body ?? {};
  if (!entryId) return res.status(400).json({ success: false, message: 'entryId is required' });

  const job = body.job ? String(body.job).toUpperCase() : null;
  const jobVal = job && Object.values(JobType).includes(job as any) ? (job as any) : undefined;

  const updated = await prisma.serviceEntry.update({
    where: { id: entryId },
    data: {
      job: jobVal,
      description: body.description ?? undefined,
    },
  });

  res.json({ success: true, data: updated });
}

/** DELETE /api/client-data/service/entries/:entryId */
export async function deleteServiceEntry(req: Request, res: Response) {
  const entryId = Number(req.params.entryId);
  if (!entryId) return res.status(400).json({ success: false, message: 'entryId is required' });

  await prisma.serviceEntry.delete({ where: { id: entryId } });
  res.json({ success: true });
}

export {};