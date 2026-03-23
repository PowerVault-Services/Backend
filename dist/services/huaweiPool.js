"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.huaweiClients = void 0;
exports.describeHuaweiClient = describeHuaweiClient;
exports.replaceKnownHuaweiStationCodes = replaceKnownHuaweiStationCodes;
exports.getKnownHuaweiStationCodes = getKnownHuaweiStationCodes;
exports.hasKnownHuaweiStationInventory = hasKnownHuaweiStationInventory;
exports.isKnownHuaweiStationCode = isKnownHuaweiStationCode;
exports.getKnownHuaweiStationSnapshotAt = getKnownHuaweiStationSnapshotAt;
exports.getDistinctHuaweiClients = getDistinctHuaweiClients;
exports.getStationInventoryClients = getStationInventoryClients;
exports.getPreferredClientOrderForPurpose = getPreferredClientOrderForPurpose;
exports.registerStationAccess = registerStationAccess;
exports.registerStationBatchAccess = registerStationBatchAccess;
exports.noteStationFailure = noteStationFailure;
exports.getStationClientCandidates = getStationClientCandidates;
exports.pickBulkClient = pickBulkClient;
exports.pickAlarmClient = pickAlarmClient;
exports.pickOnDemandClient = pickOnDemandClient;
exports.getStationAccessSnapshot = getStationAccessSnapshot;
exports.resolveDynamicDevicePlantsPerTick = resolveDynamicDevicePlantsPerTick;
const huaweiService_1 = require("./huaweiService");
const PURPOSE_ORDER = {
    inventory: ['backup', 'main', 'alarm', 'ondemand'],
    siteRealtime: ['main', 'backup', 'alarm', 'ondemand'],
    device: ['main', 'backup', 'alarm'],
    alarm: ['alarm', 'backup', 'main'],
    ondemand: ['ondemand', 'alarm', 'backup', 'main'],
};
const stationAccessRegistry = new Map();
const knownHuaweiStationCodes = new Set();
let knownHuaweiStationSnapshotAt = null;
exports.huaweiClients = {
    main: huaweiService_1.huaweiMain,
    alarm: huaweiService_1.huaweiAlarm,
    backup: huaweiService_1.huaweiBackup,
    ondemand: huaweiService_1.huaweiOnDemand,
};
function uniqueServices(services) {
    const seen = new Set();
    const out = [];
    for (const service of services) {
        const key = service.getAccountKey();
        if (seen.has(key))
            continue;
        seen.add(key);
        out.push(service);
    }
    return out;
}
function rotate(items, offset = 0) {
    if (items.length <= 1)
        return items.slice();
    const normalized = ((offset % items.length) + items.length) % items.length;
    if (normalized === 0)
        return items.slice();
    return [...items.slice(normalized), ...items.slice(0, normalized)];
}
function touchStationMeta(stationCode) {
    const existing = stationAccessRegistry.get(stationCode);
    if (existing)
        return existing;
    const created = {
        preferredAccountKeys: [],
        failureCountByAccount: {},
        lastSuccessAt: 0,
        lastFailureAt: null,
    };
    stationAccessRegistry.set(stationCode, created);
    return created;
}
function serviceLabel(service) {
    const labels = service.getLabels();
    return labels.length > 0 ? labels.join('/') : service.getAccountKey();
}
function describeHuaweiClient(service) {
    return serviceLabel(service);
}
function replaceKnownHuaweiStationCodes(stationCodes) {
    knownHuaweiStationCodes.clear();
    for (const stationCode of stationCodes) {
        if (!stationCode)
            continue;
        knownHuaweiStationCodes.add(String(stationCode));
    }
    knownHuaweiStationSnapshotAt = Date.now();
}
function getKnownHuaweiStationCodes() {
    return Array.from(knownHuaweiStationCodes);
}
function hasKnownHuaweiStationInventory() {
    return knownHuaweiStationCodes.size > 0;
}
function isKnownHuaweiStationCode(stationCode) {
    return !!stationCode && knownHuaweiStationCodes.has(String(stationCode));
}
function getKnownHuaweiStationSnapshotAt() {
    return knownHuaweiStationSnapshotAt;
}
function getDistinctHuaweiClients(purpose, batchIndex = 0) {
    const logicalOrder = PURPOSE_ORDER[purpose ?? 'siteRealtime'];
    const services = logicalOrder.map((key) => exports.huaweiClients[key]);
    return uniqueServices(rotate(services, batchIndex));
}
function getStationInventoryClients() {
    return getDistinctHuaweiClients('inventory');
}
function getPreferredClientOrderForPurpose(purpose, batchIndex = 0) {
    return getDistinctHuaweiClients(purpose, batchIndex);
}
function registerStationAccess(stationCode, service) {
    if (!stationCode)
        return;
    const meta = touchStationMeta(stationCode);
    const accountKey = service.getAccountKey();
    meta.preferredAccountKeys = [accountKey, ...meta.preferredAccountKeys.filter((key) => key !== accountKey)];
    meta.failureCountByAccount[accountKey] = 0;
    meta.lastSuccessAt = Date.now();
}
function registerStationBatchAccess(stationCodes, service) {
    for (const stationCode of stationCodes)
        registerStationAccess(stationCode, service);
}
function noteStationFailure(stationCode, service) {
    if (!stationCode)
        return;
    const meta = touchStationMeta(stationCode);
    const accountKey = service.getAccountKey();
    meta.failureCountByAccount[accountKey] = (meta.failureCountByAccount[accountKey] ?? 0) + 1;
    meta.lastFailureAt = Date.now();
}
function getStationClientCandidates(stationCode, purpose, opts) {
    const batchIndex = opts?.batchIndex ?? 0;
    const base = getPreferredClientOrderForPurpose(purpose, batchIndex);
    const preferredAccountKeys = stationAccessRegistry.get(stationCode)?.preferredAccountKeys ?? [];
    const preferredFromRegistry = preferredAccountKeys
        .map((accountKey) => base.find((service) => service.getAccountKey() === accountKey) ?? getDistinctHuaweiClients().find((service) => service.getAccountKey() === accountKey))
        .filter((service) => !!service);
    const combined = uniqueServices([
        ...(opts?.preferredClient ? [opts.preferredClient] : []),
        ...preferredFromRegistry,
        ...base,
    ]);
    const failureCountByAccount = stationAccessRegistry.get(stationCode)?.failureCountByAccount ?? {};
    const orderByAccount = new Map(combined.map((service, index) => [service.getAccountKey(), index]));
    return combined.slice().sort((a, b) => {
        const cooldownDiff = a.getCooldownRemainingMs() - b.getCooldownRemainingMs();
        if (cooldownDiff !== 0)
            return cooldownDiff;
        const failureDiff = (failureCountByAccount[a.getAccountKey()] ?? 0) - (failureCountByAccount[b.getAccountKey()] ?? 0);
        if (failureDiff !== 0)
            return failureDiff;
        return (orderByAccount.get(a.getAccountKey()) ?? 0) - (orderByAccount.get(b.getAccountKey()) ?? 0);
    });
}
function pickBulkClient(stationCode) {
    return getStationClientCandidates(stationCode, 'device')[0] ?? huaweiService_1.huaweiMain;
}
function pickAlarmClient(batchIndex) {
    return getPreferredClientOrderForPurpose('alarm', batchIndex)[0] ?? huaweiService_1.huaweiAlarm;
}
let onDemandRoundRobin = 0;
function pickOnDemandClient() {
    const candidates = getDistinctHuaweiClients('ondemand', onDemandRoundRobin);
    onDemandRoundRobin = (onDemandRoundRobin + 1) % Math.max(1, candidates.length);
    const available = candidates.filter((c) => c.getCooldownRemainingMs() <= 0);
    return (available.length > 0 ? available[0] : candidates[0]) ?? huaweiService_1.huaweiOnDemand;
}
function getStationAccessSnapshot() {
    return Array.from(stationAccessRegistry.entries()).map(([stationCode, meta]) => ({
        stationCode,
        preferredAccountKeys: meta.preferredAccountKeys.slice(),
        failureCountByAccount: { ...meta.failureCountByAccount },
        lastSuccessAt: meta.lastSuccessAt,
        lastFailureAt: meta.lastFailureAt,
    }));
}
function resolveDynamicDevicePlantsPerTick() {
    const distinctClients = getDistinctHuaweiClients('device').length;
    const perAccount = Math.max(1, Number(process.env.HUAWEI_DEVICE_PLANTS_PER_ACCOUNT_PER_TICK ?? 2));
    const minPlants = Math.max(1, Number(process.env.HUAWEI_MIN_DEVICE_PLANTS_PER_TICK ?? Math.max(4, perAccount)));
    const maxPlants = Math.max(minPlants, Number(process.env.HUAWEI_MAX_DEVICE_PLANTS_PER_TICK ?? Math.max(8, distinctClients * perAccount)));
    return Math.max(minPlants, Math.min(maxPlants, Math.max(1, distinctClients) * perAccount));
}
