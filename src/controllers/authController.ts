import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const prisma = new PrismaClient();

export const login = async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;

    // 1. ค้นหา User จาก Database
    const user = await prisma.user.findUnique({
      where: { username },
    });

    // 2. ถ้าไม่เจอ User หรือ Password ไม่ตรง
    if (!user ||!(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ message: 'Invalid username or password' });
    }

    // 3. สร้าง JWT Token (บัตรผ่าน)
    const token = jwt.sign(
      { userId: user.id, role: user.role }, // ข้อมูลที่จะฝังใน Token
      process.env.JWT_SECRET as string,
      { expiresIn: '1d' } // อายุ 1 วัน
    );

    // 4. ส่ง Token กลับไปให้ Client พร้อมข้อมูลเบื้องต้น
    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        firstName: user.firstName,
      }
    });

  } catch (error) {
    res.status(500).json({ message: 'Internal server error' });
  }
};