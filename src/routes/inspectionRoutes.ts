import { Router } from 'express';

import {
  listProjects,
  listInspectionJobs,
  createDraftStep1,
  getInspectionJob,
  saveStep2Draft,
  sendStep2Email,
  saveStep3Draft,
  sendStep3Email,
  updateInspectionJob,
  deleteInspectionJob,
  downloadInspectionReportsZip,
} from '../controllers/inspectionController';

// ✅ ใช้ตัว upload ที่เซฟไฟล์แบบมีนามสกุล (diskStorage)
import { upload } from '../middlewares/upload';

const router = Router();

router.get('/projects', listProjects);

// Homepage list
router.get('/jobs', listInspectionJobs);

router.post('/step1', createDraftStep1);
router.get('/job/:jobId', getInspectionJob);
router.put('/job/:jobId', updateInspectionJob);
router.delete('/job/:jobId', deleteInspectionJob);

router.get('/jobs/download-zip', downloadInspectionReportsZip);
router.post('/jobs/download-zip', downloadInspectionReportsZip);

// step2: attachments หลายไฟล์ ใช้ field name = "attachments"
router.post('/step2/draft', upload.array('attachments', 20), saveStep2Draft);
router.post('/step2/send', sendStep2Email);

// step3: report ไฟล์เดียว field name = "report"
router.post('/step3/draft', upload.single('report'), saveStep3Draft);
router.post('/step3/send', sendStep3Email);

export default router;
