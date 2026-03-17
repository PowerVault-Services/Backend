import { Router } from 'express';
import { StockTxType } from '@prisma/client';
import prisma from '../config/prisma';

export const stockRoutes = Router();

const toInt = (v: any) => (v == null || v === '' ? null : Number(v));
const toPage = (v: any) => Math.max(1, Number(v ?? 1));
const toPageSize = (v: any) => Math.min(100, Math.max(10, Number(v ?? 20)));

async function resolveProjectName(project?: any, siteId?: any) {
  if (project != null && String(project).trim()) return String(project).trim();
  const parsedSiteId = toInt(siteId);
  if (!parsedSiteId) return null;
  const site = await prisma.site.findUnique({ where: { id: parsedSiteId }, select: { name: true } });
  return site?.name ?? null;
}

/** GET meta for dropdowns */
stockRoutes.get('/meta', async (_req, res) => {
  try {
    const [categories, units, products] = await Promise.all([
      prisma.productCategory.findMany({ orderBy: { name: 'asc' } }),
      prisma.unit.findMany({ orderBy: { name: 'asc' } }),
      prisma.product.findMany({
        where: { isActive: true },
        select: { id: true, sku: true, name: true, categoryId: true, unitId: true },
        orderBy: { name: 'asc' },
      }),
    ]);

    res.json({ success: true, data: { categories, units, products } });
  } catch (e: any) {
    res.status(500).json({ success: false, message: e?.message ?? 'Internal error' });
  }
});

stockRoutes.get('/projects', async (req, res) => {
  try {
    const q = String(req.query.q ?? '').trim();
    const sites = await prisma.site.findMany({
      where: q
        ? {
            OR: [
              { name: { contains: q, mode: 'insensitive' } },
              { plantCode: { contains: q, mode: 'insensitive' } },
            ],
          }
        : {},
      select: { id: true, name: true, plantCode: true },
      orderBy: { name: 'asc' },
      take: 500,
    });
    res.json({ success: true, data: sites.map((site) => ({ siteId: site.id, project: site.name, plantCode: site.plantCode })) });
  } catch (e: any) {
    res.status(500).json({ success: false, message: e?.message ?? 'Internal error' });
  }
});

/** POST create product (modal เพิ่มสินค้าใหม่) */
stockRoutes.post('/products', async (req, res) => {
  try {
    const { sku, name, categoryId, unitId } = req.body ?? {};
    if (!sku || !name || !categoryId || !unitId) {
      return res.status(400).json({ success: false, message: 'sku, name, categoryId, unitId are required' });
    }

    const created = await prisma.product.create({
      data: {
        sku: String(sku).trim(),
        name: String(name).trim(),
        categoryId: Number(categoryId),
        unitId: Number(unitId),
      },
    });

    res.json({ success: true, data: created });
  } catch (e: any) {
    res.status(500).json({ success: false, message: e?.message ?? 'Internal error' });
  }
});

/** GET All Stock summary (คงเหลือ) */
stockRoutes.get('/summary', async (req, res) => {
  try {
    const q = String(req.query.q ?? '').trim();
    const categoryId = toInt(req.query.categoryId);
    const unitId = toInt(req.query.unitId);

    const page = toPage(req.query.page);
    const pageSize = toPageSize(req.query.pageSize);
    const skip = (page - 1) * pageSize;

    const where: any = { isActive: true };
    if (categoryId) where.categoryId = categoryId;
    if (unitId) where.unitId = unitId;
    if (q) {
      where.OR = [
        { sku: { contains: q, mode: 'insensitive' } },
        { name: { contains: q, mode: 'insensitive' } },
      ];
    }

    const [total, products] = await Promise.all([
      prisma.product.count({ where }),
      prisma.product.findMany({
        where,
        include: { category: true, unit: true },
        orderBy: { name: 'asc' },
        skip,
        take: pageSize,
      }),
    ]);

    const productIds = products.map((product) => product.id);
    const [inAgg, outAgg] = await Promise.all([
      prisma.stockTransaction.groupBy({
        by: ['productId'],
        where: { productId: { in: productIds }, type: StockTxType.IN },
        _sum: { quantity: true },
      }),
      prisma.stockTransaction.groupBy({
        by: ['productId'],
        where: { productId: { in: productIds }, type: StockTxType.OUT },
        _sum: { quantity: true },
      }),
    ]);

    const inMap = new Map<number, number>(inAgg.map((row) => [row.productId, Number(row._sum.quantity ?? 0)]));
    const outMap = new Map<number, number>(outAgg.map((row) => [row.productId, Number(row._sum.quantity ?? 0)]));

    const list = products.map((product) => {
      const inQty = inMap.get(product.id) ?? 0;
      const outQty = outMap.get(product.id) ?? 0;
      return {
        productId: product.id,
        sku: product.sku,
        category: product.category.name,
        name: product.name,
        unit: product.unit.name,
        inQty,
        outQty,
        onHand: inQty - outQty,
      };
    });

    res.json({
      success: true,
      data: {
        list,
        pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
      },
    });
  } catch (e: any) {
    res.status(500).json({ success: false, message: e?.message ?? 'Internal error' });
  }
});

function txFiltersFromQuery(req: any) {
  const q = String(req.query.q ?? '').trim();
  const sku = String(req.query.sku ?? '').trim();
  const productName = String(req.query.productName ?? '').trim();
  const project = String(req.query.project ?? '').trim();
  const categoryId = toInt(req.query.categoryId);
  const unitId = toInt(req.query.unitId);
  const productId = toInt(req.query.productId);

  const dateFrom = req.query.dateFrom ? new Date(String(req.query.dateFrom)) : null;
  const dateTo = req.query.dateTo ? new Date(String(req.query.dateTo)) : null;

  const where: any = {};
  if (productId) where.productId = productId;
  if (project) where.project = { contains: project, mode: 'insensitive' };

  if (dateFrom || dateTo) {
    where.txDate = {};
    if (dateFrom) where.txDate.gte = dateFrom;
    if (dateTo) where.txDate.lte = dateTo;
  }

  const productWhere: any = {};
  if (categoryId) productWhere.categoryId = categoryId;
  if (unitId) productWhere.unitId = unitId;
  const or: any[] = [];
  if (q) {
    or.push({ sku: { contains: q, mode: 'insensitive' } });
    or.push({ name: { contains: q, mode: 'insensitive' } });
  }
  if (sku) or.push({ sku: { contains: sku, mode: 'insensitive' } });
  if (productName) or.push({ name: { contains: productName, mode: 'insensitive' } });
  if (or.length) productWhere.OR = or;

  return { where, productWhere };
}

async function listTransactions(req: any, res: any, type: StockTxType) {
  try {
    const page = toPage(req.query.page);
    const pageSize = toPageSize(req.query.pageSize);
    const skip = (page - 1) * pageSize;
    const { where, productWhere } = txFiltersFromQuery(req);

    const fullWhere: any = {
      ...where,
      type,
      product: Object.keys(productWhere).length ? productWhere : undefined,
    };

    const [total, list] = await Promise.all([
      prisma.stockTransaction.count({ where: fullWhere }),
      prisma.stockTransaction.findMany({
        where: fullWhere,
        include: { product: { include: { category: true, unit: true } } },
        orderBy: { txDate: 'desc' },
        skip,
        take: pageSize,
      }),
    ]);

    res.json({
      success: true,
      data: {
        list: list.map((tx) => ({
          id: tx.id,
          txDate: tx.txDate,
          sku: tx.product.sku,
          category: tx.product.category.name,
          productName: tx.product.name,
          unit: tx.product.unit.name,
          quantity: tx.quantity,
          project: tx.project,
          receiver: tx.receiver,
          vendor: tx.vendor,
          insuranceCompany: tx.insuranceCompany,
          insuranceNo: tx.insuranceNo,
          note: tx.note,
          jobId: tx.jobId,
        })),
        pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
      },
    });
  } catch (e: any) {
    res.status(500).json({ success: false, message: e?.message ?? 'Internal error' });
  }
}

stockRoutes.get('/in', async (req, res) => listTransactions(req, res, StockTxType.IN));
stockRoutes.get('/out', async (req, res) => listTransactions(req, res, StockTxType.OUT));
stockRoutes.get('/deduct', async (req, res) => listTransactions(req, res, StockTxType.OUT));

stockRoutes.post('/in', async (req, res) => {
  try {
    const { productId, quantity, txDate, project, siteId, receiver, vendor, insuranceCompany, insuranceNo, note } = req.body ?? {};
    if (!productId || quantity == null) {
      return res.status(400).json({ success: false, message: 'productId and quantity are required' });
    }
    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      return res.status(400).json({ success: false, message: 'quantity must be a positive number' });
    }

    const resolvedProject = await resolveProjectName(project, siteId);
    const created = await prisma.stockTransaction.create({
      data: {
        type: StockTxType.IN,
        productId: Number(productId),
        quantity: qty as any,
        txDate: txDate ? new Date(String(txDate)) : new Date(),
        project: resolvedProject,
        receiver: receiver ?? null,
        vendor: vendor ?? null,
        insuranceCompany: insuranceCompany ?? null,
        insuranceNo: insuranceNo ?? null,
        note: note ?? null,
      },
    });

    res.json({ success: true, data: created });
  } catch (e: any) {
    res.status(500).json({ success: false, message: e?.message ?? 'Internal error' });
  }
});

async function createOutTransaction(req: any, res: any) {
  try {
    const { productId, quantity, txDate, project, siteId, receiver, vendor, insuranceCompany, insuranceNo, note, jobId } = req.body ?? {};
    if (!productId || quantity == null) {
      return res.status(400).json({ success: false, message: 'productId and quantity are required' });
    }
    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      return res.status(400).json({ success: false, message: 'quantity must be a positive number' });
    }

    const [inAgg, outAgg] = await Promise.all([
      prisma.stockTransaction.aggregate({ where: { productId: Number(productId), type: StockTxType.IN }, _sum: { quantity: true } }),
      prisma.stockTransaction.aggregate({ where: { productId: Number(productId), type: StockTxType.OUT }, _sum: { quantity: true } }),
    ]);
    const onHand = Number(inAgg._sum.quantity ?? 0) - Number(outAgg._sum.quantity ?? 0);
    if (qty > onHand) {
      return res.status(400).json({ success: false, message: `insufficient stock: onHand=${onHand}` });
    }

    const resolvedProject = await resolveProjectName(project, siteId);
    const created = await prisma.stockTransaction.create({
      data: {
        type: StockTxType.OUT,
        productId: Number(productId),
        quantity: qty as any,
        txDate: txDate ? new Date(String(txDate)) : new Date(),
        project: resolvedProject,
        receiver: receiver ?? null,
        vendor: vendor ?? null,
        insuranceCompany: insuranceCompany ?? null,
        insuranceNo: insuranceNo ?? null,
        note: note ?? null,
        jobId: jobId ? Number(jobId) : null,
      },
    });

    res.json({ success: true, data: created });
  } catch (e: any) {
    res.status(500).json({ success: false, message: e?.message ?? 'Internal error' });
  }
}

stockRoutes.post('/out', createOutTransaction);
stockRoutes.post('/deduct', createOutTransaction);

// ---------- Category ----------
stockRoutes.get('/categories', async (_req, res) => {
  try {
    const categories = await prisma.productCategory.findMany({ orderBy: { name: 'asc' } });
    res.json({ success: true, data: categories });
  } catch (e: any) {
    res.status(500).json({ success: false, message: e?.message ?? 'Internal error' });
  }
});

stockRoutes.post('/categories', async (req, res) => {
  try {
    const name = String(req.body?.name ?? '').trim();
    if (!name) return res.status(400).json({ success: false, message: 'name is required' });

    const created = await prisma.productCategory.create({ data: { name } });
    res.json({ success: true, data: created });
  } catch (e: any) {
    res.status(500).json({ success: false, message: e?.message ?? 'Internal error' });
  }
});

stockRoutes.patch('/categories/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const name = String(req.body?.name ?? '').trim();
    if (!id || !name) return res.status(400).json({ success: false, message: 'id and name are required' });

    const updated = await prisma.productCategory.update({ where: { id }, data: { name } });
    res.json({ success: true, data: updated });
  } catch (e: any) {
    res.status(500).json({ success: false, message: e?.message ?? 'Internal error' });
  }
});

stockRoutes.delete('/categories/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: 'id is required' });

    const used = await prisma.product.count({ where: { categoryId: id } });
    if (used > 0) return res.status(400).json({ success: false, message: 'category is in use by products' });

    await prisma.productCategory.delete({ where: { id } });
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ success: false, message: e?.message ?? 'Internal error' });
  }
});

// ---------- Unit ----------
stockRoutes.get('/units', async (_req, res) => {
  try {
    const units = await prisma.unit.findMany({ orderBy: { name: 'asc' } });
    res.json({ success: true, data: units });
  } catch (e: any) {
    res.status(500).json({ success: false, message: e?.message ?? 'Internal error' });
  }
});

stockRoutes.post('/units', async (req, res) => {
  try {
    const name = String(req.body?.name ?? '').trim();
    if (!name) return res.status(400).json({ success: false, message: 'name is required' });

    const created = await prisma.unit.create({ data: { name } });
    res.json({ success: true, data: created });
  } catch (e: any) {
    res.status(500).json({ success: false, message: e?.message ?? 'Internal error' });
  }
});

stockRoutes.patch('/units/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const name = String(req.body?.name ?? '').trim();
    if (!id || !name) return res.status(400).json({ success: false, message: 'id and name are required' });

    const updated = await prisma.unit.update({ where: { id }, data: { name } });
    res.json({ success: true, data: updated });
  } catch (e: any) {
    res.status(500).json({ success: false, message: e?.message ?? 'Internal error' });
  }
});

stockRoutes.delete('/units/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: 'id is required' });

    const used = await prisma.product.count({ where: { unitId: id } });
    if (used > 0) return res.status(400).json({ success: false, message: 'unit is in use by products' });

    await prisma.unit.delete({ where: { id } });
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ success: false, message: e?.message ?? 'Internal error' });
  }
});
