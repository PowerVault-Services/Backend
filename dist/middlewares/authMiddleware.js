"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authorizeRole = exports.authenticateToken = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
//ตรวจสอบว่ามี Token ไหม?
const authenticateToken = (req, res, next) => {
    // 1. ดึง Token จาก Header (รูปแบบ: Bearer <token>)
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // เอาเฉพาะตัวหลัง Bearer
    // ถ้าไม่มี Token (401 Unauthorized)
    if (!token) {
        return res.status(401).json({ message: 'Access Denied: No Token Provided' });
    }
    // ถ้ามีตรวจสอบว่าของจริงไหม
    try {
        const decoded = jsonwebtoken_1.default.verify(token, process.env.JWT_SECRET);
        req.user = decoded; // แปะข้อมูล User ลงใน req เพื่อส่งให้ด่านถัดไป
        next(); // ผ่านไปได้!
    }
    catch (error) {
        return res.status(403).json({ message: 'Invalid Token' }); // 403 Forbidden
    }
};
exports.authenticateToken = authenticateToken;
// ตรวจสอบ Role เช่น เฉพาะAdmin 
const authorizeRole = (allowedRoles) => {
    return (req, res, next) => {
        if (!req.user || !allowedRoles.includes(req.user.role)) {
            return res.status(403).json({
                message: `Access Denied: Requires ${allowedRoles.join(' or ')} role`
            });
        }
        next();
    };
};
exports.authorizeRole = authorizeRole;
