"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.stockRoutes = void 0;
const express_1 = require("express");
const client_1 = require("@prisma/client");
const prisma_1 = __importDefault(require("../config/prisma"));
exports.stockRoutes = (0, express_1.Router)();
const toInt = (v) => (v == null || v === '' ? null : Number(v));
const toPage = (v) => Math.max(1, Number(v ?? 1));
const toPageSize = (v) => Math.min(100, Math.max(10, Number(v ?? 20)));
/** GET meta for dropdowns */
exports.stockRoutes.get('/meta', async (_req, res) => {
    try {
        const [categories, units, products] = await Promise.all([
            prisma_1.default.productCategory.findMany({ orderBy: { name: 'asc' } }),
            prisma_1.default.unit.findMany({ orderBy: { name: 'asc' } }),
            prisma_1.default.product.findMany({
                where: { isActive: true },
                select: { id: true, sku: true, name: true, categoryId: true, unitId: true },
                orderBy: { name: 'asc' },
            }),
        ]);
        res.json({ success: true, data: { categories, units, products } });
    }
    catch (e) {
        res.status(500).json({ success: false, message: e?.message ?? 'Internal error' });
    }
});
/** POST create product (modal เพิ่มสินค้าใหม่) */
exports.stockRoutes.post('/products', async (req, res) => {
    try {
        const { sku, name, categoryId, unitId } = req.body ?? {};
        if (!sku || !name || !categoryId || !unitId) {
            return res.status(400).json({ success: false, message: 'sku, name, categoryId, unitId are required' });
        }
        const created = await prisma_1.default.product.create({
            data: {
                sku: String(sku).trim(),
                name: String(name).trim(),
                categoryId: Number(categoryId),
                unitId: Number(unitId),
            },
        });
        res.json({ success: true, data: created });
    }
    catch (e) {
        // unique violation -> sku ซ้ำ
        res.status(500).json({ success: false, message: e?.message ?? 'Internal error' });
    }
});
/** GET All Stock summary (คงเหลือ) */
exports.stockRoutes.get('/summary', async (req, res) => {
    try {
        const q = String(req.query.q ?? '').trim();
        const categoryId = toInt(req.query.categoryId);
        const unitId = toInt(req.query.unitId);
        const page = toPage(req.query.page);
        const pageSize = toPageSize(req.query.pageSize);
        const skip = (page - 1) * pageSize;
        const where = { isActive: true };
        if (categoryId)
            where.categoryId = categoryId;
        if (unitId)
            where.unitId = unitId;
        if (q) {
            where.OR = [
                { sku: { contains: q, mode: 'insensitive' } },
                { name: { contains: q, mode: 'insensitive' } },
            ];
        }
        const [total, products] = await Promise.all([
            prisma_1.default.product.count({ where }),
            prisma_1.default.product.findMany({
                where,
                include: { category: true, unit: true },
                orderBy: { name: 'asc' },
                skip,
                take: pageSize,
            }),
        ]);
        const productIds = products.map((p) => p.id);
        // sum IN
        const inAgg = await prisma_1.default.stockTransaction.groupBy({
            by: ['productId'],
            where: { productId: { in: productIds }, type: client_1.StockTxType.IN },
            _sum: { quantity: true },
        });
        // sum OUT
        const outAgg = await prisma_1.default.stockTransaction.groupBy({
            by: ['productId'],
            where: { productId: { in: productIds }, type: client_1.StockTxType.OUT },
            _sum: { quantity: true },
        });
        const inMap = new Map();
        for (const r of inAgg)
            inMap.set(r.productId, Number(r._sum.quantity ?? 0));
        const outMap = new Map();
        for (const r of outAgg)
            outMap.set(r.productId, Number(r._sum.quantity ?? 0));
        const list = products.map((p) => {
            const inQty = inMap.get(p.id) ?? 0;
            const outQty = outMap.get(p.id) ?? 0;
            const onHand = inQty - outQty;
            return {
                productId: p.id,
                sku: p.sku,
                category: p.category.name,
                name: p.name,
                unit: p.unit.name,
                inQty,
                outQty,
                onHand,
            };
        });
        res.json({
            success: true,
            data: {
                list,
                pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
            },
        });
    }
    catch (e) {
        res.status(500).json({ success: false, message: e?.message ?? 'Internal error' });
    }
});
function txFiltersFromQuery(req) {
    const q = String(req.query.q ?? '').trim();
    const categoryId = toInt(req.query.categoryId);
    const unitId = toInt(req.query.unitId);
    const productId = toInt(req.query.productId);
    const dateFrom = req.query.dateFrom ? new Date(String(req.query.dateFrom)) : null;
    const dateTo = req.query.dateTo ? new Date(String(req.query.dateTo)) : null;
    const where = {};
    if (productId)
        where.productId = productId;
    if (dateFrom || dateTo) {
        where.txDate = {};
        if (dateFrom)
            where.txDate.gte = dateFrom;
        if (dateTo)
            where.txDate.lte = dateTo;
    }
    // filter ที่ต้อง join product
    const productWhere = {};
    if (categoryId)
        productWhere.categoryId = categoryId;
    if (unitId)
        productWhere.unitId = unitId;
    if (q) {
        productWhere.OR = [
            { sku: { contains: q, mode: 'insensitive' } },
            { name: { contains: q, mode: 'insensitive' } },
        ];
    }
    return { where, productWhere };
}
/** GET Stock IN list */
exports.stockRoutes.get('/in', async (req, res) => {
    try {
        const page = toPage(req.query.page);
        const pageSize = toPageSize(req.query.pageSize);
        const skip = (page - 1) * pageSize;
        const { where, productWhere } = txFiltersFromQuery(req);
        const fullWhere = {
            ...where,
            type: client_1.StockTxType.IN,
            product: Object.keys(productWhere).length ? productWhere : undefined,
        };
        const [total, list] = await Promise.all([
            prisma_1.default.stockTransaction.count({ where: fullWhere }),
            prisma_1.default.stockTransaction.findMany({
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
                list: list.map((t) => ({
                    id: t.id,
                    txDate: t.txDate,
                    sku: t.product.sku,
                    category: t.product.category.name,
                    productName: t.product.name,
                    unit: t.product.unit.name,
                    quantity: t.quantity,
                    project: t.project,
                    receiver: t.receiver,
                    vendor: t.vendor,
                    insuranceCompany: t.insuranceCompany,
                    insuranceNo: t.insuranceNo,
                    note: t.note,
                })),
                pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
            },
        });
    }
    catch (e) {
        res.status(500).json({ success: false, message: e?.message ?? 'Internal error' });
    }
});
/** POST Stock IN create */
exports.stockRoutes.post('/in', async (req, res) => {
    try {
        const { productId, quantity, txDate, project, receiver, vendor, insuranceCompany, insuranceNo, note } = req.body ?? {};
        if (!productId || quantity == null) {
            return res.status(400).json({ success: false, message: 'productId and quantity are required' });
        }
        const qty = Number(quantity);
        if (!Number.isFinite(qty) || qty <= 0) {
            return res.status(400).json({ success: false, message: 'quantity must be a positive number' });
        }
        const created = await prisma_1.default.stockTransaction.create({
            data: {
                type: client_1.StockTxType.IN,
                productId: Number(productId),
                quantity: qty, // prisma decimal
                txDate: txDate ? new Date(String(txDate)) : new Date(),
                project: project ?? null,
                receiver: receiver ?? null,
                vendor: vendor ?? null,
                insuranceCompany: insuranceCompany ?? null,
                insuranceNo: insuranceNo ?? null,
                note: note ?? null,
            },
        });
        res.json({ success: true, data: created });
    }
    catch (e) {
        res.status(500).json({ success: false, message: e?.message ?? 'Internal error' });
    }
});
/** GET Stock OUT list */
exports.stockRoutes.get('/out', async (req, res) => {
    try {
        const page = toPage(req.query.page);
        const pageSize = toPageSize(req.query.pageSize);
        const skip = (page - 1) * pageSize;
        const { where, productWhere } = txFiltersFromQuery(req);
        const fullWhere = {
            ...where,
            type: client_1.StockTxType.OUT,
            product: Object.keys(productWhere).length ? productWhere : undefined,
        };
        const [total, list] = await Promise.all([
            prisma_1.default.stockTransaction.count({ where: fullWhere }),
            prisma_1.default.stockTransaction.findMany({
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
                list: list.map((t) => ({
                    id: t.id,
                    txDate: t.txDate,
                    sku: t.product.sku,
                    category: t.product.category.name,
                    productName: t.product.name,
                    unit: t.product.unit.name,
                    quantity: t.quantity,
                    project: t.project,
                    receiver: t.receiver,
                    vendor: t.vendor,
                    insuranceCompany: t.insuranceCompany,
                    insuranceNo: t.insuranceNo,
                    note: t.note,
                })),
                pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
            },
        });
    }
    catch (e) {
        res.status(500).json({ success: false, message: e?.message ?? 'Internal error' });
    }
});
/** POST Stock OUT create */
exports.stockRoutes.post('/out', async (req, res) => {
    try {
        const { productId, quantity, txDate, project, receiver, vendor, insuranceCompany, insuranceNo, note } = req.body ?? {};
        if (!productId || quantity == null) {
            return res.status(400).json({ success: false, message: 'productId and quantity are required' });
        }
        const qty = Number(quantity);
        if (!Number.isFinite(qty) || qty <= 0) {
            return res.status(400).json({ success: false, message: 'quantity must be a positive number' });
        }
        // กันจ่ายออกเกินคงเหลือ (optional แต่ควรมี)
        const inAgg = await prisma_1.default.stockTransaction.aggregate({
            where: { productId: Number(productId), type: client_1.StockTxType.IN },
            _sum: { quantity: true },
        });
        const outAgg = await prisma_1.default.stockTransaction.aggregate({
            where: { productId: Number(productId), type: client_1.StockTxType.OUT },
            _sum: { quantity: true },
        });
        const onHand = Number(inAgg._sum.quantity ?? 0) - Number(outAgg._sum.quantity ?? 0);
        if (qty > onHand) {
            return res.status(400).json({ success: false, message: `insufficient stock: onHand=${onHand}` });
        }
        const created = await prisma_1.default.stockTransaction.create({
            data: {
                type: client_1.StockTxType.OUT,
                productId: Number(productId),
                quantity: qty,
                txDate: txDate ? new Date(String(txDate)) : new Date(),
                project: project ?? null,
                receiver: receiver ?? null,
                vendor: vendor ?? null,
                insuranceCompany: insuranceCompany ?? null,
                insuranceNo: insuranceNo ?? null,
                note: note ?? null,
            },
        });
        res.json({ success: true, data: created });
    }
    catch (e) {
        res.status(500).json({ success: false, message: e?.message ?? 'Internal error' });
    }
    // ---------- Category ----------
    exports.stockRoutes.get('/categories', async (_req, res) => {
        try {
            const categories = await prisma_1.default.productCategory.findMany({ orderBy: { name: 'asc' } });
            res.json({ success: true, data: categories });
        }
        catch (e) {
            res.status(500).json({ success: false, message: e?.message ?? 'Internal error' });
        }
    });
    exports.stockRoutes.post('/categories', async (req, res) => {
        try {
            const name = String(req.body?.name ?? '').trim();
            if (!name)
                return res.status(400).json({ success: false, message: 'name is required' });
            const created = await prisma_1.default.productCategory.create({ data: { name } });
            res.json({ success: true, data: created });
        }
        catch (e) {
            res.status(500).json({ success: false, message: e?.message ?? 'Internal error' });
        }
    });
    exports.stockRoutes.patch('/categories/:id', async (req, res) => {
        try {
            const id = Number(req.params.id);
            const name = String(req.body?.name ?? '').trim();
            if (!id || !name)
                return res.status(400).json({ success: false, message: 'id and name are required' });
            const updated = await prisma_1.default.productCategory.update({ where: { id }, data: { name } });
            res.json({ success: true, data: updated });
        }
        catch (e) {
            res.status(500).json({ success: false, message: e?.message ?? 'Internal error' });
        }
    });
    exports.stockRoutes.delete('/categories/:id', async (req, res) => {
        try {
            const id = Number(req.params.id);
            if (!id)
                return res.status(400).json({ success: false, message: 'id is required' });
            // กันลบถ้ามี product ผูกอยู่
            const used = await prisma_1.default.product.count({ where: { categoryId: id } });
            if (used > 0)
                return res.status(400).json({ success: false, message: 'category is in use by products' });
            await prisma_1.default.productCategory.delete({ where: { id } });
            res.json({ success: true });
        }
        catch (e) {
            res.status(500).json({ success: false, message: e?.message ?? 'Internal error' });
        }
    });
    // ---------- Unit ----------
    exports.stockRoutes.get('/units', async (_req, res) => {
        try {
            const units = await prisma_1.default.unit.findMany({ orderBy: { name: 'asc' } });
            res.json({ success: true, data: units });
        }
        catch (e) {
            res.status(500).json({ success: false, message: e?.message ?? 'Internal error' });
        }
    });
    exports.stockRoutes.post('/units', async (req, res) => {
        try {
            const name = String(req.body?.name ?? '').trim();
            if (!name)
                return res.status(400).json({ success: false, message: 'name is required' });
            const created = await prisma_1.default.unit.create({ data: { name } });
            res.json({ success: true, data: created });
        }
        catch (e) {
            res.status(500).json({ success: false, message: e?.message ?? 'Internal error' });
        }
    });
    exports.stockRoutes.patch('/units/:id', async (req, res) => {
        try {
            const id = Number(req.params.id);
            const name = String(req.body?.name ?? '').trim();
            if (!id || !name)
                return res.status(400).json({ success: false, message: 'id and name are required' });
            const updated = await prisma_1.default.unit.update({ where: { id }, data: { name } });
            res.json({ success: true, data: updated });
        }
        catch (e) {
            res.status(500).json({ success: false, message: e?.message ?? 'Internal error' });
        }
    });
    exports.stockRoutes.delete('/units/:id', async (req, res) => {
        try {
            const id = Number(req.params.id);
            if (!id)
                return res.status(400).json({ success: false, message: 'id is required' });
            const used = await prisma_1.default.product.count({ where: { unitId: id } });
            if (used > 0)
                return res.status(400).json({ success: false, message: 'unit is in use by products' });
            await prisma_1.default.unit.delete({ where: { id } });
            res.json({ success: true });
        }
        catch (e) {
            res.status(500).json({ success: false, message: e?.message ?? 'Internal error' });
        }
    });
});
