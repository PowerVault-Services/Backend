import { Role } from '@prisma/client';
import prisma from '../src/config/prisma';
import bcrypt from 'bcryptjs';
import * as process from 'process';

// =====================
// Data generated from: ข้อมูลตัวอย่าง เว็บ PV.xlsx
// Sheets: เมนู Stock, ตัวอย่างข้อมูลโครงการ
// =====================

const STOCK_PRODUCTS = [
  {
    "sku": "P1001100300201",
    "name": "DC Fuse 25a ZJBENY",
    "unit": "EA",
    "category": "* ยังไม่ได้จัดหมวดหมู่"
  },
  {
    "sku": "P1001100300202",
    "name": "Fuse DC 10x38 25A 1000V",
    "unit": "EA",
    "category": "* ยังไม่ได้จัดหมวดหมู่"
  },
  {
    "sku": "P1001100300501",
    "name": "DC Fuse 15a ZJBENY",
    "unit": "EA",
    "category": "* ยังไม่ได้จัดหมวดหมู่"
  },
  {
    "sku": "P1000700101501",
    "name": "MC4 PAIR PV-KST4_KBT4 STAUBLI",
    "unit": "อัน",
    "category": "* ยังไม่ได้จัดหมวดหมู่"
  },
  {
    "sku": "PVS000",
    "name": "MC4 Fuse",
    "unit": "สาย",
    "category": "* ยังไม่ได้จัดหมวดหมู่"
  },
  {
    "sku": "P1000900300200",
    "name": "Janitza UMG96RM",
    "unit": "EA",
    "category": "* ยังไม่ได้จัดหมวดหมู่"
  },
  {
    "sku": "P1001500600201",
    "name": "2 Pair twisted, Shielded cable 22AWG (Indoor)",
    "unit": "เมตร",
    "category": "* ยังไม่ได้จัดหมวดหมู่"
  },
  {
    "sku": "P1000153103901",
    "name": "SMARTLOGGER 3000A00GL HUAWEI",
    "unit": "EA",
    "category": "* ยังไม่ได้จัดหมวดหมู่"
  },
  {
    "sku": "P1000101900100",
    "name": "JKM465 5-72 JINKO",
    "unit": "EA",
    "category": "* ยังไม่ได้จัดหมวดหมู่"
  },
  {
    "sku": "PVS001",
    "name": "สายเคเบิ้ลไทร์",
    "unit": "เส้น",
    "category": "* ยังไม่ได้จัดหมวดหมู่"
  },
  {
    "sku": "PVS002",
    "name": "Auto matic plump control",
    "unit": "ตัว",
    "category": "* ยังไม่ได้จัดหมวดหมู่"
  },
  {
    "sku": "PVS003",
    "name": "ข้อต่อยูเนี่ยนพีวิซี สีฟ้า ขนาด 1 นิ้ว",
    "unit": "EA",
    "category": "* ยังไม่ได้จัดหมวดหมู่"
  },
  {
    "sku": "PVS004",
    "name": "บอลวาล์วพีวีซี ขนาด 1 นิ้ว",
    "unit": "EA",
    "category": "* ยังไม่ได้จัดหมวดหมู่"
  },
  {
    "sku": "PVS005",
    "name": "Battery",
    "unit": "ตััว",
    "category": "* ยังไม่ได้จัดหมวดหมู่"
  },
  {
    "sku": "PVS006",
    "name": "ฐาน Fuse",
    "unit": "อัน",
    "category": "* ยังไม่ได้จัดหมวดหมู่"
  },
  {
    "sku": "PVS007",
    "name": "ท่อ PVC ขนาด 1 นิ้ว",
    "unit": "ชิ้น",
    "category": "* ยังไม่ได้จัดหมวดหมู่"
  },
  {
    "sku": "PVS008",
    "name": "น้ำยาประสานท่อ",
    "unit": "ขวด",
    "category": "* ยังไม่ได้จัดหมวดหมู่"
  },
  {
    "sku": "PVS009",
    "name": "ต่อตรงเกลียวใน สีฟ้า ขนาด 1 นิ้ว",
    "unit": "อัน",
    "category": "* ยังไม่ได้จัดหมวดหมู่"
  },
  {
    "sku": "PVS010",
    "name": "ต่อตรงเกลียวนอก สีฟ้า ขนาด 1 นิ้ว",
    "unit": "อัน",
    "category": "* ยังไม่ได้จัดหมวดหมู่"
  },
  {
    "sku": "PVS011",
    "name": "อะคริลิคกันรั่วซึมสะท้อนความร้อน SISTA D100 PLUS ขาว",
    "unit": "ถัง",
    "category": "* ยังไม่ได้จัดหมวดหมู่"
  },
  {
    "sku": "PVS012",
    "name": "แผ่นอะคริลิค หนา 3 มิล",
    "unit": "แผ่น",
    "category": "* ยังไม่ได้จัดหมวดหมู่"
  },
  {
    "sku": "PVS013",
    "name": "เทปกาวบิวทิล GIANT KINGKONG 1.5มม. x 10ซม. x 10ม. ดำ",
    "unit": "ม้วน",
    "category": "* ยังไม่ได้จัดหมวดหมู่"
  },
  {
    "sku": "PVS014",
    "name": "ตาข่ายไฟเบอร์ GIANT KINGKONG 20ซม. x 20ม. ขาว",
    "unit": "ม้วน",
    "category": "* ยังไม่ได้จัดหมวดหมู่"
  },
  {
    "sku": "PVS015",
    "name": "ตาข่ายไฟเบอร์มีกาว GIANT KINGKONG 20ซม. x 20ม. ขาว",
    "unit": "ม้วน",
    "category": "* ยังไม่ได้จัดหมวดหมู่"
  },
  {
    "sku": "PVS016",
    "name": "แปรงทาสีน้ำมันขนสัตว์ ด้ามพลาสติก 2 นิ้ว",
    "unit": "ด้าม",
    "category": "* ยังไม่ได้จัดหมวดหมู่"
  },
  {
    "sku": "PVS017",
    "name": "ถุงมือผ้าคอตตอน 7 ขีด ขาวขอบเหลือง 12คู่",
    "unit": "ถุง",
    "category": "* ยังไม่ได้จัดหมวดหมู่"
  },
  {
    "sku": "PVS018",
    "name": "เศษผ้าวน 10x10นิ้ว 1 กก",
    "unit": "ถุง",
    "category": "* ยังไม่ได้จัดหมวดหมู่"
  },
  {
    "sku": "PVS019",
    "name": "แคลมป์รัด ขนาด 32 มม. x 1/2 นิ้ว",
    "unit": "ตัว",
    "category": "* ยังไม่ได้จัดหมวดหมู่"
  },
  {
    "sku": "PVS020",
    "name": "แคลมป์รัด",
    "unit": "ตัว",
    "category": "* ยังไม่ได้จัดหมวดหมู่"
  },
  {
    "sku": "PVS021",
    "name": "ก๊อกบอลสลิมด้ามเขียว",
    "unit": "ตัว",
    "category": "* ยังไม่ได้จัดหมวดหมู่"
  },
  {
    "sku": "PVS022",
    "name": "ก๊อกน้ำ",
    "unit": "ตัว",
    "category": "* ยังไม่ได้จัดหมวดหมู่"
  },
  {
    "sku": "PVS023",
    "name": "แบต UPS 7.5 AH",
    "unit": "ตัว",
    "category": "* ยังไม่ได้จัดหมวดหมู่"
  },
  {
    "sku": "PVS024",
    "name": "ท่อ PVC ข้อต่่อ 3 ทาง",
    "unit": "ชิ้น",
    "category": "* ยังไม่ได้จัดหมวดหมู่"
  },
  {
    "sku": "PVS025",
    "name": "ท่อ PVC ข้อต่อตรง",
    "unit": "ชิ้น",
    "category": "* ยังไม่ได้จัดหมวดหมู่"
  },
  {
    "sku": "PVS026",
    "name": "ท่อ PVC ข้องอ",
    "unit": "ชิ้ิ้น",
    "category": "* ยังไม่ได้จัดหมวดหมู่"
  },
  {
    "sku": "PVS027",
    "name": "ปะกับ",
    "unit": "ตัว",
    "category": "* ยังไม่ได้จัดหมวดหมู่"
  },
  {
    "sku": "PVS028",
    "name": "ข้้อต่อตรง",
    "unit": "ตัว",
    "category": "* ยังไม่ได้จัดหมวดหมู่"
  },
  {
    "sku": "PVS029",
    "name": "แปรงทาสีน้ำมันขนสัตว์ ด้ามพลาสติก 2.5 นิ้ว",
    "unit": "ด้าม",
    "category": "* ยังไม่ได้จัดหมวดหมู่"
  },
  {
    "sku": "PVS030",
    "name": "แปรงทาสีน้ำมันขนสัตว์ ด้ามพลาสติก 3 นิ้ว",
    "unit": "ด้าม",
    "category": "* ยังไม่ได้จัดหมวดหมู่"
  },
  {
    "sku": "PVS031",
    "name": "ลูกลอย",
    "unit": "อัน",
    "category": "* ยังไม่ได้จัดหมวดหมู่"
  },
  {
    "sku": "PVS032",
    "name": "PQM 512 PRO",
    "unit": "เครื่อง",
    "category": "* ยังไม่ได้จัดหมวดหมู่"
  },
  {
    "sku": "PVS033",
    "name": "แคลมป์รัดแยก 90 mm/1\"",
    "unit": "อัน",
    "category": "* ยังไม่ได้จัดหมวดหมู่"
  },
  {
    "sku": "PVS034",
    "name": "เบรกเกอร์3P 200A CVS250F รุ่นF TM200D \n(140-200A) 36KA LV525332 SCHNEIDER",
    "unit": "อัน",
    "category": "* ยังไม่ได้จัดหมวดหมู่"
  },
  {
    "sku": "PVS035",
    "name": "เบรกเกอร์ 2P 30A รุ่นH 30KA EZC100H2030 SCHNEIDER",
    "unit": "อัน",
    "category": "* ยังไม่ได้จัดหมวดหมู่"
  },
  {
    "sku": "PVS036",
    "name": "AP-TRM-004 418110 Transmitter PLC outdoor kits (2P-Plus)",
    "unit": "อัน",
    "category": "* ยังไม่ได้จัดหมวดหมู่"
  },
  {
    "sku": "PVS037",
    "name": "SURGE PROTECTION CLASS I+II 3P ''HLSA25-275/3+0 S''",
    "unit": "ชุด",
    "category": "* ยังไม่ได้จัดหมวดหมู่"
  },
  {
    "sku": "PVS038",
    "name": "ท่ออุด",
    "unit": "ตัว",
    "category": "* ยังไม่ได้จัดหมวดหมู่"
  },
  {
    "sku": "PVS039",
    "name": "TRINA Vertex TSM DE21 660W 1",
    "unit": "แผง",
    "category": "* ยังไม่ได้จัดหมวดหมู่"
  },
  {
    "sku": "PVS040",
    "name": "Senser SR05-D2A2 PTRANOMETER HUKSEFLUX",
    "unit": "EA",
    "category": "* ยังไม่ได้จัดหมวดหมู่"
  },
  {
    "sku": "P100150B400000",
    "name": "SURGE RS485",
    "unit": "SET",
    "category": "* ยังไม่ได้จัดหมวดหมู่"
  }
] as const;
const PROJECT_SITE_IMPORTS = [
  {
    "region": "ตะวันออก",
    "projectName": "CPN Sriracha",
    "capacityKWp": 999.9,
    "pvModuleCount": 1980,
    "locationText": "ชลบุรี",
    "contactPhoneRaw": "คุณไก่ 088-6615635\nคุณสุรศักดิ์ 089-3564888",
    "contactEmailRaw": "jevichai@centralpattana.co.th\nchamnan@lenso.com\nCC : lsi-chanika@lenso.com\nsoravit_y@lenso.com",
    "matchStatus": "matched",
    "confidence": "high",
    "matchedDbId": 30.0,
    "matchedDbName": "Central Sriracha",
    "matchedDbPlantCode": "NE=50517504",
    "matchedDbAddress": "39/5 สุขุมวิท 9 Amphoe Si Racha, Chang Wat Chon Buri 20110, Thailand",
    "reason": "ชื่อ/พื้นที่/ความจุ/อีเมลตรงกันบางส่วน",
    "top3Candidates": ""
  },
  {
    "region": "กลาง",
    "projectName": "Robinson สระบุรี",
    "capacityKWp": 999.2,
    "pvModuleCount": 2498,
    "locationText": "สระบุรี",
    "contactPhoneRaw": "คุณทรงวุฒิ : 098-824-4488",
    "contactEmailRaw": "to : jusongwuth@central.co.th\ncc : Mallfmsaraburi@central.co.th\nOperationmanagersaraburi@central.co.th\nlsi-chanika@lenso.com\nsoravit_y@lenso.com",
    "matchStatus": "review",
    "confidence": "low",
    "matchedDbId": null,
    "matchedDbName": null,
    "matchedDbPlantCode": null,
    "matchedDbAddress": null,
    "reason": "ยังไม่เจอชื่อ Robinson Saraburi ตรงใน DB; มี TWD Saraburi (Phase 2) อยู่สระบุรีแต่ชื่อไม่ตรง",
    "top3Candidates": "Robinson Chachoengsao (NE=49761575, 999.6 kWp) | Central Sriracha (NE=50517504, 999.9 kWp) | Robinson Maesot (NE=50659760, 999.58 kWp)"
  },
  {
    "region": "ตะวันออก",
    "projectName": "บริษัท เออาร์ พาราวูด จำกัด",
    "capacityKWp": 200.16,
    "pvModuleCount": 288,
    "locationText": "ระยอง",
    "contactPhoneRaw": "เบอร์กลางหน้างาน - 0941569151\nคุณมีนารินทร์ - 0949423659",
    "contactEmailRaw": "Chalermrat.M@sinopower.co.th\nwaraporn.l@sinopower.co.th\nChanapong.S@sinopower.co.th",
    "matchStatus": "review",
    "confidence": "low",
    "matchedDbId": null,
    "matchedDbName": null,
    "matchedDbPlantCode": null,
    "matchedDbAddress": null,
    "reason": "ไม่พบชื่อใกล้เคียงใน DB",
    "top3Candidates": "Yusen3 (NE=50990427, 199.64 kWp) | Yusen1 (NE=51054402, 199.64 kWp) | Wonderful plastic Ltd. (NE=51317762, 197.16 kWp)"
  },
  {
    "region": "กลาง",
    "projectName": "Toshiba (BOI)",
    "capacityKWp": 380.41,
    "pvModuleCount": 698,
    "locationText": "นนทบุรี",
    "contactPhoneRaw": "คุณธีรยุทธ 090-985-0166",
    "contactEmailRaw": "teerayutl@ttei.toshiba.co.th",
    "matchStatus": "matched",
    "confidence": "high",
    "matchedDbId": 20.0,
    "matchedDbName": "Toshiba 380.41kW",
    "matchedDbPlantCode": "NE=50223457",
    "matchedDbAddress": "129/1 Tiwanon Rd, Tambon Tha Sai, Amphoe Mueang Nonthaburi, Chang Wat Nonthaburi 11000, Thailand",
    "reason": "ชื่อ/ความจุ/อีเมล/เบอร์โทรตรง",
    "top3Candidates": ""
  },
  {
    "region": "กลาง",
    "projectName": "SANDEN INTERCOOL 1",
    "capacityKWp": 1016.8,
    "pvModuleCount": 1640,
    "locationText": "สิงห์บุรี",
    "contactPhoneRaw": "คุณสุรนาท 0972508424",
    "contactEmailRaw": "pe_05@sandenintercool.com",
    "matchStatus": "matched",
    "confidence": "high",
    "matchedDbId": 154.0,
    "matchedDbName": "Sanden M1 FAC 6 and 12",
    "matchedDbPlantCode": "NE=51797784",
    "matchedDbAddress": "จ.สิงห์บุรีพรหมบุรีบ้านหม้อ104 3 Mu Ban Tra Chu Mu 6 Rd, Ban Mo, Phrom Buri District, Sing Buri 16120, ThailandMetro H & Res Co.,Ltd",
    "reason": "ความจุและพื้นที่ตรงกัน",
    "top3Candidates": ""
  },
  {
    "region": "กลาง",
    "projectName": "SANDEN INTERCOOL 2",
    "capacityKWp": 1300.14,
    "pvModuleCount": 2097,
    "locationText": "สิงห์บุรี",
    "contactPhoneRaw": "คุณสุรนาท 0972508424",
    "contactEmailRaw": "pe_05@sandenintercool.com",
    "matchStatus": "matched",
    "confidence": "high",
    "matchedDbId": 114.0,
    "matchedDbName": "Sanden M2 FAC 4 7 and 8",
    "matchedDbPlantCode": "NE=51806236",
    "matchedDbAddress": "จ.สิงห์บุรีพรหมบุรีบ้านหม้อ104 3 Mu Ban Tra Chu Mu 6 Rd, Ban Mo, Phrom Buri District, Sing Buri 16120, ThailandMetro H & Res Co.,Ltd",
    "reason": "ความจุและพื้นที่ตรงกัน",
    "top3Candidates": ""
  },
  {
    "region": "ใต้",
    "projectName": "Mega Wood สาขานาโยง",
    "capacityKWp": 356.16,
    "pvModuleCount": 648,
    "locationText": "ตรัง",
    "contactPhoneRaw": "คุณจีรศักดิ์ ทองมีบัว 087-895-7566",
    "contactEmailRaw": "jeerasak.t@megawood.co.th",
    "matchStatus": "review",
    "confidence": "low",
    "matchedDbId": null,
    "matchedDbName": null,
    "matchedDbPlantCode": null,
    "matchedDbAddress": null,
    "reason": "พบ MEGAWOOD TRANG แต่ความจุไม่ตรง",
    "top3Candidates": "MEGAWOOD TRANG (NE=60911902, 999.6 kWp) | MEGA Hatyai (NE=54494468, 999.41 kWp) | DCL MOLD (NE=57728658, 369.6 kWp)"
  },
  {
    "region": "กลาง",
    "projectName": "M Senko",
    "capacityKWp": 999.53,
    "pvModuleCount": 1834,
    "locationText": "สมุทรปราการ",
    "contactPhoneRaw": "คุณกิ่ง 088-233-4458",
    "contactEmailRaw": "narongsak.ph@m-senko.com\nmsl_engineer@m-senko.com\nCC : lsi-chanika@lenso.com \nsoravit_y@lenso.com",
    "matchStatus": "possible",
    "confidence": "medium",
    "matchedDbId": 2.0,
    "matchedDbName": "Msenko",
    "matchedDbPlantCode": "NE=49982713",
    "matchedDbAddress": "จ.สมุทรปราการบางเสาธงบางเสาธงเลขที่ 80 อำเภอ สมุทรปราการ 10570 ไทยขนมบ้านแอน",
    "reason": "ชื่อใกล้กันมาก แต่ความจุใน DB 1749.73 ไม่ตรงกับไฟล์ตัวอย่าง",
    "top3Candidates": ""
  },
  {
    "region": "กลาง",
    "projectName": "M Senko Phase 2",
    "capacityKWp": 1230.0,
    "pvModuleCount": 1230,
    "locationText": "สมุทรปราการ",
    "contactPhoneRaw": "คุณกิ่ง 088-233-4458",
    "contactEmailRaw": "narongsak.ph@m-senko.com\nmsl_engineer@m-senko.com",
    "matchStatus": "review",
    "confidence": "low",
    "matchedDbId": null,
    "matchedDbName": null,
    "matchedDbPlantCode": null,
    "matchedDbAddress": null,
    "reason": "ไม่พบชื่อ Phase 2 ตรงใน DB",
    "top3Candidates": "Siam Toppan (Phase​ 2​) (NE=52235059, 506.6 kWp) | TWD Nakhon-In​  (Phase​ 2​) (NE=68128628, 0.0 kWp) | TWD Mueang Ek (Phase 2) (NE=62949904, 464.8 kWp)"
  },
  {
    "region": "ตะวันออก",
    "projectName": "บริษัท เอ็มซีซี ลาเบลส์ กรุงเทพ จำกัด",
    "capacityKWp": 446.4,
    "pvModuleCount": 720,
    "locationText": "ชลบุรี",
    "contactPhoneRaw": "คุณกี้ 088-0133324",
    "contactEmailRaw": "Chalermrat.M@sinopower.co.th\nwaraporn.l@sinopower.co.th\nChanapong.S@sinopower.co.th",
    "matchStatus": "review",
    "confidence": "low",
    "matchedDbId": null,
    "matchedDbName": null,
    "matchedDbPlantCode": null,
    "matchedDbAddress": null,
    "reason": "ไม่พบชื่อใกล้เคียงใน DB",
    "top3Candidates": "Mukdahanbiogas (NE=50583054, 444.69 kWp) | TWD Mueang Ek (Phase 2) (NE=62949904, 464.8 kWp) | Indo Thai MDB-503 (NE=49741654, 463.32 kWp)"
  },
  {
    "region": "กลาง",
    "projectName": "บริษัท ดี.ที.เอส.อุตสาหกรรม จำกัด",
    "capacityKWp": 262.48,
    "pvModuleCount": 386,
    "locationText": "สมุทรปราการ",
    "contactPhoneRaw": "คุณธนะวรรธน์ 082-3605428\nคุณพรเทพ 087-5071886",
    "contactEmailRaw": "Chalermrat.M@sinopower.co.th\nwaraporn.l@sinopower.co.th\nChanapong.S@sinopower.co.th",
    "matchStatus": "review",
    "confidence": "low",
    "matchedDbId": null,
    "matchedDbName": null,
    "matchedDbPlantCode": null,
    "matchedDbAddress": null,
    "reason": "ไม่พบชื่อใกล้เคียงใน DB",
    "top3Candidates": "P-Pamorn (NE=50492674, 257.58 kWp) | Captain Coating (NE=52499009, 264.52 kWp) | PPF พิษณุโลก 250.48kWp (NE=51250584, 250.48 kWp)"
  },
  {
    "region": "ใต้",
    "projectName": "AIS Songkhla",
    "capacityKWp": 300.15,
    "pvModuleCount": 970,
    "locationText": "สงขลา",
    "contactPhoneRaw": "AIS หาดใหญ่ พี่ณัฐพล \n0818953339",
    "contactEmailRaw": "gulf1_om@gulf.co.th\nGULF1_Safety@gulf.co.th",
    "matchStatus": "review",
    "confidence": "low",
    "matchedDbId": null,
    "matchedDbName": null,
    "matchedDbPlantCode": null,
    "matchedDbAddress": null,
    "reason": "ไม่พบชื่อ AIS Songkhla ใน DB",
    "top3Candidates": "CHARTER SCHOOL (NE=56018936, 300.24 kWp) | Lenso (NE=49761384, 300.0 kWp) | Concept Manufacturing (NE=52086985, 300.0 kWp)"
  },
  {
    "region": "กลาง",
    "projectName": "Ecco Tannery (BOI)",
    "capacityKWp": 999.53,
    "pvModuleCount": 1834,
    "locationText": "อยุธยา",
    "contactPhoneRaw": "คุณกรกช 092-2749991",
    "contactEmailRaw": "kau@ecco.com , waka@ecco.com , \nchau@ecco.com , saw@ecco.com , thju@ecco.com",
    "matchStatus": "matched",
    "confidence": "high",
    "matchedDbId": 74.0,
    "matchedDbName": "ECCO Tannery",
    "matchedDbPlantCode": "NE=50206418",
    "matchedDbAddress": "ประเทศไทยพระนครศรีอยุธยานครหลวงบางพระครู13260",
    "reason": "ชื่อ/อีเมล/เบอร์โทรตรง แม้ความจุใน DB ต่างจากไฟล์ตัวอย่าง",
    "top3Candidates": ""
  },
  {
    "region": "กลาง",
    "projectName": "SONGSERM COMMERCIAL REFRIGERATION (THAILAND) CO.,LTD.",
    "capacityKWp": 350.92,
    "pvModuleCount": 566,
    "locationText": "สิงห์บุรี",
    "contactPhoneRaw": "คุณสำเร็จ 089-7221166\nคุณพัฒน (จัดซื้อ) 085-4817034",
    "contactEmailRaw": "wirat@songsermref.com\nphattana@songsermref.com",
    "matchStatus": "matched",
    "confidence": "high",
    "matchedDbId": 194.0,
    "matchedDbName": "Songserm Commercial Refrigeration",
    "matchedDbPlantCode": "NE=51605380",
    "matchedDbAddress": "จ.สิงห์บุรีพรหมบุรีบ้านแป้งหมู่ 4 ถนนสายเอเชีย-นครสวรรค์ ตำบล  อำเภอ สิงห์บุรี 16120 ไทยสำนักงานเกษตรอำเภอ",
    "reason": "ชื่อ/อีเมล/เบอร์โทร/ความจุตรง",
    "top3Candidates": ""
  },
  {
    "region": "กลาง",
    "projectName": "Polar Plastic",
    "capacityKWp": 445.08,
    "pvModuleCount": 718,
    "locationText": "สมุทรปราการ",
    "contactPhoneRaw": "ช่างคมสัน 097-3436455",
    "contactEmailRaw": "mt@polar-plastic.com",
    "matchStatus": "matched",
    "confidence": "high",
    "matchedDbId": 168.0,
    "matchedDbName": "Polar Plastic",
    "matchedDbPlantCode": "NE=52425407",
    "matchedDbAddress": "ประเทศไทยสมุทรปราการอ.บางบ่อบางบ่อถนน โยธาธิการ สป. 3010137/9 ถนน โยธาธิการ สป. 3010",
    "reason": "ชื่อ/อีเมล/เบอร์โทรตรง แต่ความจุไม่ตรง",
    "top3Candidates": ""
  },
  {
    "region": "ตะวันออก",
    "projectName": "Robinson ฉะเชิงเทรา",
    "capacityKWp": 999.6,
    "pvModuleCount": 2499,
    "locationText": "ฉะเชิงเทรา",
    "contactPhoneRaw": "ช่างสาขา 0886054547\nคุณทรงวุฒิ 098-824-4488",
    "contactEmailRaw": "to : jusongwuth@central.co.th\ncc : mallmechachoengsao@central.co.th\nlsi-chanika@lenso.com\nsoravit_y@lenso.com",
    "matchStatus": "matched",
    "confidence": "high",
    "matchedDbId": 8.0,
    "matchedDbName": "Robinson Chachoengsao",
    "matchedDbPlantCode": "NE=49761575",
    "matchedDbAddress": "910 หมู่ที่ 4 ถนน บางปะกง - ฉะเชิงเทรา ตำบล หน้าเมือง อำเภอเมืองฉะเชิงเทรา ฉะเชิงเทรา 24000",
    "reason": "ชื่อจังหวัด/อีเมล/เบอร์โทร/ความจุตรง",
    "top3Candidates": ""
  },
  {
    "region": "ใต้",
    "projectName": "Mega Hatyai",
    "capacityKWp": 999.41,
    "pvModuleCount": 1438,
    "locationText": "สงขลา",
    "contactPhoneRaw": "คุณกาย 088-3984545",
    "contactEmailRaw": "office.megahatyai@gmail.com",
    "matchStatus": "matched",
    "confidence": "high",
    "matchedDbId": 238.0,
    "matchedDbName": "MEGA Hatyai",
    "matchedDbPlantCode": "NE=54494468",
    "matchedDbAddress": "จ.สงขลาสะเดาเขามีเกียรติ116 ตำบล  อำเภอ สงขลา 90170 ไทยเมกก้าหาดใหญ่",
    "reason": "ชื่อ/อีเมล/เบอร์โทร/ความจุตรง",
    "top3Candidates": ""
  },
  {
    "region": "กลาง",
    "projectName": "บริษัท เฮ็ลธ์ฟู้ดส์ คอร์ปอเรชั่น จำกัด ( HFC )",
    "capacityKWp": 2002.0,
    "pvModuleCount": 2860,
    "locationText": "สระบุุรี",
    "contactPhoneRaw": "คุณมังกร 091-1201939",
    "contactEmailRaw": "gon108359@hotmail.com",
    "matchStatus": "matched",
    "confidence": "high",
    "matchedDbId": 221.0,
    "matchedDbName": "HFC",
    "matchedDbPlantCode": "NE=56459494",
    "matchedDbAddress": "จ.สระบุรีวังม่วงแสลงพันบ้านหินซ้อนเหนือ ตำบล  อำเภอ  สระบุรี 18220 ไทยศูนย์เสริมสร้างสุขภาพประชาชนและผู้สูงวัยตำบล",
    "reason": "ชื่อย่อ HFC/ความจุตรง",
    "top3Candidates": ""
  },
  {
    "region": "ใต้",
    "projectName": "Piti seafood จะนะ",
    "capacityKWp": 999.44,
    "pvModuleCount": 1612,
    "locationText": "สงขลา",
    "contactPhoneRaw": "คุณปอ 089-5816369\nคุณกิศนา 088-3992991",
    "contactEmailRaw": "iso.ptf@gmail.com",
    "matchStatus": "matched",
    "confidence": "high",
    "matchedDbId": 147.0,
    "matchedDbName": "PITI SEAFOODS",
    "matchedDbPlantCode": "NE=51419620",
    "matchedDbAddress": "ประเทศไทยสงขลาอ.จะนะบ้านนา90130",
    "reason": "ชื่อ/อีเมล/เบอร์โทร/พื้นที่/ความจุตรง",
    "top3Candidates": ""
  },
  {
    "region": "ตะวันออก",
    "projectName": "United Coil Center (UCC)",
    "capacityKWp": 710.14,
    "pvModuleCount": 1303,
    "locationText": "ชลบุรี",
    "contactPhoneRaw": "คุณปารุวัฒน์ - 0889133899",
    "contactEmailRaw": "paruwat_c@ucc.co.th",
    "matchStatus": "review",
    "confidence": "low",
    "matchedDbId": null,
    "matchedDbName": null,
    "matchedDbPlantCode": null,
    "matchedDbAddress": null,
    "reason": "ไม่พบชื่อ UCC/United Coil ใน DB",
    "top3Candidates": "Center Pack (NE=50550381, 71.16 kWp) | Jewelry Trade Center (JTC) (NE=51070389, 216.28 kWp) | Center Container (NE=50637478, 208.94 kWp)"
  },
  {
    "region": "ใต้",
    "projectName": "Semperflex Asia",
    "capacityKWp": 999.44,
    "pvModuleCount": 1612,
    "locationText": "สงขลา",
    "contactPhoneRaw": "คุณตูน 063-8207689\nคุณวิโรจ 092-2563772",
    "contactEmailRaw": "watcharapornc@sritranggroup.com",
    "matchStatus": "matched",
    "confidence": "high",
    "matchedDbId": 181.0,
    "matchedDbName": "Semperflex Asia",
    "matchedDbPlantCode": "NE=51335826",
    "matchedDbAddress": "ประเทศไทยสงขลาอ.หาดใหญ่พะตง90230",
    "reason": "ชื่อ/อีเมล/เบอร์โทร/ความจุตรง",
    "top3Candidates": ""
  },
  {
    "region": "กลาง",
    "projectName": "บริษัท เค-เฟรช จำกัด (สาขา สวนส้ม)",
    "capacityKWp": 254.8,
    "pvModuleCount": 364,
    "locationText": "สมุทรสาคร",
    "contactPhoneRaw": "คุณเกียรติ ผจก.โครงการ 081-4307006",
    "contactEmailRaw": "Chalermrat.M@sinopower.co.th\nwaraporn.l@sinopower.co.th\nChanapong.S@sinopower.co.th",
    "matchStatus": "review",
    "confidence": "low",
    "matchedDbId": null,
    "matchedDbName": null,
    "matchedDbPlantCode": null,
    "matchedDbAddress": null,
    "reason": "ไม่พบชื่อใกล้เคียงใน DB",
    "top3Candidates": "PPF พิษณุโลก 250.48kWp (NE=51250584, 250.48 kWp) | CDS WESTGATE 2 (NE=52069073, 252.34 kWp) | P-Pamorn (NE=50492674, 257.58 kWp)"
  },
  {
    "region": "กลาง",
    "projectName": "DMT PLASTECH",
    "capacityKWp": 223.2,
    "pvModuleCount": 360,
    "locationText": "สมุทรสาคร",
    "contactPhoneRaw": "คุณชนิดา 081-4462333\nคุณอาสา 095-4563615",
    "contactEmailRaw": "dmt.plastech@gmail.com\ndmtpurchase.plastech@gmail.com",
    "matchStatus": "matched",
    "confidence": "high",
    "matchedDbId": 160.0,
    "matchedDbName": "DMT PLASTECH",
    "matchedDbPlantCode": "NE=51415844",
    "matchedDbAddress": "คลองมะเดื่อ, กระทุ่มแบน 74110, ประเทศไทย5/1",
    "reason": "ชื่อ/อีเมล/เบอร์โทร/ความจุตรง",
    "top3Candidates": ""
  },
  {
    "region": "ใต้",
    "projectName": "บริษัท โกร๊ปฮอลส์ จำกัด",
    "capacityKWp": 999.68,
    "pvModuleCount": 1408,
    "locationText": "สงขลา",
    "contactPhoneRaw": "K. Somjet Seayang CEO ฝ่ายวิศวกรรม 081-7668797\nK. wassana Dangsawat ฝ่ายการเงินและบัญชี 081-8962136",
    "contactEmailRaw": "Chalermrat.M@sinopower.co.th\nwaraporn.l@sinopower.co.th\nChanapong.S@sinopower.co.th",
    "matchStatus": "review",
    "confidence": "low",
    "matchedDbId": null,
    "matchedDbName": null,
    "matchedDbPlantCode": null,
    "matchedDbAddress": null,
    "reason": "ไม่พบชื่อใกล้เคียงใน DB",
    "top3Candidates": "TWD UDON (H2) (NE=53124961, 999.6 kWp) | TWD Pak Chong (NE=49748539, 999.68 kWp) | TWD Uthai thani (NE=53534545, 999.6 kWp)"
  },
  {
    "region": "กลาง",
    "projectName": "TWD บางนา เฟส 2",
    "capacityKWp": 1000.0,
    "pvModuleCount": 1439,
    "locationText": "สมุทรปราการ",
    "contactPhoneRaw": "MTN.สาขา : จิรวัฒน์ 083-797-3820\nArea จิรวัฒน์ สุขศาลา : 083-797-3820",
    "contactEmailRaw": "KhoSupattra@chg.co.th\ncc  sujirawat@chg.co.th",
    "matchStatus": "matched",
    "confidence": "high",
    "matchedDbId": 217.0,
    "matchedDbName": "TWD Bangna phase 2",
    "matchedDbPlantCode": "NE=54621914",
    "matchedDbAddress": "ประเทศไทยสมุทรปราการอำเภอบางพลีบางแก้วถนน เทพรัตน35/103 ถนน เทพรัตน",
    "reason": "ชื่อ/อีเมล/พื้นที่ตรง",
    "top3Candidates": ""
  },
  {
    "region": "กลาง",
    "projectName": "ชัยวารีมารีนโปรดัคส์ (Chaivaree Marin)",
    "capacityKWp": 509.64,
    "pvModuleCount": 822,
    "locationText": "สมุทรสาคร",
    "contactPhoneRaw": "คุณช่อแก้ว 089-8057038\nคุณสุทิศ (ผู้จัดการโรงาน) 094-6496959",
    "contactEmailRaw": "store.chaivaree@gmail.com",
    "matchStatus": "matched",
    "confidence": "high",
    "matchedDbId": 110.0,
    "matchedDbName": "Chaivaree Marin",
    "matchedDbPlantCode": "NE=51413522",
    "matchedDbAddress": "29/51 หมู่ 4  นาดี  สมุทรสาคร 74000",
    "reason": "ชื่อไทย/อังกฤษและความจุตรง",
    "top3Candidates": ""
  },
  {
    "region": "ใต้",
    "projectName": "บริษัท นาบอน พาราวู้ด จำกัด",
    "capacityKWp": 739.2,
    "pvModuleCount": 1056,
    "locationText": "นครศรีธรรมราช",
    "contactPhoneRaw": "คุณสมทรง 061-5969173",
    "contactEmailRaw": "Chalermrat.M@sinopower.co.th\nwaraporn.l@sinopower.co.th\nChanapong.S@sinopower.co.th",
    "matchStatus": "review",
    "confidence": "low",
    "matchedDbId": null,
    "matchedDbName": null,
    "matchedDbPlantCode": null,
    "matchedDbAddress": null,
    "reason": "ไม่พบชื่อใกล้เคียงใน DB",
    "top3Candidates": "โชคชัยพัฒนาฟาร์ม (NE=62637348, 244.24 kWp) | โรงพยาบาล บ้านฉาง (NE=50682825, 100.0 kWp) | โรงพยาบาล บ้านค่าย (NE=50689020, 100.0 kWp)"
  },
  {
    "region": "กลาง",
    "projectName": "TWD บางนา",
    "capacityKWp": 999.75,
    "pvModuleCount": 2170,
    "locationText": "สมุทรปราการ",
    "contactPhoneRaw": "MTN.สาขา : จิรวัฒน์ 083-797-3820\nArea จิรวัฒน์ สุขศาลา : 083-797-3820",
    "contactEmailRaw": "NgNattapong@chg.co.th\ncc    KhoSupattra@chg.co.th         sujirawat@chg.co.th",
    "matchStatus": "matched",
    "confidence": "medium",
    "matchedDbId": 39.0,
    "matchedDbName": "TWD Bangna",
    "matchedDbPlantCode": "NE=50474988",
    "matchedDbAddress": "ประเทศไทยสมุทรปราการอำเภอบางพลีบางแก้วถนน เทพรัตน19/437 ถนน เทพรัตน",
    "reason": "ชื่อไซต์ตรง; ใน DB ไม่มีอีเมลแต่มีอีกแถวเป็น Phase 2",
    "top3Candidates": ""
  },
  {
    "region": "อีสาน",
    "projectName": "Do home Burriram (BOI)",
    "capacityKWp": 999.53,
    "pvModuleCount": 1834,
    "locationText": "บุรีรัมย์",
    "contactPhoneRaw": "คุณแมน 099-3402798",
    "contactEmailRaw": "maintenance-br@dohome.co.th",
    "matchStatus": "review",
    "confidence": "low",
    "matchedDbId": null,
    "matchedDbName": null,
    "matchedDbPlantCode": null,
    "matchedDbAddress": null,
    "reason": "ไม่พบชื่อ DoHome ตรงใน DB; พบ TWD Buriram ที่ขนาดใกล้กันแต่ชื่อไม่ตรง",
    "top3Candidates": "TWD Buriram (NE=50806491, 999.495 kWp) | TWD DC Wang Noi (NE=50723811, 999.54 kWp) | TWD Chanthaburi (NE=50758642, 999.495 kWp)"
  },
  {
    "region": "ตะวันออก",
    "projectName": "บริษัท คอร์ติน่า สยาม สปอร์ต จำกัด",
    "capacityKWp": 854.36,
    "pvModuleCount": 1378,
    "locationText": "ฉะเชิงเทรา",
    "contactPhoneRaw": "คุณไปยดา 085-2339779\nคุณมิน คอติน่า 0910060399\n",
    "contactEmailRaw": "Chalermrat.M@sinopower.co.th\nwaraporn.l@sinopower.co.th\nChanapong.S@sinopower.co.th",
    "matchStatus": "review",
    "confidence": "low",
    "matchedDbId": null,
    "matchedDbName": null,
    "matchedDbPlantCode": null,
    "matchedDbAddress": null,
    "reason": "ไม่พบชื่อใกล้เคียงใน DB",
    "top3Candidates": "OLIC (Thailand) Limited (NE=51378360, 859.32 kWp) | TWD Phitsanulok (NE=50787491, 861.84 kWp) | โรงพยาบาล บ้านค่าย (NE=50689020, 100.0 kWp)"
  }
] as const;


function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

function extractEmails(raw: unknown): string | null {
  if (!raw) return null;
  const text = String(raw);
  const matches = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  const emails = uniq(matches.map((x) => x.trim().toLowerCase()));
  return emails.length ? emails.join('; ') : null;
}

function extractPhones(raw: unknown): string | null {
  if (!raw) return null;
  const text = String(raw);
  // Grab Thai-ish phone patterns: 0xxxxxxxxx, 0xx-xxx-xxxx, etc.
  const matches = text.match(/0\d{1,2}[-\s]?\d{3}[-\s]?\d{4}/g) || [];
  const phones = uniq(matches.map((x) => x.replace(/\s+/g, '').replace(/-/g, '')));
  return phones.length ? phones.join('; ') : null;
}


function normalizeName(name: string): string {
  return String(name || '')
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/[^a-z0-9ก-๙]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenSet(name: string): Set<string> {
  const tokens = normalizeName(name).split(' ').filter(Boolean);
  return new Set(tokens);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

function cleanText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).replace(/\r/g, '').trim();
  return text ? text : null;
}

function mergeDelimited(existing: string | null | undefined, incoming: string | null | undefined): string | null {
  const items = [
    ...(existing ? existing.split(/[;,]/).map((x) => x.trim()).filter(Boolean) : []),
    ...(incoming ? incoming.split(/[;,]/).map((x) => x.trim()).filter(Boolean) : []),
  ];
  const merged = uniq(items);
  return merged.length ? merged.join('; ') : null;
}

function buildImportRemark(input: {
  projectName: string;
  region: string | null;
  locationText: string | null;
  matchStatus: string | null;
  confidence: string | null;
  reason: string | null;
  top3Candidates?: string | null;
}): string {
  const parts = [
    '[excel-import]',
    `project=${input.projectName}`,
    input.region ? `region=${input.region}` : null,
    input.locationText ? `location=${input.locationText}` : null,
    input.matchStatus ? `matchStatus=${input.matchStatus}` : null,
    input.confidence ? `confidence=${input.confidence}` : null,
    input.reason ? `reason=${input.reason}` : null,
    input.top3Candidates ? `candidates=${input.top3Candidates}` : null,
  ].filter(Boolean);
  return parts.join(' | ');
}

const UPSERT_REVIEW_STUBS = false;

async function enrichSitesFromMappingResult() {
  const imports = PROJECT_SITE_IMPORTS;
  const sites = await prisma.site.findMany({
    select: {
      id: true,
      name: true,
      address: true,
      capacityKWp: true,
      plantCode: true,
      contactEmail: true,
      contactPhone: true,
      pvModuleCount: true,
      companyName: true,
      remark: true,
      projectStatus: true,
    },
  });

  const byId = new Map(sites.map((s) => [s.id, s]));
  const byPlantCode = new Map(
    sites.filter((s) => !!s.plantCode).map((s) => [String(s.plantCode).trim(), s])
  );
  const byNormName = new Map<string, (typeof sites)[number]>();
  for (const s of sites) byNormName.set(normalizeName(s.name), s);

  const aliases: Record<string, string> = {
    'cpn sriracha': 'central sriracha',
    'toshiba boi': 'toshiba 380 41kw',
    'robinson ฉะเชิงเทรา': 'robinson chachoengsao',
    'robinson chachoengsao': 'robinson chachoengsao',
    'ecco tannery boi': 'ecco tannery',
    'm senko': 'msenko',
    'twd บางนา เฟส 2': 'twd bangna phase 2',
    'twd บางนา': 'twd bangna',
    'mega hatyai': 'mega hatyai',
    'ชัยวารีมารีนโปรดัคส์ chaivaree marin': 'chaivaree marin',
  };

  let updated = 0;
  let created = 0;
  let skippedReview = 0;
  let unmatched = 0;

  for (const p of imports) {
    const matchStatus = cleanText(p.matchStatus);
    const confidence = cleanText(p.confidence);
    const matchedDbName = cleanText(p.matchedDbName);
    const matchedDbPlantCode = cleanText(p.matchedDbPlantCode);
    const projectName = cleanText(p.projectName);

    if (!projectName) continue;

    let target =
      (typeof p.matchedDbId === 'number' ? byId.get(p.matchedDbId) : undefined) ||
      (matchedDbPlantCode ? byPlantCode.get(matchedDbPlantCode) : undefined) ||
      (matchedDbName ? byNormName.get(normalizeName(matchedDbName)) : undefined);

    if (!target) {
      const aliasName = aliases[normalizeName(projectName)];
      if (aliasName) target = byNormName.get(aliasName);
    }

    if (!target) {
      const wantedTokens = tokenSet(projectName);
      let best: (typeof sites)[number] | undefined;
      let bestScore = 0;
      for (const site of sites) {
        const sim = jaccard(wantedTokens, tokenSet(site.name));
        let score = sim;
        const cap = Number(p.capacityKWp);
        if (!Number.isNaN(cap) && cap > 0 && site.capacityKWp > 0) {
          const diff = Math.abs(site.capacityKWp - cap);
          if (diff <= 1) score += 0.35;
          else if (diff <= 5) score += 0.2;
        }
        if (score > bestScore) {
          bestScore = score;
          best = site;
        }
      }
      if (best && bestScore >= 0.82 && matchStatus !== 'review') {
        target = best;
      }
    }

    const contactEmail = extractEmails(p.contactEmailRaw);
    const contactPhone = extractPhones(p.contactPhoneRaw);
    const nextPvModuleCount =
      p.pvModuleCount === null || p.pvModuleCount === undefined
        ? null
        : Number(p.pvModuleCount);

    const remark = buildImportRemark({
      projectName,
      region: cleanText(p.region),
      locationText: cleanText(p.locationText),
      matchStatus,
      confidence,
      reason: cleanText(p.reason),
      top3Candidates: cleanText(p.top3Candidates),
    });

    if (!target) {
      if (matchStatus === 'review' && !UPSERT_REVIEW_STUBS) {
        console.warn(`⏭️  Skip review project: "${projectName}"`);
        skippedReview++;
        continue;
      }

      if (!UPSERT_REVIEW_STUBS) {
        console.warn(`⚠️  Unmatched project: "${projectName}"`);
        unmatched++;
        continue;
      }

      const createdSite = await prisma.site.create({
        data: {
          name: projectName,
          address: cleanText(p.locationText) ?? '',
          capacityKWp: Number(p.capacityKWp) || 0,
          plantCode: matchedDbPlantCode ?? undefined,
          contactEmail: contactEmail ?? undefined,
          contactPhone: contactPhone ?? undefined,
          pvModuleCount: Number.isFinite(nextPvModuleCount ?? NaN) ? nextPvModuleCount : undefined,
          companyName: projectName,
          projectStatus: 'ACTIVE',
          remark,
        } as any,
      });

      console.log(`🆕 Site created: "${createdSite.name}"`);
      created++;
      continue;
    }

    const data: Record<string, unknown> = {};

    const mergedEmail = mergeDelimited(target.contactEmail, contactEmail);
    const mergedPhone = mergeDelimited(target.contactPhone, contactPhone);
    if (mergedEmail && mergedEmail !== target.contactEmail) data.contactEmail = mergedEmail;
    if (mergedPhone && mergedPhone !== target.contactPhone) data.contactPhone = mergedPhone;

    if ((target.pvModuleCount === null || target.pvModuleCount === undefined) && Number.isFinite(nextPvModuleCount ?? NaN)) {
      data.pvModuleCount = nextPvModuleCount;
    }

    if ((!target.companyName || !String(target.companyName).trim()) && normalizeName(target.name) !== normalizeName(projectName)) {
      data.companyName = projectName;
    }

    if ((!target.plantCode || !String(target.plantCode).trim()) && matchedDbPlantCode) {
      data.plantCode = matchedDbPlantCode;
    }

    if ((!target.address || !String(target.address).trim()) && cleanText(p.locationText)) {
      data.address = cleanText(p.locationText);
    }

    if ((!target.capacityKWp || Number(target.capacityKWp) === 0) && Number(p.capacityKWp) > 0) {
      data.capacityKWp = Number(p.capacityKWp);
    }

    const existingRemark = cleanText(target.remark);
    if (!existingRemark) {
      data.remark = remark;
    } else if (!existingRemark.includes('[excel-import]')) {
      data.remark = `${existingRemark} | ${remark}`;
    }

    if (Object.keys(data).length === 0) {
      console.log(`ℹ️  No changes: "${target.name}" <- "${projectName}"`);
      continue;
    }

    await prisma.site.update({
      where: { id: target.id },
      data: data as any,
    });

    console.log(`✅ Site updated: "${target.name}" <- "${projectName}"`);
    updated++;
  }

  console.log(`✅ Mapping import done: updated=${updated}, created=${created}, skippedReview=${skippedReview}, unmatched=${unmatched}`);
}

async function seedUsers() {
  const passwordHash = await bcrypt.hash('admin1234', 10);

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

  console.log('✅ Seed users:', { admin: admin.username, serviceUser: serviceUser.username });
}

async function seedStockMaster() {
  // 1) Units
  const unitNames = uniq(
    STOCK_PRODUCTS.map((p) => p.unit).filter((u): u is Exclude<typeof u, undefined> => u !== undefined)
  );
  for (const name of unitNames) {
    await prisma.unit.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }

  // 2) Categories
  const categoryNames = uniq(STOCK_PRODUCTS.map((p) => p.category || '* ยังไม่ได้จัดหมวดหมู่'));
  for (const name of categoryNames) {
    await prisma.productCategory.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }

  const units = await prisma.unit.findMany();
  const categories = await prisma.productCategory.findMany();
  const unitByName = new Map(units.map((u) => [u.name, u]));
  const catByName = new Map(categories.map((c) => [c.name, c]));

  // 3) Products
  let upserted = 0;
  for (const p of STOCK_PRODUCTS) {
    const unit = p.unit ? unitByName.get(p.unit) : undefined;
    if (!unit) {
      console.warn(`⚠️  Missing unit for sku=${p.sku} unit=${p.unit}`);
      continue;
    }
    const catName = p.category || '* ยังไม่ได้จัดหมวดหมู่';
    const cat = catByName.get(catName);
    if (!cat) {
      console.warn(`⚠️  Missing category for sku=${p.sku} category=${catName}`);
      continue;
    }

    await prisma.product.upsert({
      where: { sku: p.sku },
      update: {
        name: p.name,
        categoryId: cat.id,
        unitId: unit.id,
        isActive: true,
      },
      create: {
        sku: p.sku,
        name: p.name,
        categoryId: cat.id,
        unitId: unit.id,
        isActive: true,
      },
    });
    upserted++;
  }

  console.log(`✅ Seed stock master: units=${unitNames.length}, categories=${categoryNames.length}, products=${upserted}`);
}

// =====================
// CLIENT DATA from: CLIENT DATA.pdf (Solar O&M projects Thailand)
// =====================

// matchPlantCode = Huawei plantCode ที่มีอยู่ใน DB แล้ว (update existing site)
const CLIENT_DATA_THAILAND = [
  {
    matchPlantCode: 'NE=50474988',  // DB name: TWD Bangna
    name: 'TWD บางนา',
    capacityKWp: 999.75,
    projectStatus: 'INACTIVE' as const,
    ecpPpa: 'PVS ขาย PM (EPC)',
    codDate: new Date('2021-09-30'),
    warrantyStart: new Date('2021-09-30'),
    warrantyEnd: new Date('2023-09-29'),
    freeOmText: '3time/Y',
    warrantyOutputPct: null,
    panelBrand: 'Jinko',
    panelWatt: 465,
    pvModuleCount: 2170,
    projectTypeText: 'Rooftop',
    companyName: 'บริษัท ซีอาร์ซี ไทวัสดุ จำกัด',
    address: 'เลขที่ 88/88 หมู่ 13 ถนนบางนา-ตราด ต.บางแก้ว อ.บางพลี จ.สมุทรปราการ 10540',
    siteEngineer: 'BIRD',
    responsiblePerson1: 'จิรวัฒน์ สุขศาลา 083-797-3820',
    contactEmail: 'NgNattapong@chg.co.th',
    contactPhone: '083-797-3820',
    remark: null,
  },
  {
    matchPlantCode: 'NE=50223457',  // DB name: Toshiba 380.41kW
    name: 'Toshiba (BOI)',
    capacityKWp: 380.41,
    projectStatus: 'ACTIVE' as const,
    ecpPpa: 'EPC',
    codDate: new Date('2022-07-22'),
    warrantyStart: new Date('2022-07-22'),
    warrantyEnd: new Date('2027-07-21'),
    freeOmText: '2time/Y',
    warrantyOutputPct: null,
    panelBrand: 'Jinko',
    panelWatt: 545,
    pvModuleCount: 698,
    projectTypeText: 'Rooftop',
    companyName: 'บริษัท ไทยโตชิบา อุตสาหกรรม จำกัด',
    address: 'นนทบุรี',
    siteEngineer: 'Cherry',
    responsiblePerson1: 'คุณธีรยุทธ 090-985-0166',
    contactEmail: 'teerayutl@ttei.toshiba.co.th',
    contactPhone: '090-985-0166',
    remark: null,
  },
  {
    matchPlantCode: 'NE=51335826',  // DB name: Semperflex Asia
    name: 'Semperflex Asia',
    capacityKWp: 999.44,
    projectStatus: 'ACTIVE' as const,
    ecpPpa: 'EPC',
    codDate: new Date('2023-12-24'),
    warrantyStart: new Date('2023-12-24'),
    warrantyEnd: new Date('2026-12-23'),
    freeOmText: '2time/Y',
    warrantyOutputPct: null,
    panelBrand: 'Jinko',
    panelWatt: 620,
    pvModuleCount: 1612,
    projectTypeText: 'Rooftop',
    companyName: 'บริษัท เซมเพอร์เฟล็กซ์ เอเซีย จำกัด',
    address: '110/1 ถนนกาญจนวนิช ตำบลพะตง อำเภอหาดใหญ่ จังหวัดสงขลา 90230',
    siteEngineer: 'Cherry',
    responsiblePerson1: 'คุณตูน 063-820-7689',
    responsiblePerson2: 'คุณวิโรจ 092-256-3772',
    contactEmail: 'watcharapornc@sritranggroup.com',
    contactPhone: '063-820-7689',
    remark: 'TK ทีมเดิมเคยได้รับอบรมแล้ว, ขอข้อมูลรุ่น รูปและทะเบียนรถที่เข้าพื้นที่, ให้เข้างาน จ.-ศ.',
  },
  {
    matchPlantCode: 'NE=51413522',  // DB name: Chaivaree Marin
    name: 'ชัยวารีมารีนโปรดัคส์ (Chaivaree Marin)',
    capacityKWp: 509.64,
    projectStatus: 'INACTIVE' as const,
    ecpPpa: 'EPC',
    codDate: new Date('2024-01-14'),
    warrantyStart: new Date('2024-01-14'),
    warrantyEnd: new Date('2026-01-13'),
    freeOmText: '2time/Y',
    warrantyOutputPct: null,
    panelBrand: 'Jinko',
    panelWatt: 620,
    pvModuleCount: 822,
    projectTypeText: 'Rooftop',
    companyName: 'บริษัท ชัยวารีมารีนโปรดัคส์ จำกัด',
    address: 'ถ.เอกชัย ตำบลนาดี อำเภอเมืองสมุทรสาคร จังหวัดสมุทรสาคร 74000',
    siteEngineer: 'Cherry',
    responsiblePerson1: 'คุณช่อแก้ว 089-805-7038',
    responsiblePerson2: 'คุณสุทิศ (ผู้จัดการโรงงาน) 094-649-6959',
    contactEmail: 'store.chaivaree@gmail.com',
    contactPhone: '089-805-7038',
    remark: null,
  },
  {
    matchPlantCode: 'NE=51419620',  // DB name: PITI SEAFOODS
    name: 'Piti Seafood จะนะ',
    capacityKWp: 999.44,
    projectStatus: 'ACTIVE' as const,
    ecpPpa: 'EPC',
    codDate: new Date('2024-01-18'),
    warrantyStart: new Date('2024-02-06'),
    warrantyEnd: new Date('2027-02-05'),
    freeOmText: '2time/Y',
    warrantyOutputPct: null,
    panelBrand: 'Jinko',
    panelWatt: 620,
    pvModuleCount: 1612,
    projectTypeText: 'Rooftop',
    companyName: 'บริษัท ปิติซีฟูดส์ จำกัด',
    address: 'หาดใหญ่-ปัตตานี ตำบลบ้านนา อำเภอจะนะ จังหวัดสงขลา 90130',
    siteEngineer: 'Cherry',
    responsiblePerson1: 'คุณปอ 089-581-6369',
    responsiblePerson2: 'คุณกิศนา 088-399-2991',
    contactEmail: 'iso.ptf@gmail.com',
    contactPhone: '089-581-6369',
    remark: null,
  },
  {
    matchPlantCode: 'NE=51806236',  // DB name: Sanden M2 FAC 4 7 and 8
    name: 'SANDEN INTERCOOL 2',
    capacityKWp: 1300.14,
    projectStatus: 'ACTIVE' as const,
    ecpPpa: 'EPC',
    codDate: new Date('2024-04-05'),
    warrantyStart: new Date('2024-07-03'),
    warrantyEnd: new Date('2029-07-02'),
    freeOmText: '2time/Y',
    warrantyOutputPct: null,
    panelBrand: 'Jinko',
    panelWatt: 620,
    pvModuleCount: 2097,
    projectTypeText: 'Rooftop',
    companyName: 'บริษัท ซันเด้น อินเตอร์คูล (ประเทศไทย) จำกัด',
    address: '97-97/1 หมู่ที่ 3 ตำบลบ้านหม้อ อำเภอพรหมบุรี จังหวัดสิงห์บุรี 16120',
    siteEngineer: 'Cherry',
    responsiblePerson1: 'คุณสุรนาท 097-250-8424',
    contactEmail: 'pe_05@sandenintercool.com',
    contactPhone: '097-250-8424',
    remark: 'อบรม 2 ชั่วโมง, เข้าได้ จ.-ศ., ลค.แจ้งขอให้ถึงหน้างาน 8.30 น. เพราะมีอบรมก่อนเริ่มงาน',
  },
  {
    matchPlantCode: 'NE=51605380',  // DB name: Songserm Commercial Refrigeration
    name: 'SONGSERM COMMERCIAL REFRIGERATION (THAILAND)',
    capacityKWp: 350.92,
    projectStatus: 'ACTIVE' as const,
    ecpPpa: 'EPC',
    codDate: new Date('2024-02-28'),
    warrantyStart: new Date('2024-02-28'),
    warrantyEnd: new Date('2027-02-27'),
    freeOmText: '2time/Y',
    warrantyOutputPct: null,
    panelBrand: 'Jinko',
    panelWatt: 620,
    pvModuleCount: 566,
    projectTypeText: 'Rooftop',
    companyName: 'บริษัท ส่งเสริม คอมเมอร์เชียล รีฟรีเจอร์เรชั่น (ไทยแลนด์) จำกัด',
    address: '103 หมู่ที่ 3 ถนนสายเอเซีย ตำบลบ้านหม้อ อำเภอพรหมบุรี จ.สิงห์บุรี',
    siteEngineer: 'Cherry',
    responsiblePerson1: 'คุณสำเร็จ 089-722-1166',
    responsiblePerson2: 'คุณพัฒนา (จัดซื้อ) 085-481-7034',
    contactEmail: 'wirat@songsermref.com',
    contactPhone: '089-722-1166',
    remark: 'อบรมประมาณ 30 นาที กับ จป.',
  },
  {
    matchPlantCode: 'NE=52425407',  // DB name: Polar Plastic
    name: 'Polar Plastic',
    capacityKWp: 445.08,
    projectStatus: 'ACTIVE' as const,
    ecpPpa: 'EPC',
    codDate: new Date('2024-07-04'),
    warrantyStart: new Date('2024-07-12'),
    warrantyEnd: new Date('2029-07-12'),
    freeOmText: '2time/Y',
    warrantyOutputPct: null,
    panelBrand: 'Jinko',
    panelWatt: 620,
    pvModuleCount: 718,
    projectTypeText: 'Rooftop',
    companyName: 'บริษัท โพลาร์พลาสติก อินดัสทรี่ส์ จำกัด',
    address: 'ตำบลบางบ่อ อำเภอบางบ่อ จังหวัดสมุทรปราการ',
    siteEngineer: 'Bird',
    responsiblePerson1: 'ช่างคมสัน 097-343-6455',
    contactEmail: 'mt@polar-plastic.com',
    contactPhone: '097-343-6455',
    remark: null,
  },
  {
    matchPlantCode: 'NE=54621914',  // DB name: TWD Bangna phase 2
    name: 'TWD บางนา เฟส 2',
    capacityKWp: 999.60,
    projectStatus: 'ACTIVE' as const,
    ecpPpa: 'EPC',
    codDate: new Date('2024-11-27'),
    warrantyStart: new Date('2025-01-19'),
    warrantyEnd: new Date('2030-01-17'),
    freeOmText: '2time/Y, 5Y/70%',
    warrantyOutputPct: 70,
    panelBrand: 'Trina',
    panelWatt: 695,
    pvModuleCount: 1439,
    projectTypeText: 'Rooftop',
    companyName: 'บริษัท ซีอาร์ซี ไทวัสดุ จำกัด',
    address: 'เลขที่ 88/88 หมู่ 13 ถนนบางนา-ตราด ต.บางแก้ว อ.บางพลี จ.สมุทรปราการ 10540',
    siteEngineer: 'Bird',
    responsiblePerson1: 'จิรวัฒน์ สุขศาลา 083-797-3820',
    contactEmail: 'KhoSupattra@chg.co.th',
    contactPhone: '083-797-3820',
    remark: 'หลังจากนี้สัญญารับเหมาติดตั้งไม่มี',
  },
  {
    matchPlantCode: 'NE=54494468',  // DB name: MEGA Hatyai
    name: 'Mega Hatyai',
    capacityKWp: 999.41,
    projectStatus: 'ACTIVE' as const,
    ecpPpa: 'EPC',
    codDate: new Date('2024-11-18'),
    warrantyStart: new Date('2024-12-14'),
    warrantyEnd: new Date('2026-12-13'),
    freeOmText: '2time/Y',
    warrantyOutputPct: null,
    panelBrand: 'Trina',
    panelWatt: 695,
    pvModuleCount: 1438,
    projectTypeText: 'Rooftop',
    companyName: 'บริษัท เมกก้า หาดใหญ่ จำกัด',
    address: '116 หมู่ 4 ตำบลเขามีเกียรติ อำเภอสะเดา จังหวัดสงขลา 90170',
    siteEngineer: 'Yaya',
    responsiblePerson1: 'คุณกาย 088-398-4545',
    contactEmail: 'office.megahatyai@gmail.com',
    contactPhone: '088-398-4545',
    remark: null,
  },
  // 5 โปรเจกต์ที่ไม่มีใน DB (เอ็มซีซี ลาเบลส์, คอร์ติน่า, ดี.ที.เอส., เออาร์ พาราวูด, AIS Songkhla) — ข้ามไป
];

async function seedClientDataThailand() {
  let updated = 0;
  let notFound = 0;

  for (const project of CLIENT_DATA_THAILAND) {
    // Client data fields to update/create (don't overwrite name — keep DB name from Huawei)
    const clientFields = {
      projectStatus: project.projectStatus === 'ACTIVE' ? 'ACTIVE' as const : 'INACTIVE' as const,
      ecpPpa: project.ecpPpa,
      codDate: project.codDate,
      warrantyStart: project.warrantyStart,
      warrantyEnd: project.warrantyEnd,
      freeOmText: project.freeOmText,
      warrantyOutputPct: project.warrantyOutputPct,
      panelBrand: project.panelBrand,
      panelWatt: project.panelWatt,
      pvModuleCount: project.pvModuleCount,
      projectTypeText: project.projectTypeText,
      companyName: project.companyName,
      address: project.address,
      siteEngineer: project.siteEngineer,
      responsiblePerson1: project.responsiblePerson1,
      responsiblePerson2: project.responsiblePerson2 ?? null,
      contactEmail: project.contactEmail ?? null,
      contactPhone: project.contactPhone,
      remark: project.remark,
    };

    if (project.matchPlantCode) {
      // Update existing site matched by Huawei plantCode
      const existing = await prisma.site.findUnique({
        where: { plantCode: project.matchPlantCode },
      });
      if (existing) {
        await prisma.site.update({
          where: { plantCode: project.matchPlantCode },
          data: clientFields,
        });
        updated++;
        console.log(`   📝 Updated: ${existing.name} (${project.matchPlantCode}) ← PDF: ${project.name}`);
      } else {
        console.warn(`   ⚠️  Not found in DB: plantCode=${project.matchPlantCode} (PDF: ${project.name})`);
        notFound++;
      }
    }
  }

  console.log(`✅ Seed client data Thailand: ${updated} updated, ${notFound} not found (total ${CLIENT_DATA_THAILAND.length} projects)`);
}

async function seedServiceEntries() {
  // Pick the first 3 sites to create sample ServiceEntry records
  const sites = await prisma.site.findMany({
    take: 3,
    orderBy: { id: 'asc' },
    select: { id: true, name: true },
  });

  if (sites.length === 0) {
    console.log('⏭️  No sites found — skipping ServiceEntry seed');
    return;
  }

  const jobTypes: Array<{ job: 'SERVICE' | 'CLEANING' | 'INSPECTION'; label: string }> = [
    { job: 'SERVICE', label: 'Service' },
    { job: 'CLEANING', label: 'Cleaning' },
    { job: 'INSPECTION', label: 'Inspection' },
  ];

  let created = 0;
  for (const site of sites) {
    for (const { job, label } of jobTypes) {
      const exists = await prisma.serviceEntry.findFirst({
        where: { siteId: site.id, job },
      });
      if (!exists) {
        await prisma.serviceEntry.create({
          data: {
            siteId: site.id,
            job,
            description: `${label} — ${site.name}`,
          },
        });
        created++;
      }
    }
  }

  console.log(`✅ Seed service entries: ${created} created (${sites.length} sites × ${jobTypes.length} job types)`);
}

async function main() {
  await seedUsers();
  await seedStockMaster();
  await enrichSitesFromMappingResult();
  await seedClientDataThailand();
  await seedServiceEntries();
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
