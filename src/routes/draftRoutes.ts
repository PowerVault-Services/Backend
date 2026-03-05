import { Router } from 'express';
import { listDrafts, saveDraftProgress } from '../controllers/draftController';

const router = Router();

// ปุ่ม Save Draft: อัปเดต job.step / job.status
router.post('/save', saveDraftProgress);

// list draft jobs
router.get('/', listDrafts);

export default router;
