"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const clientDataController_1 = require("../controllers/clientDataController");
const upload_1 = require("../middlewares/upload");
const router = (0, express_1.Router)();
// -------------------------
// PowerVault (Thailand)
// -------------------------
router.get('/thailand/projects', clientDataController_1.listProjectsThailand);
router.post('/thailand/projects', clientDataController_1.createProject);
router.put('/thailand/projects/:siteId', clientDataController_1.updateProject);
router.delete('/thailand/projects/:siteId', clientDataController_1.deleteProject);
// -------------------------
// PowerVault Service
// -------------------------
router.get('/service/entries', clientDataController_1.listProjectsService);
router.post('/service/entries', clientDataController_1.createServiceEntry);
router.put('/service/entries/:entryId', clientDataController_1.updateServiceEntry);
router.delete('/service/entries/:entryId', clientDataController_1.deleteServiceEntry);
// -------------------------
// Project detail tabs
// -------------------------
router.get('/projects/:siteId', clientDataController_1.getProjectDetail);
// Warranty
router.post('/projects/:siteId/warranty/supplier', clientDataController_1.createWarrantySupplierItem);
router.put('/warranty/supplier/:itemId', clientDataController_1.updateWarrantySupplierItem);
router.delete('/warranty/supplier/:itemId', clientDataController_1.deleteWarrantySupplierItem);
router.post('/projects/:siteId/warranty/customer', clientDataController_1.createWarrantyCustomerItem);
router.put('/warranty/customer/:itemId', clientDataController_1.updateWarrantyCustomerItem);
router.delete('/warranty/customer/:itemId', clientDataController_1.deleteWarrantyCustomerItem);
// Layout upload (PV Layout / PV String Layout)
router.post('/projects/:siteId/layouts/:type', upload_1.upload.single('file'), clientDataController_1.upsertLayout);
// Forecast
router.put('/projects/:siteId/forecast/pvsyst', clientDataController_1.upsertForecastMonthly);
router.post('/projects/:siteId/forecast/defaults', clientDataController_1.generateForecastDefaults);
router.put('/projects/:siteId/forecast/warranty-energy', clientDataController_1.upsertForecastYearly);
// Other tab
router.post('/projects/:siteId/other', clientDataController_1.createOtherRow);
router.put('/other/:rowId', clientDataController_1.updateOtherRow);
router.delete('/other/:rowId', clientDataController_1.deleteOtherRow);
exports.default = router;
