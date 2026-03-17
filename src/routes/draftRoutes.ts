import { Router } from 'express';
import { listDrafts, listEmailSignatures, saveDraftProgress } from '../controllers/draftController';

const router = Router();

// ปุ่ม Save Draft: อัปเดต job.step / job.status
router.post('/save', saveDraftProgress);

router.get('/email-signatures', listEmailSignatures);

// list draft jobs
router.get('/', listDrafts);

export default router;
