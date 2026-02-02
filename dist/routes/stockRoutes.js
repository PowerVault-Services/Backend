"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.stockRoutes = void 0;
const client_1 = require("@prisma/client");
const express_1 = require("express");
const prisma = new client_1.PrismaClient();
exports.stockRoutes = (0, express_1.Router)();
class HttpError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}
const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const toScalarString = (value) => {
    if (value == null)
        return null;
    if (Array.isArray(value))
        return toScalarString(value[0]);
    if (typeof value === 'string')
        return value;
    if (typeof value === 'number' || typeof value === 'boolean')
        return String(value);
    return null;
};
const toTrimmedString = (value) => {
    const raw = toScalarString(value);
    if (raw == null)
        return null;
    const trimmed = raw.trim();
    return trimmed.length ? trimmed : null;
};
const toNullableText = (value) => toTrimmedString(value);
const toOptionalBoolean = (value, field) => {
    const raw = toTrimmedString(value);
    if (raw == null)
        return null;
    const lower = raw.toLowerCase();
    if (lower === 'true' || lower === '1')
        return true;
    if (lower === 'false' || lower === '0')
        return false;
    throw new HttpError(400, `${field} must be true or false`);
};
const toOptionalPositiveInt = (value, field) => {
    const raw = toTrimmedString(value);
    if (raw == null)
        return null;
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new HttpError(400, `${field} must be a positive integer`);
    }
    return parsed;
};
const toOptionalNumber = (value, field) => {
    const raw = toTrimmedString(value);
    if (raw == null)
        return null;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
        throw new HttpError(400, `${field} must be a valid number`);
    }
    return parsed;
};
const toOptionalDate = (value, field, options) => {
    const raw = toTrimmedString(value);
    if (raw == null)
        return null;
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) {
        throw new HttpError(400, `${field} must be a valid date`);
    }
    if (options?.endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(raw)) {
        parsed.setHours(23, 59, 59, 999);
    }
    return parsed;
};
const decimalToNumber = (value) => Number(value ?? 0);
const parsePagination = (query) => {
    const page = toOptionalPositiveInt(query.page, 'page') ?? 1;
    const pageSize = Math.min(100, Math.max(1, toOptionalPositiveInt(query.pageSize, 'pageSize') ?? 20));
    const skip = (page - 1) * pageSize;
    return { page, pageSize, skip };
};
const passRange = (value, min, max) => {
    if (min != null && value < min)
        return false;
    if (max != null && value > max)
        return false;
    return true;
};
const ensureRange = (min, max, field) => {
    if (min != null && max != null && min > max) {
        throw new HttpError(400, `${field} min cannot be greater than max`);
    }
};
const sendError = (res, error) => {
    if (error instanceof HttpError) {
        return res.status(error.status).json({ success: false, message: error.message });
    }
    if (error instanceof client_1.Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
            return res.status(409).json({ success: false, message: 'duplicate value' });
        }
        if (error.code === 'P2003') {
            return res.status(400).json({ success: false, message: 'invalid relation reference' });
        }
        if (error.code === 'P2025') {
            return res.status(404).json({ success: false, message: 'record not found' });
        }
    }
    const message = error instanceof Error ? error.message : 'Internal error';
    return res.status(500).json({ success: false, message });
};
const buildProductSearchFilters = (query) => {
    const filters = [];
    const q = toTrimmedString(query.q);
    const sku = toTrimmedString(query.sku);
    const name = toTrimmedString(query.name);
    const categoryId = toOptionalPositiveInt(query.categoryId, 'categoryId');
    const unitId = toOptionalPositiveInt(query.unitId, 'unitId');
    const productId = toOptionalPositiveInt(query.productId, 'productId');
    if (productId != null)
        filters.push({ id: productId });
    if (categoryId != null)
        filters.push({ categoryId });
    if (unitId != null)
        filters.push({ unitId });
    if (sku)
        filters.push({ sku: { contains: sku, mode: 'insensitive' } });
    if (name)
        filters.push({ name: { contains: name, mode: 'insensitive' } });
    if (q) {
        filters.push({
            OR: [{ sku: { contains: q, mode: 'insensitive' } }, { name: { contains: q, mode: 'insensitive' } }],
        });
    }
    return filters;
};
const getStockMaps = async (productIds) => {
    const uniqueIds = [...new Set(productIds)];
    const inMap = new Map();
    const outMap = new Map();
    if (!uniqueIds.length) {
        return { inMap, outMap };
    }
    const [inAgg, outAgg] = await Promise.all([
        prisma.stockTransaction.groupBy({
            by: ['productId'],
            where: { productId: { in: uniqueIds }, type: client_1.StockTxType.IN },
            _sum: { quantity: true },
        }),
        prisma.stockTransaction.groupBy({
            by: ['productId'],
            where: { productId: { in: uniqueIds }, type: client_1.StockTxType.OUT },
            _sum: { quantity: true },
        }),
    ]);
    for (const row of inAgg) {
        inMap.set(row.productId, decimalToNumber(row._sum.quantity));
    }
    for (const row of outAgg) {
        outMap.set(row.productId, decimalToNumber(row._sum.quantity));
    }
    return { inMap, outMap };
};
const getOnHandByProductId = async (productId) => {
    const [inAgg, outAgg] = await Promise.all([
        prisma.stockTransaction.aggregate({
            where: { productId, type: client_1.StockTxType.IN },
            _sum: { quantity: true },
        }),
        prisma.stockTransaction.aggregate({
            where: { productId, type: client_1.StockTxType.OUT },
            _sum: { quantity: true },
        }),
    ]);
    return decimalToNumber(inAgg._sum.quantity) - decimalToNumber(outAgg._sum.quantity);
};
const toStockSummaryRows = async (products) => {
    const { inMap, outMap } = await getStockMaps(products.map((product) => product.id));
    return products.map((product) => {
        const inQty = inMap.get(product.id) ?? 0;
        const outQty = outMap.get(product.id) ?? 0;
        return {
            productId: product.id,
            sku: product.sku,
            categoryId: product.categoryId,
            category: product.category.name,
            name: product.name,
            unitId: product.unitId,
            unit: product.unit.name,
            inQty,
            outQty,
            onHand: inQty - outQty,
            isActive: product.isActive,
        };
    });
};
const mapTransactionRow = (tx, type, onHandMap) => {
    const quantity = decimalToNumber(tx.quantity);
    return {
        id: tx.id,
        type,
        txDate: tx.txDate,
        productId: tx.productId,
        sku: tx.product.sku,
        categoryId: tx.product.categoryId,
        category: tx.product.category.name,
        productName: tx.product.name,
        unitId: tx.product.unitId,
        unit: tx.product.unit.name,
        quantity,
        inQty: type === client_1.StockTxType.IN ? quantity : 0,
        outQty: type === client_1.StockTxType.OUT ? quantity : 0,
        onHand: onHandMap.get(tx.productId) ?? 0,
        project: tx.project,
        receiver: tx.receiver,
        vendor: tx.vendor,
        insuranceCompany: tx.insuranceCompany,
        insuranceNo: tx.insuranceNo,
        note: tx.note,
        createdAt: tx.createdAt,
        updatedAt: tx.updatedAt,
    };
};
const buildTransactionWhere = (query, type) => {
    const where = { type };
    const dateFrom = toOptionalDate(query.dateFrom, 'dateFrom');
    const dateTo = toOptionalDate(query.dateTo, 'dateTo', { endOfDay: true });
    if (dateFrom && dateTo && dateFrom > dateTo) {
        throw new HttpError(400, 'dateFrom cannot be after dateTo');
    }
    if (dateFrom || dateTo) {
        const txDateFilter = {};
        if (dateFrom)
            txDateFilter.gte = dateFrom;
        if (dateTo)
            txDateFilter.lte = dateTo;
        where.txDate = txDateFilter;
    }
    const quantityMin = toOptionalNumber(query.quantityMin, 'quantityMin');
    const quantityMax = toOptionalNumber(query.quantityMax, 'quantityMax');
    ensureRange(quantityMin, quantityMax, 'quantity');
    if (quantityMin != null || quantityMax != null) {
        const quantityFilter = {};
        if (quantityMin != null)
            quantityFilter.gte = quantityMin;
        if (quantityMax != null)
            quantityFilter.lte = quantityMax;
        where.quantity = quantityFilter;
    }
    const project = toTrimmedString(query.project);
    const receiver = toTrimmedString(query.receiver);
    const vendor = toTrimmedString(query.vendor);
    const insuranceCompany = toTrimmedString(query.insuranceCompany);
    const insuranceNo = toTrimmedString(query.insuranceNo);
    const note = toTrimmedString(query.note);
    if (project)
        where.project = { contains: project, mode: 'insensitive' };
    if (receiver)
        where.receiver = { contains: receiver, mode: 'insensitive' };
    if (vendor)
        where.vendor = { contains: vendor, mode: 'insensitive' };
    if (insuranceCompany)
        where.insuranceCompany = { contains: insuranceCompany, mode: 'insensitive' };
    if (insuranceNo)
        where.insuranceNo = { contains: insuranceNo, mode: 'insensitive' };
    if (note)
        where.note = { contains: note, mode: 'insensitive' };
    const includeInactive = toOptionalBoolean(query.includeInactive, 'includeInactive') ?? true;
    const productFilters = buildProductSearchFilters(query);
    if (!includeInactive)
        productFilters.push({ isActive: true });
    if (productFilters.length) {
        where.product = { AND: productFilters };
    }
    return where;
};
const createTransaction = async (body, type) => {
    const productId = toOptionalPositiveInt(body.productId, 'productId');
    const quantity = toOptionalNumber(body.quantity, 'quantity');
    const txDate = toOptionalDate(body.txDate, 'txDate');
    const jobId = toOptionalPositiveInt(body.jobId, 'jobId');
    if (!productId || quantity == null) {
        throw new HttpError(400, 'productId and quantity are required');
    }
    if (quantity <= 0) {
        throw new HttpError(400, 'quantity must be greater than zero');
    }
    const product = await prisma.product.findUnique({
        where: { id: productId },
        select: {
            id: true,
            sku: true,
            name: true,
            categoryId: true,
            unitId: true,
            category: true,
            unit: true,
        },
    });
    if (!product) {
        throw new HttpError(404, 'product not found');
    }
    if (type === client_1.StockTxType.OUT) {
        const onHand = await getOnHandByProductId(productId);
        if (quantity > onHand) {
            throw new HttpError(400, `insufficient stock: onHand=${onHand}`);
        }
    }
    const created = await prisma.stockTransaction.create({
        data: {
            type,
            productId,
            quantity,
            txDate: txDate ?? new Date(),
            project: toNullableText(body.project),
            receiver: toNullableText(body.receiver),
            vendor: toNullableText(body.vendor),
            insuranceCompany: toNullableText(body.insuranceCompany),
            insuranceNo: toNullableText(body.insuranceNo),
            note: toNullableText(body.note),
            jobId: jobId ?? null,
        },
    });
    const onHandAfterTx = await getOnHandByProductId(productId);
    return {
        id: created.id,
        type: created.type,
        txDate: created.txDate,
        productId: created.productId,
        quantity: decimalToNumber(created.quantity),
        onHandAfterTx,
        project: created.project,
        receiver: created.receiver,
        vendor: created.vendor,
        insuranceCompany: created.insuranceCompany,
        insuranceNo: created.insuranceNo,
        note: created.note,
        jobId: created.jobId,
        product: {
            id: product.id,
            sku: product.sku,
            name: product.name,
            categoryId: product.categoryId,
            category: product.category.name,
            unitId: product.unitId,
            unit: product.unit.name,
        },
        createdAt: created.createdAt,
        updatedAt: created.updatedAt,
    };
};
exports.stockRoutes.get('/meta', async (req, res) => {
    try {
        const query = req.query;
        const includeInactive = toOptionalBoolean(query.includeInactive, 'includeInactive') ?? false;
        const productWhere = includeInactive ? {} : { isActive: true };
        const [categories, units, products] = await Promise.all([
            prisma.productCategory.findMany({ orderBy: { name: 'asc' } }),
            prisma.unit.findMany({ orderBy: { name: 'asc' } }),
            prisma.product.findMany({
                where: productWhere,
                include: { category: true, unit: true },
                orderBy: [{ name: 'asc' }, { sku: 'asc' }],
            }),
        ]);
        const stockRows = await toStockSummaryRows(products);
        const productsForDropdown = stockRows.map((row) => ({
            id: row.productId,
            sku: row.sku,
            name: row.name,
            categoryId: row.categoryId,
            category: row.category,
            unitId: row.unitId,
            unit: row.unit,
            inQty: row.inQty,
            outQty: row.outQty,
            onHand: row.onHand,
            isActive: row.isActive,
        }));
        res.json({
            success: true,
            data: {
                categories,
                units,
                products: productsForDropdown,
            },
        });
    }
    catch (error) {
        sendError(res, error);
    }
});
exports.stockRoutes.get('/categories', async (_req, res) => {
    try {
        const categories = await prisma.productCategory.findMany({ orderBy: { name: 'asc' } });
        res.json({ success: true, data: categories });
    }
    catch (error) {
        sendError(res, error);
    }
});
exports.stockRoutes.post('/categories', async (req, res) => {
    try {
        const body = isObject(req.body) ? req.body : {};
        const name = toTrimmedString(body.name);
        if (!name)
            throw new HttpError(400, 'name is required');
        const created = await prisma.productCategory.create({ data: { name } });
        res.json({ success: true, data: created });
    }
    catch (error) {
        sendError(res, error);
    }
});
exports.stockRoutes.patch('/categories/:id', async (req, res) => {
    try {
        const id = toOptionalPositiveInt(req.params.id, 'id');
        const body = isObject(req.body) ? req.body : {};
        const name = toTrimmedString(body.name);
        if (!id || !name)
            throw new HttpError(400, 'id and name are required');
        const updated = await prisma.productCategory.update({
            where: { id },
            data: { name },
        });
        res.json({ success: true, data: updated });
    }
    catch (error) {
        sendError(res, error);
    }
});
exports.stockRoutes.delete('/categories/:id', async (req, res) => {
    try {
        const id = toOptionalPositiveInt(req.params.id, 'id');
        if (!id)
            throw new HttpError(400, 'id is required');
        const used = await prisma.product.count({ where: { categoryId: id } });
        if (used > 0) {
            throw new HttpError(400, 'category is in use by products');
        }
        await prisma.productCategory.delete({ where: { id } });
        res.json({ success: true });
    }
    catch (error) {
        sendError(res, error);
    }
});
exports.stockRoutes.get('/units', async (_req, res) => {
    try {
        const units = await prisma.unit.findMany({ orderBy: { name: 'asc' } });
        res.json({ success: true, data: units });
    }
    catch (error) {
        sendError(res, error);
    }
});
exports.stockRoutes.post('/units', async (req, res) => {
    try {
        const body = isObject(req.body) ? req.body : {};
        const name = toTrimmedString(body.name);
        if (!name)
            throw new HttpError(400, 'name is required');
        const created = await prisma.unit.create({ data: { name } });
        res.json({ success: true, data: created });
    }
    catch (error) {
        sendError(res, error);
    }
});
exports.stockRoutes.patch('/units/:id', async (req, res) => {
    try {
        const id = toOptionalPositiveInt(req.params.id, 'id');
        const body = isObject(req.body) ? req.body : {};
        const name = toTrimmedString(body.name);
        if (!id || !name)
            throw new HttpError(400, 'id and name are required');
        const updated = await prisma.unit.update({ where: { id }, data: { name } });
        res.json({ success: true, data: updated });
    }
    catch (error) {
        sendError(res, error);
    }
});
exports.stockRoutes.delete('/units/:id', async (req, res) => {
    try {
        const id = toOptionalPositiveInt(req.params.id, 'id');
        if (!id)
            throw new HttpError(400, 'id is required');
        const used = await prisma.product.count({ where: { unitId: id } });
        if (used > 0) {
            throw new HttpError(400, 'unit is in use by products');
        }
        await prisma.unit.delete({ where: { id } });
        res.json({ success: true });
    }
    catch (error) {
        sendError(res, error);
    }
});
exports.stockRoutes.get('/products', async (req, res) => {
    try {
        const query = req.query;
        const includeInactive = toOptionalBoolean(query.includeInactive, 'includeInactive') ?? false;
        const availableOnly = toOptionalBoolean(query.availableOnly, 'availableOnly') ?? false;
        const productFilters = buildProductSearchFilters(query);
        if (!includeInactive)
            productFilters.push({ isActive: true });
        const where = productFilters.length ? { AND: productFilters } : {};
        const products = await prisma.product.findMany({
            where,
            include: { category: true, unit: true },
            orderBy: [{ name: 'asc' }, { sku: 'asc' }],
        });
        const rows = await toStockSummaryRows(products);
        const list = availableOnly ? rows.filter((item) => item.onHand > 0) : rows;
        res.json({ success: true, data: list });
    }
    catch (error) {
        sendError(res, error);
    }
});
exports.stockRoutes.post('/products', async (req, res) => {
    try {
        const body = isObject(req.body) ? req.body : {};
        const sku = toTrimmedString(body.sku);
        const name = toTrimmedString(body.name);
        const categoryId = toOptionalPositiveInt(body.categoryId, 'categoryId');
        const unitId = toOptionalPositiveInt(body.unitId, 'unitId');
        const isActive = toOptionalBoolean(body.isActive, 'isActive') ?? true;
        if (!sku || !name || !categoryId || !unitId) {
            throw new HttpError(400, 'sku, name, categoryId and unitId are required');
        }
        const created = await prisma.product.create({
            data: {
                sku,
                name,
                categoryId,
                unitId,
                isActive,
            },
            include: { category: true, unit: true },
        });
        res.json({
            success: true,
            data: {
                productId: created.id,
                sku: created.sku,
                name: created.name,
                categoryId: created.categoryId,
                category: created.category.name,
                unitId: created.unitId,
                unit: created.unit.name,
                isActive: created.isActive,
                inQty: 0,
                outQty: 0,
                onHand: 0,
            },
        });
    }
    catch (error) {
        sendError(res, error);
    }
});
exports.stockRoutes.patch('/products/:id', async (req, res) => {
    try {
        const id = toOptionalPositiveInt(req.params.id, 'id');
        const body = isObject(req.body) ? req.body : {};
        if (!id)
            throw new HttpError(400, 'id is required');
        const sku = toTrimmedString(body.sku);
        const name = toTrimmedString(body.name);
        const categoryId = toOptionalPositiveInt(body.categoryId, 'categoryId');
        const unitId = toOptionalPositiveInt(body.unitId, 'unitId');
        const isActive = toOptionalBoolean(body.isActive, 'isActive');
        if (!sku && !name && !categoryId && !unitId && isActive == null) {
            throw new HttpError(400, 'at least one field is required to update');
        }
        const updated = await prisma.product.update({
            where: { id },
            data: {
                ...(sku ? { sku } : {}),
                ...(name ? { name } : {}),
                ...(categoryId ? { categoryId } : {}),
                ...(unitId ? { unitId } : {}),
                ...(isActive != null ? { isActive } : {}),
            },
            include: { category: true, unit: true },
        });
        const onHand = await getOnHandByProductId(updated.id);
        res.json({
            success: true,
            data: {
                productId: updated.id,
                sku: updated.sku,
                name: updated.name,
                categoryId: updated.categoryId,
                category: updated.category.name,
                unitId: updated.unitId,
                unit: updated.unit.name,
                isActive: updated.isActive,
                onHand,
            },
        });
    }
    catch (error) {
        sendError(res, error);
    }
});
exports.stockRoutes.get('/summary', async (req, res) => {
    try {
        const query = req.query;
        const includeInactive = toOptionalBoolean(query.includeInactive, 'includeInactive') ?? false;
        const { page, pageSize, skip } = parsePagination(query);
        const inQtyMin = toOptionalNumber(query.inQtyMin, 'inQtyMin');
        const inQtyMax = toOptionalNumber(query.inQtyMax, 'inQtyMax');
        const outQtyMin = toOptionalNumber(query.outQtyMin, 'outQtyMin');
        const outQtyMax = toOptionalNumber(query.outQtyMax, 'outQtyMax');
        const onHandMin = toOptionalNumber(query.onHandMin, 'onHandMin');
        const onHandMax = toOptionalNumber(query.onHandMax, 'onHandMax');
        ensureRange(inQtyMin, inQtyMax, 'inQty');
        ensureRange(outQtyMin, outQtyMax, 'outQty');
        ensureRange(onHandMin, onHandMax, 'onHand');
        const filters = buildProductSearchFilters(query);
        if (!includeInactive)
            filters.push({ isActive: true });
        const where = filters.length ? { AND: filters } : {};
        const products = await prisma.product.findMany({
            where,
            include: { category: true, unit: true },
            orderBy: [{ name: 'asc' }, { sku: 'asc' }],
        });
        const rows = await toStockSummaryRows(products);
        const filteredRows = rows.filter((row) => {
            if (!passRange(row.inQty, inQtyMin, inQtyMax))
                return false;
            if (!passRange(row.outQty, outQtyMin, outQtyMax))
                return false;
            if (!passRange(row.onHand, onHandMin, onHandMax))
                return false;
            return true;
        });
        const total = filteredRows.length;
        const list = filteredRows.slice(skip, skip + pageSize);
        res.json({
            success: true,
            data: {
                list,
                pagination: {
                    page,
                    pageSize,
                    total,
                    totalPages: Math.max(1, Math.ceil(total / pageSize)),
                },
            },
        });
    }
    catch (error) {
        sendError(res, error);
    }
});
exports.stockRoutes.get('/in', async (req, res) => {
    try {
        const query = req.query;
        const { page, pageSize, skip } = parsePagination(query);
        const where = buildTransactionWhere(query, client_1.StockTxType.IN);
        const [total, list] = await Promise.all([
            prisma.stockTransaction.count({ where }),
            prisma.stockTransaction.findMany({
                where,
                include: { product: { include: { category: true, unit: true } } },
                orderBy: [{ txDate: 'desc' }, { id: 'desc' }],
                skip,
                take: pageSize,
            }),
        ]);
        const { inMap, outMap } = await getStockMaps(list.map((item) => item.productId));
        const onHandMap = new Map();
        for (const item of list) {
            const inQty = inMap.get(item.productId) ?? 0;
            const outQty = outMap.get(item.productId) ?? 0;
            onHandMap.set(item.productId, inQty - outQty);
        }
        res.json({
            success: true,
            data: {
                list: list.map((item) => mapTransactionRow(item, client_1.StockTxType.IN, onHandMap)),
                pagination: {
                    page,
                    pageSize,
                    total,
                    totalPages: Math.max(1, Math.ceil(total / pageSize)),
                },
            },
        });
    }
    catch (error) {
        sendError(res, error);
    }
});
exports.stockRoutes.post('/in', async (req, res) => {
    try {
        const body = isObject(req.body) ? req.body : {};
        const created = await createTransaction(body, client_1.StockTxType.IN);
        res.json({ success: true, data: created });
    }
    catch (error) {
        sendError(res, error);
    }
});
exports.stockRoutes.get('/out', async (req, res) => {
    try {
        const query = req.query;
        const { page, pageSize, skip } = parsePagination(query);
        const where = buildTransactionWhere(query, client_1.StockTxType.OUT);
        const [total, list] = await Promise.all([
            prisma.stockTransaction.count({ where }),
            prisma.stockTransaction.findMany({
                where,
                include: { product: { include: { category: true, unit: true } } },
                orderBy: [{ txDate: 'desc' }, { id: 'desc' }],
                skip,
                take: pageSize,
            }),
        ]);
        const { inMap, outMap } = await getStockMaps(list.map((item) => item.productId));
        const onHandMap = new Map();
        for (const item of list) {
            const inQty = inMap.get(item.productId) ?? 0;
            const outQty = outMap.get(item.productId) ?? 0;
            onHandMap.set(item.productId, inQty - outQty);
        }
        res.json({
            success: true,
            data: {
                list: list.map((item) => mapTransactionRow(item, client_1.StockTxType.OUT, onHandMap)),
                pagination: {
                    page,
                    pageSize,
                    total,
                    totalPages: Math.max(1, Math.ceil(total / pageSize)),
                },
            },
        });
    }
    catch (error) {
        sendError(res, error);
    }
});
exports.stockRoutes.post('/out', async (req, res) => {
    try {
        const body = isObject(req.body) ? req.body : {};
        const created = await createTransaction(body, client_1.StockTxType.OUT);
        res.json({ success: true, data: created });
    }
    catch (error) {
        sendError(res, error);
    }
});
