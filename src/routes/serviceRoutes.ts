import { Router } from 'express';

import {
  listProjects,
  listServiceJobs,
  createDraftStep1,
  getServiceJob,
  saveStep2Draft,
  sendStep2Email,
  saveStep3Draft,
  generateReport,
  downloadReportRedirect,
  saveStep5Draft,
  sendStep5Email,
} from '../controllers/serviceController';

import { upload } from '../middlewares/upload';

const router = Router();

// Step1: dropdown project + auto fill
router.get('/projects', listProjects);

// Homepage list
router.get('/jobs', listServiceJobs);

// create/update step1 -> ได้ jobId กลับไป
router.post('/step1', createDraftStep1);

// load data ทั้งก้อนตาม jobId
router.get('/job/:jobId', getServiceJob);

// Step2: draft + upload file (attachments)
router.post('/step2/draft', upload.array('attachments', 20), saveStep2Draft);
router.post('/step2/send', sendStep2Email);

// Step3: draft (Service Report form + evidence) — multipart
// fields: jobId, (optional) metaJson
// files:
//   - serviceReport (single) : รูปฟอร์ม Service Report (แนะนำ jpg/png)
//   - evidence (multi)       : รูปหลักฐานอื่น ๆ
router.post(
  '/step3/draft',
  upload.fields([
    { name: 'serviceReport', maxCount: 1 },
    { name: 'evidence', maxCount: 30 },
  ]),
  saveStep3Draft,
);

// Step4: generate report + preview url
router.post('/step4/generate', generateReport);
router.get('/step4/download/:jobId', downloadReportRedirect);

// Step5: send report email
router.post('/step5/draft', saveStep5Draft);
router.post('/step5/send', sendStep5Email);

export default router;
