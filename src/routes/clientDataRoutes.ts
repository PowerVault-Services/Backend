import { Router } from 'express';

import {
  listProjectsThailand,
  listProjectsService,
  createProject,
  updateProject,
  getProjectDetail,
  deleteProject,
  upsertLayout,
  upsertForecastMonthly,
  upsertForecastYearly,
  generateForecastDefaults,
  createOtherRow,
  updateOtherRow,
  deleteOtherRow,
  uploadSiteImage,
  updateSiteImage,
  deleteSiteImage,
  createWarrantySupplierItem,
  updateWarrantySupplierItem,
  deleteWarrantySupplierItem,
  createWarrantyCustomerItem,
  updateWarrantyCustomerItem,
  deleteWarrantyCustomerItem,
  createServiceEntry,
  updateServiceEntry,
  deleteServiceEntry,
} from '../controllers/clientDataController';

import {
  listPlants,
  getPlantDetail,
  createPlant,
  updatePlant,
  deletePlant,
} from '../controllers/plantController';

import { upload } from '../middlewares/upload';

const router = Router();

// -------------------------
// PowerVault (Thailand)
// -------------------------
router.get('/thailand/projects', listProjectsThailand);
router.post('/thailand/projects', createProject);
router.put('/thailand/projects/:siteId', updateProject);
router.delete('/thailand/projects/:siteId', deleteProject);

// -------------------------
// PowerVault Service
// -------------------------
router.get('/service/entries', listProjectsService);
router.post('/service/entries', createServiceEntry);
router.put('/service/entries/:entryId', updateServiceEntry);
router.delete('/service/entries/:entryId', deleteServiceEntry);

// -------------------------
// Project detail tabs
// -------------------------
router.get('/projects/:siteId', getProjectDetail);

// Warranty
router.post('/projects/:siteId/warranty/supplier', createWarrantySupplierItem);
router.put('/warranty/supplier/:itemId', updateWarrantySupplierItem);
router.delete('/warranty/supplier/:itemId', deleteWarrantySupplierItem);

router.post('/projects/:siteId/warranty/customer', createWarrantyCustomerItem);
router.put('/warranty/customer/:itemId', updateWarrantyCustomerItem);
router.delete('/warranty/customer/:itemId', deleteWarrantyCustomerItem);

// Site image
router.post('/projects/:siteId/image', upload.single('file'), uploadSiteImage);
router.put('/projects/:siteId/image', upload.single('file'), updateSiteImage);
router.delete('/projects/:siteId/image', deleteSiteImage);

// Layout upload (PV Layout / PV String Layout)
router.post(
  '/projects/:siteId/layouts/:type',
  upload.single('file'),
  upsertLayout,
);

// Forecast
router.put('/projects/:siteId/forecast/pvsyst', upsertForecastMonthly);
router.post('/projects/:siteId/forecast/defaults', generateForecastDefaults);
router.put('/projects/:siteId/forecast/warranty-energy', upsertForecastYearly);

// Other tab
router.post('/projects/:siteId/other', createOtherRow);
router.put('/other/:rowId', updateOtherRow);
router.delete('/other/:rowId', deleteOtherRow);

// -------------------------
// Plants (client-only, no sync/monitoring)
// -------------------------
router.get('/plants', listPlants);
router.get('/plants/:siteId', getPlantDetail);
router.post('/plants', createPlant);
router.put('/plants/:siteId', updatePlant);
router.delete('/plants/:siteId', deletePlant);

export default router;
