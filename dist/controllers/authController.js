"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.login = void 0;
const client_1 = require("@prisma/client");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const prisma = new client_1.PrismaClient();
const login = async (req, res) => {
    try {
        const { username, password } = req.body;
        // 1. ค้นหา User จาก Database
        const user = await prisma.user.findUnique({
            where: { username },
        });
        // 2. ถ้าไม่เจอ User หรือ Password ไม่ตรง
        if (!user || !(await bcryptjs_1.default.compare(password, user.password))) {
            return res.status(401).json({ message: 'Invalid username or password' });
        }
        // 3. สร้าง JWT Token (บัตรผ่าน)
        const token = jsonwebtoken_1.default.sign({ userId: user.id, role: user.role }, // ข้อมูลที่จะฝังใน Token
        process.env.JWT_SECRET, { expiresIn: '1d' } // อายุ 1 วัน
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
    }
    catch (error) {
        res.status(500).json({ message: 'Internal server error' });
    }
};
exports.login = login;
