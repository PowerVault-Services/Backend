import { __testUtils } from '../services/syncService';

const {
  chunk,
  snapTsNow,
  startOfLocalDay,
  parseNum,
  parseDate,
  deriveStringStatus,
  deriveInverterStatus,
  enqueueRetry,
  retryQueue,
  normalizeOnDemandOptions,
  makeOnDemandInflightKey,
  pickStationCode,
  normalizeDeviceTarget,
  recordSyncOutcome,
  getBackpressureLevel,
  getBackpressureMultiplier,
  resetBackpressureWindow,
} = __testUtils;

// ──────────────────────── chunk ────────────────────────

describe('chunk', () => {
  it('splits array into equal-sized chunks', () => {
    expect(chunk([1, 2, 3, 4], 2)).toEqual([[1, 2], [3, 4]]);
  });

  it('handles remainder', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('returns empty array for empty input', () => {
    expect(chunk([], 3)).toEqual([]);
  });

  it('returns whole array when size >= length', () => {
    expect(chunk([1, 2], 10)).toEqual([[1, 2]]);
  });
});

// ──────────────────────── snapTsNow ────────────────────────

describe('snapTsNow', () => {
  it('snaps to 5-minute slot', () => {
    const slot = 5 * 60_000;
    const result = snapTsNow(slot);
    expect(result.getTime() % slot).toBe(0);
  });

  it('returns a Date object', () => {
    expect(snapTsNow(60_000)).toBeInstanceOf(Date);
  });
});

// ──────────────────────── startOfLocalDay ────────────────────────

describe('startOfLocalDay', () => {
  it('returns a Date at midnight for a known date', () => {
    const result = startOfLocalDay(new Date('2025-06-15T10:30:00Z'));
    expect(result).toBeInstanceOf(Date);
    // Should be earlier than the input
    expect(result.getTime()).toBeLessThanOrEqual(new Date('2025-06-15T10:30:00Z').getTime());
  });

  it('returns same-day midnight (not previous day) for near-midnight UTC+7', () => {
    // 2025-06-15 00:30 Bangkok = 2025-06-14 17:30 UTC
    const bangkokNearMidnight = new Date('2025-06-14T17:30:00Z');
    const result = startOfLocalDay(bangkokNearMidnight);
    // Result should be 2025-06-14T17:00:00Z (midnight Bangkok = 17:00 UTC)
    expect(result.getTime()).toBeLessThanOrEqual(bangkokNearMidnight.getTime());
    // The gap should be 30 minutes (00:30 - 00:00)
    const diffMs = bangkokNearMidnight.getTime() - result.getTime();
    expect(diffMs).toBe(30 * 60_000);
  });

  it('defaults to current date when no argument', () => {
    const before = Date.now();
    const result = startOfLocalDay();
    expect(result.getTime()).toBeLessThanOrEqual(before);
    // Should be within the last 24 hours
    expect(before - result.getTime()).toBeLessThan(24 * 60 * 60_000);
  });
});

// ──────────────────────── parseNum ────────────────────────

describe('parseNum', () => {
  it('parses valid numbers', () => {
    expect(parseNum(42)).toBe(42);
    expect(parseNum('3.14')).toBe(3.14);
    expect(parseNum(0)).toBe(0);
  });

  it('returns null for null/undefined/empty', () => {
    expect(parseNum(null)).toBeNull();
    expect(parseNum(undefined)).toBeNull();
    expect(parseNum('')).toBeNull();
  });

  it('returns null for NaN/Infinity', () => {
    expect(parseNum('abc')).toBeNull();
    expect(parseNum(Infinity)).toBeNull();
    expect(parseNum(NaN)).toBeNull();
  });
});

// ──────────────────────── parseDate ────────────────────────

describe('parseDate', () => {
  it('parses valid ISO date', () => {
    const result = parseDate('2025-01-15T10:00:00Z');
    expect(result).toBeInstanceOf(Date);
    expect(result!.toISOString()).toBe('2025-01-15T10:00:00.000Z');
  });

  it('returns null for null/undefined/empty', () => {
    expect(parseDate(null)).toBeNull();
    expect(parseDate(undefined)).toBeNull();
    expect(parseDate('')).toBeNull();
  });

  it('returns null for invalid date string', () => {
    expect(parseDate('not-a-date')).toBeNull();
  });
});

// ──────────────────────── deriveStringStatus ────────────────────────

describe('deriveStringStatus', () => {
  it('returns Disconnected when both null', () => {
    expect(deriveStringStatus(null, null)).toBe('Disconnected');
  });

  it('returns Lost when voltage > 50 and current < 0.05', () => {
    expect(deriveStringStatus(100, 0.01)).toBe('Lost');
  });

  it('returns Normal for typical values', () => {
    expect(deriveStringStatus(300, 5.0)).toBe('Normal');
  });

  it('returns Normal when voltage is 0', () => {
    expect(deriveStringStatus(0, 0)).toBe('Normal');
  });

  it('returns Normal when only voltage is null', () => {
    expect(deriveStringStatus(null, 5)).toBe('Normal');
  });
});

// ──────────────────────── deriveInverterStatus ────────────────────────

describe('deriveInverterStatus', () => {
  it('returns Disconnected for null', () => {
    expect(deriveInverterStatus(null)).toBe('Disconnected');
  });

  it('returns Disconnected for undefined', () => {
    expect(deriveInverterStatus(undefined)).toBe('Disconnected');
  });

  it('returns Fault for known fault states (3-10)', () => {
    expect(deriveInverterStatus(3)).toBe('Fault');
    expect(deriveInverterStatus(5)).toBe('Fault');
    expect(deriveInverterStatus(10)).toBe('Fault');
  });

  it('returns Normal for non-fault run states', () => {
    expect(deriveInverterStatus(1)).toBe('Normal');
    expect(deriveInverterStatus(2)).toBe('Normal');
    expect(deriveInverterStatus(0)).toBe('Normal');
  });
});

// ──────────────────────── retryQueue + enqueueRetry ────────────────────────

describe('retryQueue', () => {
  beforeEach(() => {
    retryQueue.clear();
  });

  it('adds station codes to queue', () => {
    enqueueRetry('PLANT_001');
    enqueueRetry('PLANT_002');
    expect(retryQueue.size).toBe(2);
    expect(retryQueue.has('PLANT_001')).toBe(true);
  });

  it('deduplicates and moves to end on re-add', () => {
    enqueueRetry('PLANT_001');
    enqueueRetry('PLANT_002');
    enqueueRetry('PLANT_001'); // re-add moves to end
    expect(retryQueue.size).toBe(2);
    const items = Array.from(retryQueue);
    expect(items).toEqual(['PLANT_002', 'PLANT_001']);
  });

  it('evicts oldest when exceeding max', () => {
    // RETRY_QUEUE_MAX defaults to 500, so add 501
    for (let i = 0; i < 501; i++) {
      enqueueRetry(`P_${i.toString().padStart(4, '0')}`);
    }
    // Should have evicted the first one
    expect(retryQueue.has('P_0000')).toBe(false);
    expect(retryQueue.has('P_0001')).toBe(true);
    expect(retryQueue.has('P_0500')).toBe(true);
  });
});

// ──────────────────────── normalizeOnDemandOptions ────────────────────────

describe('normalizeOnDemandOptions', () => {
  it('returns defaults when no options', () => {
    const result = normalizeOnDemandOptions();
    expect(result).toEqual({
      includeSiteRealtime: true,
      forceSiteRealtime: false,
      includeInventory: true,
      forceInventory: false,
      includeDeviceDetail: true,
      forceDeviceDetail: false,
    });
  });

  it('respects overrides', () => {
    const result = normalizeOnDemandOptions({
      includeSiteRealtime: false,
      forceSiteRealtime: true,
    });
    expect(result.includeSiteRealtime).toBe(false);
    expect(result.forceSiteRealtime).toBe(true);
    expect(result.includeInventory).toBe(true);
  });
});

// ──────────────────────── makeOnDemandInflightKey ────────────────────────

describe('makeOnDemandInflightKey', () => {
  it('includes plant code', () => {
    const key = makeOnDemandInflightKey('PLANT_123');
    expect(key).toContain('PLANT_123');
  });

  it('different options produce different keys', () => {
    const key1 = makeOnDemandInflightKey('P1', { includeSiteRealtime: true });
    const key2 = makeOnDemandInflightKey('P1', { includeSiteRealtime: false });
    expect(key1).not.toBe(key2);
  });
});

// ──────────────────────── pickStationCode ────────────────────────

describe('pickStationCode', () => {
  it('picks plantCode', () => {
    expect(pickStationCode({ plantCode: 'ABC123' })).toBe('ABC123');
  });

  it('falls back to stationCode', () => {
    expect(pickStationCode({ stationCode: 'XYZ' })).toBe('XYZ');
  });

  it('prefers plantCode over stationCode', () => {
    expect(pickStationCode({ plantCode: 'A', stationCode: 'B' })).toBe('A');
  });

  it('returns null for empty object', () => {
    expect(pickStationCode({})).toBeNull();
  });

  it('returns null for null/undefined', () => {
    expect(pickStationCode(null)).toBeNull();
    expect(pickStationCode(undefined)).toBeNull();
  });
});

// ──────────────────────── normalizeDeviceTarget ────────────────────────

describe('normalizeDeviceTarget', () => {
  it('normalizes a valid device', () => {
    const result = normalizeDeviceTarget({
      id: 12345,
      devTypeId: 1,
      esnCode: 'SN001',
      devName: 'Inverter 1',
      model: 'SUN2000-10KTL',
    });
    expect(result).toEqual({
      devId: '12345',
      devTypeId: 1,
      serialNumber: 'SN001',
      devName: 'Inverter 1',
      model: 'SUN2000-10KTL',
      softwareVersion: null,
    });
  });

  it('returns null if id is missing', () => {
    expect(normalizeDeviceTarget({ id: undefined as any, devTypeId: 1 })).toBeNull();
  });

  it('returns null if devTypeId is NaN', () => {
    expect(normalizeDeviceTarget({ id: 1, devTypeId: NaN })).toBeNull();
  });

  it('generates fallback serialNumber when esnCode is missing', () => {
    const result = normalizeDeviceTarget({ id: 99, devTypeId: 1 });
    expect(result?.serialNumber).toBe('DEV-99');
  });

  it('uses invType as model fallback', () => {
    const result = normalizeDeviceTarget({ id: 1, devTypeId: 1, invType: 'STRING' });
    expect(result?.model).toBe('STRING');
  });
});

// ──────────────────────── Backpressure ────────────────────────

describe('Backpressure', () => {
  beforeEach(() => {
    resetBackpressureWindow();
    retryQueue.clear();
  });

  it('starts at "none" with no errors', () => {
    expect(getBackpressureLevel()).toBe('none');
    expect(getBackpressureMultiplier()).toBe(1.0);
  });

  it('escalates to "light" after >10% error rate', () => {
    for (let i = 0; i < 8; i++) recordSyncOutcome(true);
    for (let i = 0; i < 2; i++) recordSyncOutcome(false);
    expect(getBackpressureLevel()).toBe('light');
    expect(getBackpressureMultiplier()).toBe(0.75);
  });

  it('escalates to "heavy" after >30% error rate', () => {
    for (let i = 0; i < 6; i++) recordSyncOutcome(true);
    for (let i = 0; i < 4; i++) recordSyncOutcome(false);
    expect(getBackpressureLevel()).toBe('heavy');
    expect(getBackpressureMultiplier()).toBe(0.5);
  });

  it('escalates to "critical" after >50% error rate', () => {
    for (let i = 0; i < 3; i++) recordSyncOutcome(true);
    for (let i = 0; i < 7; i++) recordSyncOutcome(false);
    expect(getBackpressureLevel()).toBe('critical');
    expect(getBackpressureMultiplier()).toBe(0.25);
  });

  it('considers retry queue depth for backpressure', () => {
    // Fill retry queue past 80% to trigger critical via queue ratio
    for (let i = 0; i < 450; i++) enqueueRetry(`PLANT_${i}`);
    expect(getBackpressureLevel()).toBe('critical');
  });

  it('resets cleanly', () => {
    for (let i = 0; i < 10; i++) recordSyncOutcome(false);
    expect(getBackpressureLevel()).not.toBe('none');
    resetBackpressureWindow();
    retryQueue.clear();
    expect(getBackpressureLevel()).toBe('none');
  });
});
