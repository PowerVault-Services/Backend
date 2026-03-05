import { Router } from 'express';
import {
  listProjects,
  listCleaningJobs,
  createDraftStep1,
  getCleaningJob,
  saveStep2Draft,
  sendStep2Email,
  uploadEvidence,
  saveChecklist,
  generateReport,
  sendStep5Email,
  downloadReportRedirect,
} from '../controllers/cleaningController';
import { upload } from '../middlewares/upload';

const router = Router();

// Step1: dropdown project + auto fill
router.get('/projects', listProjects);

// Homepage list: รายการ Cleaning Job ที่ถูกสร้างแล้ว
router.get('/jobs', listCleaningJobs);

// create/update step1 -> ได้ jobId กลับไป
router.post('/step1', createDraftStep1);

// load data ทั้งก้อนตาม jobId
router.get('/job/:jobId', getCleaningJob);

// Step2: draft + upload file
router.post('/step2/draft', upload.array('files', 10), saveStep2Draft);
router.post('/step2/send', sendStep2Email);

// Step3.1: upload รูปก่อน/หลัง/อื่นๆ
router.post('/step3/evidence', upload.array('files', 30), uploadEvidence);

// Step3.2: checklist
router.post('/step3/checklist', saveChecklist);

// Step4: generate report + preview url
router.post('/step4/generate', generateReport);
router.get('/step4/download/:jobId', downloadReportRedirect);

// Step5: send report email
router.post('/step5/send', sendStep5Email);

export default router;
