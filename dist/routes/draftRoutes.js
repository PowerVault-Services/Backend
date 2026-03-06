"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const draftController_1 = require("../controllers/draftController");
const router = (0, express_1.Router)();
// ปุ่ม Save Draft: อัปเดต job.step / job.status
router.post('/save', draftController_1.saveDraftProgress);
// list draft jobs
router.get('/', draftController_1.listDrafts);
exports.default = router;
