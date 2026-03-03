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
const PROJECT_EXTRAS = [
  {
    "region": "ตะวันออก",
    "pvModuleCount": 1980,
    "projectName": "CPN Sriracha",
    "capacityKWp": 999.9,
    "locationText": "ชลบุรี",
    "contactPhoneRaw": "คุณไก่ 088-6615635\nคุณสุรศักดิ์ 089-3564888",
    "contactEmailRaw": "jevichai@centralpattana.co.th\nchamnan@lenso.com\nCC : lsi-chanika@lenso.com\nsoravit_y@lenso.com"
  },
  {
    "region": "กลาง",
    "pvModuleCount": 2498,
    "projectName": "Robinson สระบุรี",
    "capacityKWp": 999.2,
    "locationText": "สระบุรี",
    "contactPhoneRaw": "คุณทรงวุฒิ : 098-824-4488",
    "contactEmailRaw": "to : jusongwuth@central.co.th\ncc : Mallfmsaraburi@central.co.th\nOperationmanagersaraburi@central.co.th\nlsi-chanika@lenso.com\nsoravit_y@lenso.com"
  },
  {
    "region": "ตะวันออก",
    "pvModuleCount": 288,
    "projectName": "บริษัท เออาร์ พาราวูด จำกัด",
    "capacityKWp": 200.16,
    "locationText": "ระยอง",
    "contactPhoneRaw": "เบอร์กลางหน้างาน - 0941569151\nคุณมีนารินทร์ - 0949423659",
    "contactEmailRaw": "Chalermrat.M@sinopower.co.th\nwaraporn.l@sinopower.co.th\nChanapong.S@sinopower.co.th"
  },
  {
    "region": "กลาง",
    "pvModuleCount": 698,
    "projectName": "Toshiba (BOI)",
    "capacityKWp": 380.41,
    "locationText": "นนทบุรี",
    "contactPhoneRaw": "คุณธีรยุทธ 090-985-0166",
    "contactEmailRaw": "teerayutl@ttei.toshiba.co.th"
  },
  {
    "region": "กลาง",
    "pvModuleCount": 1640,
    "projectName": "SANDEN INTERCOOL 1",
    "capacityKWp": 1016.8,
    "locationText": "สิงห์บุรี",
    "contactPhoneRaw": "คุณสุรนาท 0972508424",
    "contactEmailRaw": "pe_05@sandenintercool.com"
  },
  {
    "region": "กลาง",
    "pvModuleCount": 2097,
    "projectName": "SANDEN INTERCOOL 2",
    "capacityKWp": 1300.14,
    "locationText": "สิงห์บุรี",
    "contactPhoneRaw": "คุณสุรนาท 0972508424",
    "contactEmailRaw": "pe_05@sandenintercool.com"
  },
  {
    "region": "ใต้",
    "pvModuleCount": 648,
    "projectName": "Mega Wood สาขานาโยง",
    "capacityKWp": 356.16,
    "locationText": "ตรัง",
    "contactPhoneRaw": "คุณจีรศักดิ์ ทองมีบัว 087-895-7566",
    "contactEmailRaw": "jeerasak.t@megawood.co.th"
  },
  {
    "region": "กลาง",
    "pvModuleCount": 1834,
    "projectName": "M Senko",
    "capacityKWp": 999.53,
    "locationText": "สมุทรปราการ",
    "contactPhoneRaw": "คุณกิ่ง 088-233-4458",
    "contactEmailRaw": "narongsak.ph@m-senko.com\nmsl_engineer@m-senko.com\nCC : lsi-chanika@lenso.com \nsoravit_y@lenso.com"
  },
  {
    "region": "กลาง",
    "pvModuleCount": 1230,
    "projectName": "M Senko Phase 2",
    "capacityKWp": 1230,
    "locationText": "สมุทรปราการ",
    "contactPhoneRaw": "คุณกิ่ง 088-233-4458",
    "contactEmailRaw": "narongsak.ph@m-senko.com\nmsl_engineer@m-senko.com"
  },
  {
    "region": "ตะวันออก",
    "pvModuleCount": 720,
    "projectName": "บริษัท เอ็มซีซี ลาเบลส์ กรุงเทพ จำกัด",
    "capacityKWp": 446.4,
    "locationText": "ชลบุรี",
    "contactPhoneRaw": "คุณกี้ 088-0133324",
    "contactEmailRaw": "Chalermrat.M@sinopower.co.th\nwaraporn.l@sinopower.co.th\nChanapong.S@sinopower.co.th"
  },
  {
    "region": "กลาง",
    "pvModuleCount": 386,
    "projectName": "บริษัท ดี.ที.เอส.อุตสาหกรรม จำกัด",
    "capacityKWp": 262.48,
    "locationText": "สมุทรปราการ",
    "contactPhoneRaw": "คุณธนะวรรธน์ 082-3605428\nคุณพรเทพ 087-5071886",
    "contactEmailRaw": "Chalermrat.M@sinopower.co.th\nwaraporn.l@sinopower.co.th\nChanapong.S@sinopower.co.th"
  },
  {
    "region": "ใต้",
    "pvModuleCount": 970,
    "projectName": "AIS Songkhla",
    "capacityKWp": 300.15,
    "locationText": "สงขลา",
    "contactPhoneRaw": "AIS หาดใหญ่ พี่ณัฐพล \n0818953339",
    "contactEmailRaw": "gulf1_om@gulf.co.th\nGULF1_Safety@gulf.co.th"
  },
  {
    "region": "กลาง",
    "pvModuleCount": 1834,
    "projectName": "Ecco Tannery (BOI)",
    "capacityKWp": 999.53,
    "locationText": "อยุธยา",
    "contactPhoneRaw": "คุณกรกช 092-2749991",
    "contactEmailRaw": "kau@ecco.com , waka@ecco.com , \nchau@ecco.com , saw@ecco.com , thju@ecco.com"
  },
  {
    "region": "กลาง",
    "pvModuleCount": 566,
    "projectName": "SONGSERM COMMERCIAL REFRIGERATION (THAILAND) CO.,LTD.",
    "capacityKWp": 350.92,
    "locationText": "สิงห์บุรี",
    "contactPhoneRaw": "คุณสำเร็จ 089-7221166\nคุณพัฒน (จัดซื้อ) 085-4817034",
    "contactEmailRaw": "wirat@songsermref.com\nphattana@songsermref.com"
  },
  {
    "region": "กลาง",
    "pvModuleCount": 718,
    "projectName": "Polar Plastic",
    "capacityKWp": 445.08,
    "locationText": "สมุทรปราการ",
    "contactPhoneRaw": "ช่างคมสัน 097-3436455",
    "contactEmailRaw": "mt@polar-plastic.com"
  },
  {
    "region": "ตะวันออก",
    "pvModuleCount": 2499,
    "projectName": "Robinson ฉะเชิงเทรา",
    "capacityKWp": 999.6,
    "locationText": "ฉะเชิงเทรา",
    "contactPhoneRaw": "ช่างสาขา 0886054547\nคุณทรงวุฒิ 098-824-4488",
    "contactEmailRaw": "to : jusongwuth@central.co.th\ncc : mallmechachoengsao@central.co.th\nlsi-chanika@lenso.com\nsoravit_y@lenso.com"
  },
  {
    "region": "ใต้",
    "pvModuleCount": 1438,
    "projectName": "Mega Hatyai",
    "capacityKWp": 999.41,
    "locationText": "สงขลา",
    "contactPhoneRaw": "คุณกาย 088-3984545",
    "contactEmailRaw": "office.megahatyai@gmail.com"
  },
  {
    "region": "กลาง",
    "pvModuleCount": 2860,
    "projectName": "บริษัท เฮ็ลธ์ฟู้ดส์ คอร์ปอเรชั่น จำกัด ( HFC )",
    "capacityKWp": 2002,
    "locationText": "สระบุุรี",
    "contactPhoneRaw": "คุณมังกร 091-1201939",
    "contactEmailRaw": "gon108359@hotmail.com"
  },
  {
    "region": "ใต้",
    "pvModuleCount": 1612,
    "projectName": "Piti seafood จะนะ",
    "capacityKWp": 999.44,
    "locationText": "สงขลา",
    "contactPhoneRaw": "คุณปอ 089-5816369\nคุณกิศนา 088-3992991",
    "contactEmailRaw": "iso.ptf@gmail.com"
  },
  {
    "region": "ตะวันออก",
    "pvModuleCount": 1303,
    "projectName": "United Coil Center (UCC)",
    "capacityKWp": 710.14,
    "locationText": "ชลบุรี",
    "contactPhoneRaw": "คุณปารุวัฒน์ - 0889133899",
    "contactEmailRaw": "paruwat_c@ucc.co.th"
  },
  {
    "region": "ใต้",
    "pvModuleCount": 1612,
    "projectName": "Semperflex Asia",
    "capacityKWp": 999.44,
    "locationText": "สงขลา",
    "contactPhoneRaw": "คุณตูน 063-8207689\nคุณวิโรจ 092-2563772",
    "contactEmailRaw": "watcharapornc@sritranggroup.com"
  },
  {
    "region": "กลาง",
    "pvModuleCount": 364,
    "projectName": "บริษัท เค-เฟรช จำกัด (สาขา สวนส้ม)",
    "capacityKWp": 254.8,
    "locationText": "สมุทรสาคร",
    "contactPhoneRaw": "คุณเกียรติ ผจก.โครงการ 081-4307006",
    "contactEmailRaw": "Chalermrat.M@sinopower.co.th\nwaraporn.l@sinopower.co.th\nChanapong.S@sinopower.co.th"
  },
  {
    "region": "กลาง",
    "pvModuleCount": 360,
    "projectName": "DMT PLASTECH",
    "capacityKWp": 223.2,
    "locationText": "สมุทรสาคร",
    "contactPhoneRaw": "คุณชนิดา 081-4462333\nคุณอาสา 095-4563615",
    "contactEmailRaw": "dmt.plastech@gmail.com\ndmtpurchase.plastech@gmail.com"
  },
  {
    "region": "ใต้",
    "pvModuleCount": 1408,
    "projectName": "บริษัท โกร๊ปฮอลส์ จำกัด",
    "capacityKWp": 999.68,
    "locationText": "สงขลา",
    "contactPhoneRaw": "K. Somjet Seayang CEO ฝ่ายวิศวกรรม 081-7668797\nK. wassana Dangsawat ฝ่ายการเงินและบัญชี 081-8962136",
    "contactEmailRaw": "Chalermrat.M@sinopower.co.th\nwaraporn.l@sinopower.co.th\nChanapong.S@sinopower.co.th"
  },
  {
    "region": "กลาง",
    "pvModuleCount": 1439,
    "projectName": "TWD บางนา เฟส 2",
    "capacityKWp": 1000,
    "locationText": "สมุทรปราการ",
    "contactPhoneRaw": "MTN.สาขา : จิรวัฒน์ 083-797-3820\nArea จิรวัฒน์ สุขศาลา : 083-797-3820",
    "contactEmailRaw": "KhoSupattra@chg.co.th\ncc  sujirawat@chg.co.th"
  },
  {
    "region": "กลาง",
    "pvModuleCount": 822,
    "projectName": "ชัยวารีมารีนโปรดัคส์ (Chaivaree Marin)",
    "capacityKWp": 509.64,
    "locationText": "สมุทรสาคร",
    "contactPhoneRaw": "คุณช่อแก้ว 089-8057038\nคุณสุทิศ (ผู้จัดการโรงาน) 094-6496959",
    "contactEmailRaw": "store.chaivaree@gmail.com"
  },
  {
    "region": "ใต้",
    "pvModuleCount": 1056,
    "projectName": "บริษัท นาบอน พาราวู้ด จำกัด",
    "capacityKWp": 739.2,
    "locationText": "นครศรีธรรมราช",
    "contactPhoneRaw": "คุณสมทรง 061-5969173",
    "contactEmailRaw": "Chalermrat.M@sinopower.co.th\nwaraporn.l@sinopower.co.th\nChanapong.S@sinopower.co.th"
  },
  {
    "region": "กลาง",
    "pvModuleCount": 2170,
    "projectName": "TWD บางนา",
    "capacityKWp": 999.75,
    "locationText": "สมุทรปราการ",
    "contactPhoneRaw": "MTN.สาขา : จิรวัฒน์ 083-797-3820\nArea จิรวัฒน์ สุขศาลา : 083-797-3820",
    "contactEmailRaw": "NgNattapong@chg.co.th\ncc    KhoSupattra@chg.co.th         sujirawat@chg.co.th"
  },
  {
    "region": "อีสาน",
    "pvModuleCount": 1834,
    "projectName": "Do home Burriram (BOI)",
    "capacityKWp": 999.53,
    "locationText": "บุรีรัมย์",
    "contactPhoneRaw": "คุณแมน 099-3402798",
    "contactEmailRaw": "maintenance-br@dohome.co.th"
  },
  {
    "region": "ตะวันออก",
    "pvModuleCount": 1378,
    "projectName": "บริษัท คอร์ติน่า สยาม สปอร์ต จำกัด",
    "capacityKWp": 854.36,
    "locationText": "ฉะเชิงเทรา",
    "contactPhoneRaw": "คุณไปยดา 085-2339779\nคุณมิน คอติน่า 0910060399\n",
    "contactEmailRaw": "Chalermrat.M@sinopower.co.th\nwaraporn.l@sinopower.co.th\nChanapong.S@sinopower.co.th"
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
  return name
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

async function enrichSitesFromExcel() {
  const sites = await prisma.site.findMany({
    select: { id: true, name: true, capacityKWp: true, plantCode: true },
  });

  const byNormName = new Map<string, (typeof sites)[number]>();
  for (const s of sites) byNormName.set(normalizeName(s.name), s);

  // Some known aliases from the Excel
  const ALIASES: Record<string, string> = {
    'cpn sriracha': 'central sriracha',
    'toshiba boi': 'toshiba 380.41kw',
    'robinson ฉะเชิงเทรา': 'robinson chachoengsao',
  };

  function resolveCandidateName(excelName: string): string {
    const n = normalizeName(excelName);
    const alias = ALIASES[n];
    return alias ? normalizeName(alias) : n;
  }

  let updated = 0;
  let unmatched = 0;

  for (const p of PROJECT_EXTRAS) {
    const wantName = resolveCandidateName(p.projectName);

    let best: (typeof sites)[number] | null = null;
    let bestScore = 0;

    const direct = byNormName.get(wantName);
    if (direct) {
      best = direct;
      bestScore = 1;
    } else {
      const targetTokens = tokenSet(p.projectName);
      for (const s of sites) {
        const sim = jaccard(targetTokens, tokenSet(s.name));
        let score = sim;

        // Capacity match bonus (if provided)
        const cap = Number(p.capacityKWp);
        if (!Number.isNaN(cap) && cap > 0 && s.capacityKWp > 0) {
          const diff = Math.abs(s.capacityKWp - cap);
          if (diff <= 1) score += 0.35;
          else if (diff <= 5) score += 0.2;
        }

        if (score > bestScore) {
          bestScore = score;
          best = s;
        }
      }
    }

    if (!best || bestScore < 0.55) {
      console.warn(`⚠️  Unmatched project: "${p.projectName}" (bestScore=${bestScore.toFixed(2)})`);
      unmatched++;
      continue;
    }

    const contactEmail = extractEmails(p.contactEmailRaw);
    const contactPhone = extractPhones(p.contactPhoneRaw);
    const pvModuleCount = p.pvModuleCount ? Number(p.pvModuleCount) : null;

    await prisma.site.update({
      where: { id: best.id },
      data: {
        contactEmail: contactEmail ?? undefined,
        contactPhone: contactPhone ?? undefined,
        pvModuleCount: pvModuleCount ?? undefined,
      },
    });

    console.log(`✅ Site updated: "${best.name}" <- "${p.projectName}" (score=${bestScore.toFixed(2)})`);
    updated++;
  }

  console.log(`✅ Enrich sites done: updated=${updated}, unmatched=${unmatched}`);
}

async function main() {
  await seedUsers();
  await seedStockMaster();
  await enrichSitesFromExcel();
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
