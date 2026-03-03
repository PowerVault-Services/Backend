"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const inspectionController_1 = require("../controllers/inspectionController");
// ✅ ใช้ตัว upload ที่เซฟไฟล์แบบมีนามสกุล (diskStorage)
const upload_1 = require("../middlewares/upload");
const router = (0, express_1.Router)();
router.get('/projects', inspectionController_1.listProjects);
router.post('/step1', inspectionController_1.createDraftStep1);
router.get('/job/:jobId', inspectionController_1.getInspectionJob);
// step2: attachments หลายไฟล์ ใช้ field name = "attachments"
router.post('/step2/draft', upload_1.upload.array('attachments', 20), inspectionController_1.saveStep2Draft);
router.post('/step2/send', inspectionController_1.sendStep2Email);
// step3: report ไฟล์เดียว field name = "report"
router.post('/step3/draft', upload_1.upload.single('report'), inspectionController_1.saveStep3Draft);
router.post('/step3/send', inspectionController_1.sendStep3Email);
exports.default = router;
