"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const prisma_1 = __importDefault(require("../config/prisma"));
const router = (0, express_1.Router)();
function parseMonth(value) {
    const m = value.match(/^(\d{4})-(\d{2})$/);
    if (!m)
        return null;
    const year = Number(m[1]);
    const month = Number(m[2]);
    if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12)
        return null;
    const start = new Date(year, month - 1, 1, 0, 0, 0, 0);
    const endExclusive = new Date(year, month, 1, 0, 0, 0, 0);
    return { start, endExclusive };
}
router.get('/', async (req, res) => {
    const siteId = req.query.siteId != null ? Number(req.query.siteId) : null;
    if (req.query.siteId != null && !Number.isFinite(siteId))
        return res.status(400).json({ error: 'Invalid siteId' });
    const startMonth = req.query.startMonth != null ? String(req.query.startMonth) : null;
    const endMonth = req.query.endMonth != null ? String(req.query.endMonth) : null;
    let createdAtFilter = undefined;
    if (startMonth || endMonth) {
        const startParsed = startMonth ? parseMonth(startMonth) : null;
        const endParsed = endMonth ? parseMonth(endMonth) : null;
        if (startMonth && !startParsed)
            return res.status(400).json({ error: 'Invalid startMonth (expected YYYY-MM)' });
        if (endMonth && !endParsed)
            return res.status(400).json({ error: 'Invalid endMonth (expected YYYY-MM)' });
        // If only endMonth is provided -> start is very old
        const gte = startParsed?.start ?? new Date('2000-01-01T00:00:00.000Z');
        // endMonth endExclusive; if not provided -> now + 1 year
        const lt = endParsed?.endExclusive ?? new Date(new Date().getFullYear() + 1, 0, 1);
        createdAtFilter = { gte, lt };
    }
    const jobs = await prisma_1.default.job.findMany({
        where: {
            ...(siteId ? { siteId } : {}),
            ...(createdAtFilter ? { createdAt: createdAtFilter } : {}),
        },
        include: {
            site: { select: { id: true, name: true } },
            cleaningJob: { select: { reportFileUrl: true, reportCreatedAt: true } },
            serviceJob: { select: { reportFileUrl: true, reportCreatedAt: true } },
            inspectionJob: { select: { reportFileUrl: true, reportCreatedAt: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 200,
    });
    const docs = jobs
        .map((j) => {
        const reportUrl = j.reportUrl ??
            j.cleaningJob?.reportFileUrl ??
            j.serviceJob?.reportFileUrl ??
            j.inspectionJob?.reportFileUrl ??
            null;
        const reportCreatedAt = j.cleaningJob?.reportCreatedAt ?? j.serviceJob?.reportCreatedAt ?? j.inspectionJob?.reportCreatedAt ?? null;
        return {
            id: j.id,
            jobNo: j.jobNo,
            title: j.title,
            type: j.type,
            status: j.status,
            site: j.site,
            createdAt: j.createdAt,
            reportCreatedAt,
            previewUrl: reportUrl,
            downloadUrl: reportUrl,
        };
    })
        .filter((d) => d.previewUrl);
    res.json({ success: true, data: { list: docs } });
});
exports.default = router;
