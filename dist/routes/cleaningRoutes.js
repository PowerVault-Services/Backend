"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const cleaningController_1 = require("../controllers/cleaningController");
const upload_1 = require("../middlewares/upload");
const router = (0, express_1.Router)();
// Step1: dropdown project + auto fill
router.get('/projects', cleaningController_1.listProjects);
// Homepage list: รายการ Cleaning Job ที่ถูกสร้างแล้ว
router.get('/jobs', cleaningController_1.listCleaningJobs);
// create/update step1 -> ได้ jobId กลับไป
router.post('/step1', cleaningController_1.createDraftStep1);
// load data ทั้งก้อนตาม jobId
router.get('/job/:jobId', cleaningController_1.getCleaningJob);
router.put('/job/:jobId', cleaningController_1.updateCleaningJob);
router.delete('/job/:jobId', cleaningController_1.deleteCleaningJob);
router.get('/jobs/download-zip', cleaningController_1.downloadCleaningReportsZip);
router.post('/jobs/download-zip', cleaningController_1.downloadCleaningReportsZip);
// Step2: draft + upload file
router.post('/step2/draft', upload_1.upload.array('files', 10), cleaningController_1.saveStep2Draft);
router.post('/step2/send', cleaningController_1.sendStep2Email);
// Step3.1: upload รูปก่อน/หลัง/อื่นๆ
router.post('/step3/evidence', upload_1.upload.array('files', 30), cleaningController_1.uploadEvidence);
// Step3.2: checklist
router.post('/step3/checklist', cleaningController_1.saveChecklist);
// Step4: generate report + preview url
router.post('/step4/generate', cleaningController_1.generateReport);
router.get('/step4/download/:jobId', cleaningController_1.downloadReportRedirect);
// Step5: send report email
router.post('/step5/draft', cleaningController_1.saveStep5Draft);
router.post('/step5/send', cleaningController_1.sendStep5Email);
exports.default = router;
