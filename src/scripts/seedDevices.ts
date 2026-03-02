import prisma from '../config/prisma';
import { huaweiService } from '../services/huaweiService';

async function main() {
  console.log('🚀 Starting Device Discovery...');

  try {
    // 1. ดึงรายชื่อ Plant ทั้งหมดจาก Huawei
    const stationsResponse = await huaweiService.getStationList();
    if (!stationsResponse.success) throw new Error('Failed to get stations');
    
    const stations = stationsResponse.data.list || [];
    console.log(`📡 Found ${stations.length} stations from Huawei.`);

    for (const station of stations) {
      const plantCode = station.plantCode || station.stationCode; 
      
      const site = await prisma.site.upsert({
        where: { plantCode: plantCode },
        update: {}, 
        create: {
          plantCode: plantCode,
          name: station.plantName,
          address: station.plantAddress || 'Unknown',
          capacityKWp: station.capacity || 0,
        },
      });
      console.log(`   ✅ Synced Site: ${site.name}`);

      // 3. ดึง Inverter ของ Plant นี้
      const devResponse = await huaweiService.getDevList(site.plantCode);
      if (devResponse.success && devResponse.data) {
          const devices = devResponse.data;
          
          // กรองเอาเฉพาะ Inverter (devTypeId = 1 คือ Inverter, 38 = Grid Meter - ต้องเช็ค Doc)
          // สมมติว่าเราเอาหมดก่อนแล้วค่อยกรอง
          for (const dev of devices) {
             // เช็คว่าเป็น Inverter ไหม (DevTypeId 1 หรือ 38)
             // *หมายเหตุ: Huawei devTypeId: 1=Inverter, 47=Meter (อาจต่างกันตาม firmware)
             if (dev.devTypeId === 1) { 
                 await prisma.inverter.upsert({
                     where: { serialNumber: dev.esnCode || dev.dn }, // ใช้ SN เป็นหลัก
                     update: {},
                     create: {
                         serialNumber: dev.esnCode || dev.dn,
                         name: dev.devName,
                         model: dev.invType || 'Unknown',
                         siteId: site.id
                     }
                 });
                 console.log(`      Found Inverter: ${dev.devName}`);
             }
          }
      }
    }

    console.log('🎉 Device Discovery Completed!');

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();