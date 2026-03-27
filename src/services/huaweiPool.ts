import { huaweiMain, huaweiAlarm, huaweiBackup, huaweiOnDemand, huaweiExtra1, HuaweiService } from './huaweiService';

export type HuaweiLogicalClientKey = 'main' | 'backup' | 'alarm' | 'ondemand' | 'extra1';
export type HuaweiPurpose = 'inventory' | 'siteRealtime' | 'device' | 'alarm' | 'ondemand';

type StationAccessMeta = {
  preferredAccountKeys: string[];
  failureCountByAccount: Record<string, number>;
  lastSuccessAt: number;
  lastFailureAt: number | null;
};

const PURPOSE_ORDER: Record<HuaweiPurpose, HuaweiLogicalClientKey[]> = {
  inventory: ['backup', 'main', 'extra1', 'alarm', 'ondemand'],
  siteRealtime: ['main', 'backup', 'extra1', 'alarm', 'ondemand'],
  device: ['main', 'backup', 'extra1', 'alarm'],
  alarm: ['alarm', 'backup', 'main', 'extra1'],
  ondemand: ['ondemand', 'alarm', 'backup', 'main', 'extra1'],
};

const stationAccessRegistry = new Map<string, StationAccessMeta>();
const knownHuaweiStationCodes = new Set<string>();
let knownHuaweiStationSnapshotAt: number | null = null;

export const huaweiClients = {
  main: huaweiMain,
  alarm: huaweiAlarm,
  backup: huaweiBackup,
  ondemand: huaweiOnDemand,
  extra1: huaweiExtra1,
};

function uniqueServices(services: HuaweiService[]): HuaweiService[] {
  const seen = new Set<string>();
  const out: HuaweiService[] = [];

  for (const service of services) {
    const key = service.getAccountKey();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(service);
  }

  return out;
}

function rotate<T>(items: T[], offset = 0): T[] {
  if (items.length <= 1) return items.slice();
  const normalized = ((offset % items.length) + items.length) % items.length;
  if (normalized === 0) return items.slice();
  return [...items.slice(normalized), ...items.slice(0, normalized)];
}

function touchStationMeta(stationCode: string): StationAccessMeta {
  const existing = stationAccessRegistry.get(stationCode);
  if (existing) return existing;

  const created: StationAccessMeta = {
    preferredAccountKeys: [],
    failureCountByAccount: {},
    lastSuccessAt: 0,
    lastFailureAt: null,
  };
  stationAccessRegistry.set(stationCode, created);
  return created;
}

function serviceLabel(service: HuaweiService): string {
  const labels = service.getLabels();
  return labels.length > 0 ? labels.join('/') : service.getAccountKey();
}

export function describeHuaweiClient(service: HuaweiService): string {
  return serviceLabel(service);
}

export function replaceKnownHuaweiStationCodes(stationCodes: string[]) {
  knownHuaweiStationCodes.clear();
  for (const stationCode of stationCodes) {
    if (!stationCode) continue;
    knownHuaweiStationCodes.add(String(stationCode));
  }
  knownHuaweiStationSnapshotAt = Date.now();
}

export function getKnownHuaweiStationCodes() {
  return Array.from(knownHuaweiStationCodes);
}

export function hasKnownHuaweiStationInventory() {
  return knownHuaweiStationCodes.size > 0;
}

export function isKnownHuaweiStationCode(stationCode: string) {
  return !!stationCode && knownHuaweiStationCodes.has(String(stationCode));
}

export function getKnownHuaweiStationSnapshotAt() {
  return knownHuaweiStationSnapshotAt;
}

export function getDistinctHuaweiClients(purpose?: HuaweiPurpose, batchIndex = 0): HuaweiService[] {
  const logicalOrder = PURPOSE_ORDER[purpose ?? 'siteRealtime'];
  const services = logicalOrder.map((key) => huaweiClients[key]);
  return uniqueServices(rotate(services, batchIndex));
}

export function getStationInventoryClients(): HuaweiService[] {
  return getDistinctHuaweiClients('inventory');
}

export function getPreferredClientOrderForPurpose(purpose: HuaweiPurpose, batchIndex = 0): HuaweiService[] {
  return getDistinctHuaweiClients(purpose, batchIndex);
}

export function registerStationAccess(stationCode: string, service: HuaweiService) {
  if (!stationCode) return;
  const meta = touchStationMeta(stationCode);
  const accountKey = service.getAccountKey();
  meta.preferredAccountKeys = [accountKey, ...meta.preferredAccountKeys.filter((key) => key !== accountKey)];
  meta.failureCountByAccount[accountKey] = 0;
  meta.lastSuccessAt = Date.now();
}

export function registerStationBatchAccess(stationCodes: string[], service: HuaweiService) {
  for (const stationCode of stationCodes) registerStationAccess(stationCode, service);
}

export function noteStationFailure(stationCode: string, service: HuaweiService) {
  if (!stationCode) return;
  const meta = touchStationMeta(stationCode);
  const accountKey = service.getAccountKey();
  meta.failureCountByAccount[accountKey] = (meta.failureCountByAccount[accountKey] ?? 0) + 1;
  meta.lastFailureAt = Date.now();
}

export function getStationClientCandidates(
  stationCode: string,
  purpose: HuaweiPurpose,
  opts?: { batchIndex?: number; preferredClient?: HuaweiService | null }
): HuaweiService[] {
  const batchIndex = opts?.batchIndex ?? 0;
  const base = getPreferredClientOrderForPurpose(purpose, batchIndex);
  const preferredAccountKeys = stationAccessRegistry.get(stationCode)?.preferredAccountKeys ?? [];

  const preferredFromRegistry = preferredAccountKeys
    .map((accountKey) => base.find((service) => service.getAccountKey() === accountKey) ?? getDistinctHuaweiClients().find((service) => service.getAccountKey() === accountKey))
    .filter((service): service is HuaweiService => !!service);

  const combined = uniqueServices([
    ...(opts?.preferredClient ? [opts.preferredClient] : []),
    ...preferredFromRegistry,
    ...base,
  ]);

  const failureCountByAccount = stationAccessRegistry.get(stationCode)?.failureCountByAccount ?? {};
  const orderByAccount = new Map(combined.map((service, index) => [service.getAccountKey(), index] as const));

  return combined.slice().sort((a, b) => {
    const cooldownDiff = a.getCooldownRemainingMs() - b.getCooldownRemainingMs();
    if (cooldownDiff !== 0) return cooldownDiff;

    const failureDiff = (failureCountByAccount[a.getAccountKey()] ?? 0) - (failureCountByAccount[b.getAccountKey()] ?? 0);
    if (failureDiff !== 0) return failureDiff;

    return (orderByAccount.get(a.getAccountKey()) ?? 0) - (orderByAccount.get(b.getAccountKey()) ?? 0);
  });
}

export function pickBulkClient(stationCode: string): HuaweiService {
  return getStationClientCandidates(stationCode, 'device')[0] ?? huaweiMain;
}

export function pickAlarmClient(batchIndex: number): HuaweiService {
  return getPreferredClientOrderForPurpose('alarm', batchIndex)[0] ?? huaweiAlarm;
}

let onDemandRoundRobin = 0;

export function pickOnDemandClient(): HuaweiService {
  const candidates = getDistinctHuaweiClients('ondemand', onDemandRoundRobin);
  onDemandRoundRobin = (onDemandRoundRobin + 1) % Math.max(1, candidates.length);
  const available = candidates.filter((c) => c.getCooldownRemainingMs() <= 0);
  return (available.length > 0 ? available[0] : candidates[0]) ?? huaweiOnDemand;
}

export function getStationAccessSnapshot() {
  return Array.from(stationAccessRegistry.entries()).map(([stationCode, meta]) => ({
    stationCode,
    preferredAccountKeys: meta.preferredAccountKeys.slice(),
    failureCountByAccount: { ...meta.failureCountByAccount },
    lastSuccessAt: meta.lastSuccessAt,
    lastFailureAt: meta.lastFailureAt,
  }));
}

export function resolveDynamicDevicePlantsPerTick() {
  const distinctClients = getDistinctHuaweiClients('device').length;
  const perAccount = Math.max(1, Number(process.env.HUAWEI_DEVICE_PLANTS_PER_ACCOUNT_PER_TICK ?? 2));
  const minPlants = Math.max(1, Number(process.env.HUAWEI_MIN_DEVICE_PLANTS_PER_TICK ?? Math.max(4, perAccount)));
  const maxPlants = Math.max(minPlants, Number(process.env.HUAWEI_MAX_DEVICE_PLANTS_PER_TICK ?? Math.max(8, distinctClients * perAccount)));
  return Math.max(minPlants, Math.min(maxPlants, Math.max(1, distinctClients) * perAccount));
}

