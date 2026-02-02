import { PrismaClient, Role } from '@prisma/client';
import bcrypt from 'bcryptjs';
import * as process from 'process';

const prisma = new PrismaClient();

async function main() {
  // 1. สร้าง Password Hash
  const passwordHash = await bcrypt.hash('admin1234', 10);

  // 2. สร้าง User Admin
  const admin = await prisma.user.upsert({
    where: { username: 'admin' },
    update: {},
    create: {
      username: 'admin',
      password: passwordHash,
      email: 'admin@solar.com',
      firstName: 'Super',
      lastName: 'Admin',
      role: Role.ADMIN, 
    },
  });

  // Service Team(ไว้เทส Role)
  const serviceUser = await prisma.user.upsert({
    where: { username: 'service1' },
    update: {},
    create: {
      username: 'service1',
      password: passwordHash,
      email: 'service1@solar.com',
      firstName: 'Somchai',
      lastName: 'Fixer',
      role: Role.SERVICE_TEAM,
    },
  });

  console.log({ admin, serviceUser });
}

main()
 .catch((e) => {
    console.error(e);
    process.exit(1);
  })
 .finally(async () => {
    await prisma.$disconnect();
  });