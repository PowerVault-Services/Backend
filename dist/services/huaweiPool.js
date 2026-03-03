"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.huaweiClients = void 0;
exports.pickBulkClient = pickBulkClient;
exports.pickAlarmClient = pickAlarmClient;
exports.pickOnDemandClient = pickOnDemandClient;
const huaweiService_1 = require("./huaweiService");
function hashString(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++)
        h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h;
}
function pickBulkClient(stationCode) {
    const useBackup = (hashString(stationCode) & 1) === 1;
    return useBackup ? huaweiService_1.huaweiBackup : huaweiService_1.huaweiMain;
}
function pickAlarmClient(batchIndex) {
    return batchIndex % 2 === 0 ? huaweiService_1.huaweiAlarm : huaweiService_1.huaweiBackup;
}
function pickOnDemandClient() {
    return huaweiService_1.huaweiOnDemand;
}
exports.huaweiClients = {
    main: huaweiService_1.huaweiMain,
    alarm: huaweiService_1.huaweiAlarm,
    backup: huaweiService_1.huaweiBackup,
    ondemand: huaweiService_1.huaweiOnDemand,
};
