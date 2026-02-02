// import { Router } from 'express';
// import { huaweiService } from '../services/huaweiService';

// const router = Router();

// /**
//  * GET /api/huawei/debug/all
//  * - login (ensureLoggedIn)
//  * - end1: stations (page1)
//  * - end2: getStationRealKpi (ใช้ stationCodes จาก end1)
//  * - end3: getKpiStationDay (ใช้ collectTime = end2.params.currentTime)
//  * - end4: getDevList (ใช้ stationCodes เดิม)
//  * - end5: getDevRealKpi (ใช้ devIds จาก end4 id โดย filter devTypeId=1)
//  */
// router.get('/debug/all', async (req, res) => {
//   try {
//     await huaweiService.ensureLoggedIn();

//     // ---------- END1: stations ----------
//     const end1 = await huaweiService.stations({ pageNo: 1, pageSize: 100 });
//     if (!end1?.success) return res.status(500).json({ step: 'end1(stations)', end1 });

//     const stations = end1?.data?.list ?? [];
//     const stationCodes = stations
//       .map((s: any) => s.plantCode ?? s.stationCode)
//       .filter(Boolean)
//       .map(String);

//     // จำกัดจำนวน stationCodes เพื่อกัน 407
//     const stationCodesLimited = stationCodes.slice(0, 3);
//     const stationCodesStr = stationCodesLimited.join(',');

//     // ---------- END2: getStationRealKpi ----------
//     // NOTE: ถ้าใน HuaweiService คุณยังไม่มี method นี้ ให้ใช้ axios post โดยเพิ่ม method ทีหลัง
//     const end2 = await (huaweiService as any).postRaw?.('/thirdData/getStationRealKpi', {
//       stationCodes: stationCodesStr,
//     }) ?? null;

//     // ถ้าไม่มี postRaw ให้ fallback ใช้ getDevRealKpi ไม่ได้ ต้องเพิ่ม helper ใน service
//     // ผมแนะนำเพิ่ม helper postRaw ใน HuaweiService ด้านล่าง

//     // ---------- END3: getKpiStationDay ----------
//     const currentTime = end2?.params?.currentTime ?? end2?.data?.params?.currentTime ?? null;
//     const collectTime = currentTime; // ตาม doc: currentTime -> collectTime (ms)
//     const end3 = currentTime
//       ? await (huaweiService as any).postRaw?.('/thirdData/getKpiStationDay', {
//           stationCodes: stationCodesStr,
//           collectTime,
//         })
//       : null;

//     // ---------- END4: getDevList ----------
//     const end4 = await huaweiService.getDevList(stationCodesStr);
//     let devIdsLimited: string[] = [];

//     if (end4?.success && Array.isArray(end4.data)) {
//       devIdsLimited = end4.data
//         .filter((d: any) => Number(d.devTypeId) === 1)
//         .map((d: any) => String(d.id))
//         .slice(0, 5);
//     }

//     // ---------- END5: getDevRealKpi ----------
//     const end5 = devIdsLimited.length
//       ? await huaweiService.getDevRealKpi({ devTypeId: 1, devIds: devIdsLimited.join(',') })
//       : null;

//     return res.json({
//       note: 'Limited stationCodes/devIds to avoid 407 rate-limit',
//       stationCodesSample: stationCodesLimited,
//       devIdsSample: devIdsLimited,
//       end1,
//       end2,
//       end3,
//       end4,
//       end5,
//     });
//   } catch (err: any) {
//     return res.status(500).json({ error: String(err?.message ?? err) });
//   }
// });

// export default router;
