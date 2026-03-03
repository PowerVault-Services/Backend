import prisma from '../config/prisma';
import { huaweiAlarm, huaweiBackup, huaweiOnDemand, HuaweiService } from './huaweiService';
import { pickAlarmClient } from './huaweiPool';

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function toDate(ms?: number): Date | null {
  if (!ms || !Number.isFinite(ms)) return null;
  return new Date(ms);
}


function summarizeTopPlants(items: any[], topN = 8) {
  const m = new Map<string, number>();
  for (const a of items) {
    const code = String(a?.stationCode ?? 'NA');
    m.set(code, (m.get(code) ?? 0) + 1);
  }
  const arr = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, topN);
  return arr.map(([code, cnt]) => `${code}:${cnt}`).join(', ');
}

function makeHuaweiAlarmKey(a: any) {
  const alarmId = a?.alarmId ?? 'NA';
  const raiseTime = a?.raiseTime ?? '0';
  const esn = a?.esnCode ?? 'NA';
  return `${alarmId}:${raiseTime}:${esn}`;
}

export async function syncActiveAlarms() {
  const now = Date.now();
  // Huawei/FusionSolar often limits alarm query windows. A very large lookback can return
  // no data or fail silently depending on tenant settings.
  // Default to 30 days and hard-cap to 30 days for safety.
  const lookbackDaysEnv = Number(process.env.HUAWEI_ALARM_LOOKBACK_DAYS ?? 30);
  const lookbackDays = Number.isFinite(lookbackDaysEnv) ? Math.min(Math.max(1, lookbackDaysEnv), 30) : 30;
  const beginTime = now - lookbackDays * 24 * 60 * 60 * 1000;
  const endTime = now;

  const sites = await prisma.site.findMany({
    select: { id: true, plantCode: true, name: true },
    take: 5000,
  });

  const stationCodes = sites.map((s) => s.plantCode).filter(Boolean);
  if (stationCodes.length === 0) return { ok: true, fetched: 0, upserted: 0, cleared: 0 };

  const siteMap = new Map<string, { id: number; name: string }>();
  for (const s of sites) siteMap.set(s.plantCode, { id: s.id, name: s.name });

  const inverters = await prisma.inverter.findMany({
    select: { id: true, serialNumber: true, siteId: true },
    take: 50000,
  });

  const invBySn = new Map<string, { id: number; siteId: number }>();
  for (const inv of inverters) invBySn.set(inv.serialNumber, { id: inv.id, siteId: inv.siteId });

  let totalFetched = 0;
  let totalUpserted = 0;

  const batches = chunk(stationCodes, 100);

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const client: HuaweiService = pickAlarmClient(i);

    console.log(`🔁 [${(client as any).label ?? 'ALARM'}] Sync alarm batch: ${batch.length} plants (first=${batch[0]})`);

    const res = await client.getAlarmList({
      stationCodes: batch,
      beginTime,
      endTime,
      language: 'en_US',
      levels: '1,2,3,4',
    });

    if (!res?.success) {
      // make it visible in logs when Huawei refuses the time window / token / etc.
      console.warn(`⚠️ [ALARM] Huawei getAlarmList failed (batchSize=${batch.length})`, {
        failCode: (res as any)?.failCode,
        message: (res as any)?.message,
      });
      continue;
    }

    const list: any[] = res?.data ?? [];
    totalFetched += list.length;

    console.log(`📥 [ALARM] Batch alarms=${list.length} | top=${summarizeTopPlants(list, 8)}`);

    for (const a of list) {
      const key = makeHuaweiAlarmKey(a);
      const stationCode = String(a?.stationCode ?? '');
      const site = siteMap.get(stationCode);

      const esn = a?.esnCode ? String(a.esnCode) : null;
      const inv = esn ? invBySn.get(esn) : null;

      if (process.env.HUAWEI_API_DEBUG === '1') {
        const stationCode = String(a?.stationCode ?? '');
        const sev = a?.lev ?? '-';
        const nm = a?.alarmName ?? '-';
        console.log(`🧷 [ALARM] ${stationCode} sev=${sev} esn=${esn ?? '-'} -> siteId=${site?.id ?? 'NULL'} inverterId=${inv?.id ?? 'NULL'} | ${nm}`);
      }

      const occurredAt = toDate(a?.raiseTime);
      const severity = a?.lev != null ? Number(a.lev) : null;

      await prisma.alarm.upsert({
        where: { huaweiAlarmId: key },
        create: {
          huaweiAlarmId: key,
          siteId: site?.id,
          inverterId: inv?.id,
          name: a?.alarmName ?? null,
          severity: severity ?? null,
          status: 'ACTIVE',
          occurredAt,
          clearedAt: null,
          raw: a,
        },
        update: {
          siteId: site?.id ?? undefined,
          inverterId: inv?.id ?? undefined,
          name: a?.alarmName ?? undefined,
          severity: severity ?? undefined,
          status: 'ACTIVE',
          occurredAt: occurredAt ?? undefined,
          clearedAt: null,
          raw: a,
        },
      });

      totalUpserted += 1;
    }
  }

  // mark cleared: ถ้าไม่ได้ถูก update ในช่วง STALE_MS ให้ถือว่าเคลียร์แล้ว
  const staleMs = Number(process.env.HUAWEI_ALARM_STALE_MS ?? 10 * 60 * 1000);
  const staleBefore = new Date(Date.now() - staleMs);

  const cleared = await prisma.alarm.updateMany({
    where: {
      clearedAt: null,
      status: 'ACTIVE',
      updatedAt: { lt: staleBefore },
    },
    data: { clearedAt: new Date(), status: 'CLEARED' },
  });

  return { ok: true, fetched: totalFetched, upserted: totalUpserted, cleared: cleared.count };
}

/**
 * ON-DEMAND: sync alarms for specific plants (short lookback) using ONDEMAND account.
 * Used by frontend when opening Monitoring pages.
 */
export async function syncAlarmsForStationsOnDemand(stationCodes: string[], lookbackHours = 24) {
  if (!stationCodes?.length) return { ok: true, fetched: 0, upserted: 0 };

  const now = Date.now();
  const beginTime = now - lookbackHours * 60 * 60 * 1000;
  const endTime = now;

  const sites = await prisma.site.findMany({ where: { plantCode: { in: stationCodes } }, select: { id: true, plantCode: true, name: true } });
  const siteMap = new Map<string, { id: number; name: string }>();
  for (const s of sites) siteMap.set(s.plantCode, { id: s.id, name: s.name });

  const invs = await prisma.inverter.findMany({ where: { stationCode: { in: stationCodes } }, select: { id: true, serialNumber: true, siteId: true } });
  const invBySn = new Map<string, { id: number; siteId: number }>();
  for (const inv of invs) invBySn.set(inv.serialNumber, { id: inv.id, siteId: inv.siteId });

  const client = huaweiOnDemand;
  console.log(`⚡ [ONDEMAND] Refresh alarms for plants=${stationCodes.length} (first=${stationCodes[0]})`);

  const batches = chunk(stationCodes, 100);
  let fetched = 0;
  let upserted = 0;

  for (const batch of batches) {
    const res = await client.getAlarmList({ stationCodes: batch, beginTime, endTime, language: 'en_US', levels: '1,2,3,4' });
    if (!res?.success) continue;

    const list: any[] = res?.data ?? [];
    fetched += list.length;

    for (const a of list) {
      const key = makeHuaweiAlarmKey(a);
      const stationCode = String(a?.stationCode ?? '');
      const site = siteMap.get(stationCode);

      const esn = a?.esnCode ? String(a.esnCode) : null;
      const inv = esn ? invBySn.get(esn) : null;

      const occurredAt = toDate(a?.raiseTime);
      const severity = a?.lev != null ? Number(a.lev) : null;

      await prisma.alarm.upsert({
        where: { huaweiAlarmId: key },
        create: {
          huaweiAlarmId: key,
          siteId: site?.id,
          inverterId: inv?.id,
          name: a?.alarmName ?? null,
          severity: severity ?? null,
          status: 'ACTIVE',
          occurredAt,
          clearedAt: null,
          raw: a,
        },
        update: {
          siteId: site?.id ?? undefined,
          inverterId: inv?.id ?? undefined,
          name: a?.alarmName ?? undefined,
          severity: severity ?? undefined,
          status: 'ACTIVE',
          occurredAt: occurredAt ?? undefined,
          clearedAt: null,
          raw: a,
        },
      });
      upserted += 1;
    }
  }

  return { ok: true, fetched, upserted };
}