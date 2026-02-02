import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

//ตรวจสอบว่ามี Token ไหม?
export const authenticateToken = (req: Request, res: Response, next: NextFunction) => {
  // 1. ดึง Token จาก Header (รูปแบบ: Bearer <token>)
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // เอาเฉพาะตัวหลัง Bearer

  // ถ้าไม่มี Token (401 Unauthorized)
  if (!token) {
    return res.status(401).json({ message: 'Access Denied: No Token Provided' });
  }

  // ถ้ามีตรวจสอบว่าของจริงไหม
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as any;
    req.user = decoded; // แปะข้อมูล User ลงใน req เพื่อส่งให้ด่านถัดไป
    next(); // ผ่านไปได้!
  } catch (error) {
    return res.status(403).json({ message: 'Invalid Token' }); // 403 Forbidden
  }
};

// ตรวจสอบ Role เช่น เฉพาะAdmin 
export const authorizeRole = (allowedRoles: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ 
        message: `Access Denied: Requires ${allowedRoles.join(' or ')} role` 
      });
    }
    next();
  };
};