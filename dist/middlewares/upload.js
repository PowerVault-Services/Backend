"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.upload = void 0;
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const crypto_1 = __importDefault(require("crypto"));
const storageService_1 = require("../services/storageService");
const uploadDir = (0, storageService_1.createTemporaryUploadDir)();
const storage = multer_1.default.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => {
        const ext = path_1.default.extname(file.originalname) || '';
        const name = `${Date.now()}-${crypto_1.default.randomBytes(8).toString('hex')}${ext.toLowerCase()}`;
        cb(null, name);
    },
});
exports.upload = (0, multer_1.default)({ storage });
