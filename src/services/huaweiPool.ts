
import { huaweiMain, huaweiAlarm, huaweiBackup, huaweiOnDemand, HuaweiService } from './huaweiService';

function hashString(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

export function pickBulkClient(stationCode: string): HuaweiService {
  const useBackup = (hashString(stationCode) & 1) === 1;
  return useBackup ? huaweiBackup : huaweiMain;
}

export function pickAlarmClient(batchIndex: number): HuaweiService {
  return batchIndex % 2 === 0 ? huaweiAlarm : huaweiBackup;
}

export function pickOnDemandClient(): HuaweiService {
  return huaweiOnDemand;
}

export const huaweiClients = {
  main: huaweiMain,
  alarm: huaweiAlarm,
  backup: huaweiBackup,
  ondemand: huaweiOnDemand,
};
