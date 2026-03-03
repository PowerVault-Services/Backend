"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const serviceController_1 = require("../controllers/serviceController");
const upload_1 = require("../middlewares/upload");
const router = (0, express_1.Router)();
// Step1: dropdown project + auto fill
router.get('/projects', serviceController_1.listProjects);
// create/update step1 -> ได้ jobId กลับไป
router.post('/step1', serviceController_1.createDraftStep1);
// load data ทั้งก้อนตาม jobId
router.get('/job/:jobId', serviceController_1.getServiceJob);
// Step2: draft + upload file (attachments)
router.post('/step2/draft', upload_1.upload.array('attachments', 20), serviceController_1.saveStep2Draft);
router.post('/step2/send', serviceController_1.sendStep2Email);
// Step3: draft (Service Report form + evidence) — multipart
// fields: jobId, (optional) metaJson
// files:
//   - serviceReport (single) : รูปฟอร์ม Service Report (แนะนำ jpg/png)
//   - evidence (multi)       : รูปหลักฐานอื่น ๆ
router.post('/step3/draft', upload_1.upload.fields([
    { name: 'serviceReport', maxCount: 1 },
    { name: 'evidence', maxCount: 30 },
]), serviceController_1.saveStep3Draft);
// Step4: generate report + preview url
router.post('/step4/generate', serviceController_1.generateReport);
router.get('/step4/download/:jobId', serviceController_1.downloadReportRedirect);
// Step5: send report email
router.post('/step5/send', serviceController_1.sendStep5Email);
exports.default = router;
