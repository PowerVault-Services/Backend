"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listProjectsThailand = listProjectsThailand;
exports.listProjectsService = listProjectsService;
exports.createProject = createProject;
exports.updateProject = updateProject;
exports.deleteProject = deleteProject;
exports.getProjectDetail = getProjectDetail;
exports.createWarrantySupplierItem = createWarrantySupplierItem;
exports.updateWarrantySupplierItem = updateWarrantySupplierItem;
exports.deleteWarrantySupplierItem = deleteWarrantySupplierItem;
exports.createWarrantyCustomerItem = createWarrantyCustomerItem;
exports.updateWarrantyCustomerItem = updateWarrantyCustomerItem;
exports.deleteWarrantyCustomerItem = deleteWarrantyCustomerItem;
exports.upsertLayout = upsertLayout;
exports.upsertForecastMonthly = upsertForecastMonthly;
exports.upsertForecastYearly = upsertForecastYearly;
exports.generateForecastDefaults = generateForecastDefaults;
exports.createOtherRow = createOtherRow;
exports.updateOtherRow = updateOtherRow;
exports.deleteOtherRow = deleteOtherRow;
exports.createServiceEntry = createServiceEntry;
exports.updateServiceEntry = updateServiceEntry;
exports.deleteServiceEntry = deleteServiceEntry;
const client_1 = require("@prisma/client");
const storageService_1 = require("../services/storageService");
const prisma = new client_1.PrismaClient();
function toNumber(v) {
    if (v === null || v === undefined || v === '')
        return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}
function toDate(v) {
    if (!v)
        return null;
    const d = new Date(String(v));
    return isNaN(d.getTime()) ? null : d;
}
function parseLayoutType(typeParam) {
    const t = String(typeParam || '').toUpperCase();
    if (t === 'PV_LAYOUT')
        return client_1.LayoutType.PV_LAYOUT;
    if (t === 'PV_STRING_LAYOUT')
        return client_1.LayoutType.PV_STRING_LAYOUT;
    return null;
}
function normalizeForecastMonthlyRows(body) {
    const rows = body?.forecastRows ?? body?.forecastMonthlyRows ?? body?.forecast ?? body?.rows;
    return Array.isArray(rows) ? rows : [];
}
async function upsertForecastMonthlyRowsInternal(siteId, rows) {
    if (!rows.length)
        return;
    await prisma.$transaction(rows
        .map((row) => ({
        month: Number(row.month),
        globalKwhM2: toNumber(row.globalKwhM2 ?? row.irradiationForecast),
        eGridKwh: toNumber(row.eGridKwh ?? row.productionForecast),
        prRatio: toNumber(row.prRatio ?? row.prForecast),
    }))
        .filter((row) => Number.isFinite(row.month) && row.month >= 1 && row.month <= 12)
        .map((row) => prisma.siteForecastMonthly.upsert({
        where: { siteId_month: { siteId, month: row.month } },
        create: {
            siteId,
            month: row.month,
            globalKwhM2: row.globalKwhM2 ?? null,
            eGridKwh: row.eGridKwh ?? null,
            prRatio: row.prRatio ?? null,
        },
        update: {
            globalKwhM2: row.globalKwhM2 ?? null,
            eGridKwh: row.eGridKwh ?? null,
            prRatio: row.prRatio ?? null,
        },
    })));
}
function buildWarrantyDefaultForecastRows(warrantyStart) {
    if (!warrantyStart)
        return [];
    const startMonth = warrantyStart.getMonth() + 1;
    return Array.from({ length: 12 }, (_, index) => ({
        month: ((startMonth - 1 + index) % 12) + 1,
        globalKwhM2: null,
        eGridKwh: null,
        prRatio: null,
    }));
}
async function ensureDefaultForecastRows(siteId, warrantyStart) {
    const existing = await prisma.siteForecastMonthly.count({ where: { siteId } });
    if (existing > 0)
        return false;
    const defaults = buildWarrantyDefaultForecastRows(warrantyStart);
    if (!defaults.length)
        return false;
    await prisma.$transaction(defaults.map((row) => prisma.siteForecastMonthly.create({
        data: {
            siteId,
            month: row.month,
            globalKwhM2: row.globalKwhM2,
            eGridKwh: row.eGridKwh,
            prRatio: row.prRatio,
        },
    })));
    return true;
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
async function listProjectsThailand(req, res) {
    const projectNo = String(req.query.projectNo ?? '').trim();
    const projectName = String(req.query.projectName ?? '').trim();
    const systemSizeKWp = toNumber(req.query.systemSizeKWp);
    const endWarrantyBefore = toDate(req.query.endWarrantyBefore);
    const status = String(req.query.status ?? '').trim().toUpperCase();
    const page = Math.max(1, Number(req.query.page ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize ?? 10)));
    const skip = (page - 1) * pageSize;
    const where = {};
    if (projectNo)
        where.plantCode = { contains: projectNo, mode: 'insensitive' };
    if (projectName)
        where.name = { contains: projectName, mode: 'insensitive' };
    if (systemSizeKWp !== null)
        where.capacityKWp = systemSizeKWp;
    if (endWarrantyBefore)
        where.warrantyEnd = { lte: endWarrantyBefore };
    if (status && Object.values(client_1.ProjectStatus).includes(status)) {
        where.projectStatus = status;
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
// Backfill: create ServiceEntry rows for Jobs that don't have one yet
// =====================================================
let backfillDone = false;
async function backfillServiceEntries() {
    if (backfillDone)
        return;
    backfillDone = true;
    const jobs = await prisma.job.findMany({
        select: { siteId: true, type: true, title: true },
    });
    for (const job of jobs) {
        const exists = await prisma.serviceEntry.findFirst({
            where: { siteId: job.siteId, job: job.type },
        });
        if (!exists) {
            await prisma.serviceEntry.create({
                data: {
                    siteId: job.siteId,
                    job: job.type,
                    description: job.title ?? null,
                },
            });
        }
    }
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
async function listProjectsService(req, res) {
    // Backfill: ensure every Job has a corresponding ServiceEntry
    await backfillServiceEntries();
    const projectNo = String(req.query.projectNo ?? '').trim();
    const projectName = String(req.query.projectName ?? '').trim();
    const systemSizeKWp = toNumber(req.query.systemSizeKWp);
    const job = String(req.query.job ?? '').trim().toUpperCase();
    const page = Math.max(1, Number(req.query.page ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize ?? 10)));
    const skip = (page - 1) * pageSize;
    const where = {
        site: {},
    };
    if (projectNo)
        where.site.plantCode = { contains: projectNo, mode: 'insensitive' };
    if (projectName)
        where.site.name = { contains: projectName, mode: 'insensitive' };
    if (systemSizeKWp !== null)
        where.site.capacityKWp = systemSizeKWp;
    if (job && Object.values(client_1.JobType).includes(job))
        where.job = job;
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
async function createProject(req, res) {
    const body = req.body ?? {};
    const plantCode = String(body.plantCode ?? body.projectNo ?? '').trim();
    const name = String(body.name ?? body.projectName ?? '').trim();
    // UI payload uses `capacityKwp` (lowercase p) while our DB field is `capacityKWp`.
    // Accept both to keep frontend + backend in sync.
    const capacityKWp = toNumber(body.capacityKWp ??
        body.capacityKwp ??
        body.systemSizeKWp ??
        body.systemSizeKwp);
    if (!plantCode)
        return res.status(400).json({ success: false, message: 'plantCode (projectNo) is required' });
    if (!name)
        return res.status(400).json({ success: false, message: 'name (projectName) is required' });
    if (capacityKWp === null) {
        return res
            .status(400)
            .json({ success: false, message: 'capacityKWp (capacityKwp / systemSizeKWp) is required' });
    }
    const projectStatus = String(body.projectStatus ?? body.status ?? 'ACTIVE').toUpperCase();
    const forecastRows = normalizeForecastMonthlyRows(body);
    const statusVal = Object.values(client_1.ProjectStatus).includes(projectStatus)
        ? projectStatus
        : client_1.ProjectStatus.ACTIVE;
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
        if (forecastRows.length) {
            await upsertForecastMonthlyRowsInternal(created.id, forecastRows);
        }
        else {
            await ensureDefaultForecastRows(created.id, toDate(body.warrantyStart ?? body.startWarranty));
        }
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
    }
    catch (err) {
        res.status(500).json({ success: false, message: err?.message ?? 'Create project failed' });
    }
}
/** PUT /api/client-data/thailand/projects/:siteId */
async function updateProject(req, res) {
    const siteId = Number(req.params.siteId);
    const body = req.body ?? {};
    if (!siteId)
        return res.status(400).json({ success: false, message: 'siteId is required' });
    const projectStatus = body.projectStatus ?? body.status;
    const forecastRows = normalizeForecastMonthlyRows(body);
    const statusVal = projectStatus && Object.values(client_1.ProjectStatus).includes(String(projectStatus).toUpperCase())
        ? String(projectStatus).toUpperCase()
        : undefined;
    try {
        const updated = await prisma.site.update({
            where: { id: siteId },
            data: {
                plantCode: body.plantCode ?? body.projectNo ?? undefined,
                name: body.name ?? body.projectName ?? undefined,
                capacityKWp: toNumber(body.capacityKWp ??
                    body.capacityKwp ??
                    body.systemSizeKWp ??
                    body.systemSizeKwp) ?? undefined,
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
        if (forecastRows.length) {
            await upsertForecastMonthlyRowsInternal(updated.id, forecastRows);
        }
        else {
            await ensureDefaultForecastRows(updated.id, toDate(body.warrantyStart ?? body.startWarranty));
        }
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
    }
    catch (err) {
        res.status(500).json({ success: false, message: err?.message ?? 'Update project failed' });
    }
}
/** DELETE /api/client-data/thailand/projects/:siteId */
async function deleteProject(req, res) {
    const siteId = Number(req.params.siteId);
    if (!siteId)
        return res.status(400).json({ success: false, message: 'siteId is required' });
    try {
        await prisma.site.delete({ where: { id: siteId } });
        res.json({ success: true });
    }
    catch (err) {
        res.status(500).json({ success: false, message: err?.message ?? 'Delete project failed' });
    }
}
// =====================================================
// PROJECT DETAIL (all tabs)
// =====================================================
/** GET /api/client-data/projects/:siteId */
async function getProjectDetail(req, res) {
    const siteId = Number(req.params.siteId);
    if (!siteId)
        return res.status(400).json({ success: false, message: 'siteId is required' });
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
    if (!site)
        return res.status(404).json({ success: false, message: 'Project not found' });
    res.json({ success: true, data: site });
}
// =====================================================
// WARRANTY CRUD
// =====================================================
async function createWarrantySupplierItem(req, res) {
    const siteId = Number(req.params.siteId);
    const body = req.body ?? {};
    if (!siteId)
        return res.status(400).json({ success: false, message: 'siteId is required' });
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
async function updateWarrantySupplierItem(req, res) {
    const itemId = Number(req.params.itemId);
    const body = req.body ?? {};
    if (!itemId)
        return res.status(400).json({ success: false, message: 'itemId is required' });
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
async function deleteWarrantySupplierItem(req, res) {
    const itemId = Number(req.params.itemId);
    if (!itemId)
        return res.status(400).json({ success: false, message: 'itemId is required' });
    await prisma.siteWarrantySupplierItem.delete({ where: { id: itemId } });
    res.json({ success: true });
}
async function createWarrantyCustomerItem(req, res) {
    const siteId = Number(req.params.siteId);
    const body = req.body ?? {};
    if (!siteId)
        return res.status(400).json({ success: false, message: 'siteId is required' });
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
async function updateWarrantyCustomerItem(req, res) {
    const itemId = Number(req.params.itemId);
    const body = req.body ?? {};
    if (!itemId)
        return res.status(400).json({ success: false, message: 'itemId is required' });
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
async function deleteWarrantyCustomerItem(req, res) {
    const itemId = Number(req.params.itemId);
    if (!itemId)
        return res.status(400).json({ success: false, message: 'itemId is required' });
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
async function upsertLayout(req, res) {
    const siteId = Number(req.params.siteId);
    const typeParamRaw = req.params.type;
    const typeParam = Array.isArray(typeParamRaw) ? typeParamRaw[0] : typeParamRaw;
    if (!typeParam) {
        return res.status(400).json({ message: "Missing layout type in params" });
    }
    const type = parseLayoutType(typeParam);
    const file = req.file;
    if (!siteId)
        return res.status(400).json({ success: false, message: 'siteId is required' });
    if (!type)
        return res.status(400).json({ success: false, message: 'type must be PV_LAYOUT or PV_STRING_LAYOUT' });
    if (!file)
        return res.status(400).json({ success: false, message: 'file is required' });
    console.log('🧪 upsertLayout incoming file:', {
        siteId,
        type,
        originalname: file.originalname,
        mimetype: file.mimetype,
        size: file.size,
        tempPath: file.path,
    });
    const stored = await (0, storageService_1.storeIncomingUserUpload)(file, {
        scopeParts: ['sites', `site_${siteId}`, 'layouts', String(type).toLowerCase()],
    });
    const fileUrl = stored.fileUrl;
    console.log('🧪 upsertLayout stored result:', stored);
    await prisma.siteLayout.upsert({
        where: { siteId_type: { siteId, type } },
        create: { siteId, type, fileUrl },
        update: { fileUrl },
    });
    const row = await prisma.siteLayout.findUnique({
        where: { siteId_type: { siteId, type } },
    });
    console.log('🧪 upsertLayout db row after write:', row);
    res.json({ success: true, data: row ?? { siteId, type, fileUrl } });
}
// =====================================================
// FORECAST
// =====================================================
/**
 * PUT /api/client-data/projects/:siteId/forecast/pvsyst
 * body: { rows: [{ month, globalKwhM2, eGridKwh, prRatio }] }
 */
async function upsertForecastMonthly(req, res) {
    const siteId = Number(req.params.siteId);
    const rows = normalizeForecastMonthlyRows(req.body);
    if (!siteId)
        return res.status(400).json({ success: false, message: 'siteId is required' });
    if (!Array.isArray(rows))
        return res.status(400).json({ success: false, message: 'rows must be an array' });
    await upsertForecastMonthlyRowsInternal(siteId, rows);
    const data = await prisma.siteForecastMonthly.findMany({ where: { siteId }, orderBy: { month: 'asc' } });
    res.json({ success: true, data });
}
/**
 * PUT /api/client-data/projects/:siteId/forecast/warranty-energy
 * body: { rows: [{ year, degradationPct, annualProductionKwh, warrantyEnergyOutputKwh }] }
 */
async function upsertForecastYearly(req, res) {
    const siteId = Number(req.params.siteId);
    const rows = (req.body?.rows ?? req.body);
    if (!siteId)
        return res.status(400).json({ success: false, message: 'siteId is required' });
    if (!Array.isArray(rows))
        return res.status(400).json({ success: false, message: 'rows must be an array' });
    await prisma.$transaction(rows.map((r) => {
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
    }));
    res.json({ success: true });
}
async function generateForecastDefaults(req, res) {
    const siteId = Number(req.params.siteId);
    if (!siteId)
        return res.status(400).json({ success: false, message: 'siteId is required' });
    const site = await prisma.site.findUnique({ where: { id: siteId }, select: { warrantyStart: true } });
    if (!site)
        return res.status(404).json({ success: false, message: 'Project not found' });
    await prisma.siteForecastMonthly.deleteMany({ where: { siteId } });
    const created = await ensureDefaultForecastRows(siteId, site.warrantyStart);
    const rows = await prisma.siteForecastMonthly.findMany({ where: { siteId }, orderBy: { month: 'asc' } });
    return res.json({ success: true, data: { created, rows } });
}
// =====================================================
// OTHER TAB
// =====================================================
async function createOtherRow(req, res) {
    const siteId = Number(req.params.siteId);
    const body = req.body ?? {};
    if (!siteId)
        return res.status(400).json({ success: false, message: 'siteId is required' });
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
async function updateOtherRow(req, res) {
    const rowId = Number(req.params.rowId);
    const body = req.body ?? {};
    if (!rowId)
        return res.status(400).json({ success: false, message: 'rowId is required' });
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
async function deleteOtherRow(req, res) {
    const rowId = Number(req.params.rowId);
    if (!rowId)
        return res.status(400).json({ success: false, message: 'rowId is required' });
    await prisma.siteOtherRow.delete({ where: { id: rowId } });
    res.json({ success: true });
}
// =====================================================
// SERVICE ENTRY CRUD
// =====================================================
/** POST /api/client-data/service/entries */
async function createServiceEntry(req, res) {
    const body = req.body ?? {};
    const siteId = Number(body.siteId);
    const job = String(body.job ?? '').trim().toUpperCase();
    if (!siteId)
        return res.status(400).json({ success: false, message: 'siteId is required' });
    if (!job || !Object.values(client_1.JobType).includes(job)) {
        return res.status(400).json({ success: false, message: 'job must be SERVICE/CLEANING/INSPECTION/OM' });
    }
    const created = await prisma.serviceEntry.create({
        data: {
            siteId,
            job: job,
            description: body.description ?? null,
        },
    });
    res.json({ success: true, data: created });
}
/** PUT /api/client-data/service/entries/:entryId */
async function updateServiceEntry(req, res) {
    const entryId = Number(req.params.entryId);
    const body = req.body ?? {};
    if (!entryId)
        return res.status(400).json({ success: false, message: 'entryId is required' });
    const job = body.job ? String(body.job).toUpperCase() : null;
    const jobVal = job && Object.values(client_1.JobType).includes(job) ? job : undefined;
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
async function deleteServiceEntry(req, res) {
    const entryId = Number(req.params.entryId);
    if (!entryId)
        return res.status(400).json({ success: false, message: 'entryId is required' });
    await prisma.serviceEntry.delete({ where: { id: entryId } });
    res.json({ success: true });
}
