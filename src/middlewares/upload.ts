import multer from 'multer';
import path from 'path';
import crypto from 'crypto';
import { createTemporaryUploadDir } from '../services/storageService';

const uploadDir = createTemporaryUploadDir();

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || '';
    const name = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext.toLowerCase()}`;
    cb(null, name);
  },
});

export const upload = multer({ storage });