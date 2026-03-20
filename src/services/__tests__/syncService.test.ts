// Mock Prisma and heavy dependencies before importing
jest.mock('../../config/prisma', () => ({ default: {} }));
jest.mock('../huaweiService', () => ({
  huaweiMain: { getAccountKey: () => 'main', getLabels: () => ['main'], getCooldownRemainingMs: () => 0 },
  huaweiAlarm: { getAccountKey: () => 'alarm', getLabels: () => ['alarm'], getCooldownRemainingMs: () => 0 },
  huaweiBackup: { getAccountKey: () => 'backup', getLabels: () => ['backup'], getCooldownRemainingMs: () => 0 },
  huaweiOnDemand: { getAccountKey: () => 'ondemand', getLabels: () => ['ondemand'], getCooldownRemainingMs: () => 0 },
  HuaweiService: class {},
}));
jest.mock('../syncStateService', () => ({
  getStalestStationCodes: () => [],
  getStationLastSeenMs: () => ({}),
  getSyncStateSnapshot: () => ({ jobs: {}, stations: {} }),
  markStations: () => {},
}));

import { __testUtils as utils } from '../syncService';

describe('chunk()', () => {
  it('splits an array into chunks of given size', () => {
    expect(utils.chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('returns empty array for empty input', () => {
    expect(utils.chunk([], 3)).toEqual([]);
  });

  it('returns single chunk when size >= array length', () => {
    expect(utils.chunk([1, 2], 5)).toEqual([[1, 2]]);
  });

  it('handles size of 1', () => {
    expect(utils.chunk([1, 2, 3], 1)).toEqual([[1], [2], [3]]);
  });
});

describe('snapTsNow()', () => {
  it('rounds down to the nearest slot boundary', () => {
    const slotMs = 5 * 60_000; // 5-min slots
    const result = utils.snapTsNow(slotMs);
    expect(result.getTime() % slotMs).toBe(0);
    expect(result.getTime()).toBeLessThanOrEqual(Date.now());
  });
});

describe('startOfLocalDay()', () => {
  it('returns a Date at or before the input', () => {
    const now = new Date();
    const dayStart = utils.startOfLocalDay(now);
    expect(dayStart.getTime()).toBeLessThanOrEqual(now.getTime());
  });

  it('returns start of day within 24 hours of input', () => {
    const now = new Date();
    const dayStart = utils.startOfLocalDay(now);
    const diff = now.getTime() - dayStart.getTime();
    expect(diff).toBeGreaterThanOrEqual(0);
    expect(diff).toBeLessThan(24 * 3_600_000);
  });

  it('same day input returns same start', () => {
    const d1 = new Date('2025-06-15T05:00:00Z'); // noon in Bangkok
    const d2 = new Date('2025-06-15T10:00:00Z'); // 5pm in Bangkok
    expect(utils.startOfLocalDay(d1).getTime()).toBe(utils.startOfLocalDay(d2).getTime());
  });
});

describe('parseNum()', () => {
  it('parses valid numbers', () => {
    expect(utils.parseNum(42)).toBe(42);
    expect(utils.parseNum('3.14')).toBe(3.14);
    expect(utils.parseNum(0)).toBe(0);
  });

  it('returns null for invalid values', () => {
    expect(utils.parseNum(null)).toBeNull();
    expect(utils.parseNum(undefined)).toBeNull();
    expect(utils.parseNum('')).toBeNull();
    expect(utils.parseNum('abc')).toBeNull();
    expect(utils.parseNum(Infinity)).toBeNull();
    expect(utils.parseNum(NaN)).toBeNull();
  });
});

describe('parseDate()', () => {
  it('parses valid ISO date string', () => {
    const d = utils.parseDate('2025-01-15T12:00:00Z');
    expect(d).toBeInstanceOf(Date);
    expect(d!.toISOString()).toBe('2025-01-15T12:00:00.000Z');
  });

  it('returns null for invalid values', () => {
    expect(utils.parseDate(null)).toBeNull();
    expect(utils.parseDate(undefined)).toBeNull();
    expect(utils.parseDate('')).toBeNull();
    expect(utils.parseDate('not-a-date')).toBeNull();
  });
});

describe('deriveStringStatus()', () => {
  it('returns Disconnected when both null', () => {
    expect(utils.deriveStringStatus(null, null)).toBe('Disconnected');
  });

  it('returns Normal for typical values', () => {
    expect(utils.deriveStringStatus(300, 5)).toBe('Normal');
  });

  it('returns Lost when voltage > 50 and current < 0.05', () => {
    expect(utils.deriveStringStatus(100, 0.01)).toBe('Lost');
  });

  it('returns Normal at boundary (voltage=50, current=0)', () => {
    expect(utils.deriveStringStatus(50, 0)).toBe('Normal');
  });

  it('returns Normal when only voltage is null', () => {
    expect(utils.deriveStringStatus(null, 5)).toBe('Normal');
  });

  it('returns Lost when only current is null (high voltage)', () => {
    expect(utils.deriveStringStatus(100, null)).toBe('Lost');
  });
});

describe('deriveInverterStatus()', () => {
  it('returns Disconnected for null/undefined', () => {
    expect(utils.deriveInverterStatus(null)).toBe('Disconnected');
    expect(utils.deriveInverterStatus(undefined)).toBe('Disconnected');
  });

  it('returns Fault for known fault states', () => {
    expect(utils.deriveInverterStatus(3)).toBe('Fault');
    expect(utils.deriveInverterStatus(5)).toBe('Fault');
    expect(utils.deriveInverterStatus(10)).toBe('Fault');
  });

  it('returns Normal for non-fault states', () => {
    expect(utils.deriveInverterStatus(0)).toBe('Normal');
    expect(utils.deriveInverterStatus(1)).toBe('Normal');
    expect(utils.deriveInverterStatus(2)).toBe('Normal');
  });
});

describe('enqueueRetry / retryQueue', () => {
  beforeEach(() => {
    utils.retryQueue.clear();
  });

  it('adds station codes to the queue', () => {
    utils.enqueueRetry('ST001');
    utils.enqueueRetry('ST002');
    expect(utils.retryQueue.size).toBe(2);
    expect(utils.retryQueue.has('ST001')).toBe(true);
  });

  it('moves duplicate to end (preserves insertion order)', () => {
    utils.enqueueRetry('ST001');
    utils.enqueueRetry('ST002');
    utils.enqueueRetry('ST001'); // re-add
    const entries = Array.from(utils.retryQueue);
    expect(entries).toEqual(['ST002', 'ST001']);
  });

  it('evicts oldest when exceeding max', () => {
    // RETRY_QUEUE_MAX defaults to 500, but we can test eviction by filling
    // For this test we rely on the bounded behavior
    for (let i = 0; i < 510; i++) {
      utils.enqueueRetry(`ST${String(i).padStart(4, '0')}`);
    }
    expect(utils.retryQueue.size).toBeLessThanOrEqual(500);
    expect(utils.retryQueue.has('ST0000')).toBe(false); // oldest evicted
    expect(utils.retryQueue.has('ST0509')).toBe(true);  // newest kept
  });
});

describe('normalizeOnDemandOptions()', () => {
  it('defaults all to true/false', () => {
    const result = utils.normalizeOnDemandOptions();
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
    const result = utils.normalizeOnDemandOptions({ forceSiteRealtime: true, includeDeviceDetail: false });
    expect(result.forceSiteRealtime).toBe(true);
    expect(result.includeDeviceDetail).toBe(false);
  });
});

describe('makeOnDemandInflightKey()', () => {
  it('produces deterministic keys', () => {
    const k1 = utils.makeOnDemandInflightKey('PLANT1');
    const k2 = utils.makeOnDemandInflightKey('PLANT1');
    expect(k1).toBe(k2);
  });

  it('different options produce different keys', () => {
    const k1 = utils.makeOnDemandInflightKey('PLANT1', { forceSiteRealtime: true });
    const k2 = utils.makeOnDemandInflightKey('PLANT1', { forceSiteRealtime: false });
    expect(k1).not.toBe(k2);
  });
});

describe('pickStationCode()', () => {
  it('extracts plantCode first', () => {
    expect(utils.pickStationCode({ plantCode: 'PC1', stationCode: 'SC1' })).toBe('PC1');
  });

  it('falls back to stationCode', () => {
    expect(utils.pickStationCode({ stationCode: 'SC1' })).toBe('SC1');
  });

  it('returns null for empty/null input', () => {
    expect(utils.pickStationCode(null)).toBeNull();
    expect(utils.pickStationCode({})).toBeNull();
  });
});

describe('normalizeDeviceTarget()', () => {
  it('normalizes valid device', () => {
    const result = utils.normalizeDeviceTarget({
      id: 123,
      devTypeId: 1,
      esnCode: 'ESN001',
      devName: 'INV-01',
      model: 'SUN2000',
      invType: null,
      softwareVersion: 'v1.0',
    } as any);
    expect(result).toEqual({
      devId: '123',
      devTypeId: 1,
      serialNumber: 'ESN001',
      devName: 'INV-01',
      model: 'SUN2000',
      softwareVersion: 'v1.0',
    });
  });

  it('returns null for missing id', () => {
    expect(utils.normalizeDeviceTarget({ devTypeId: 1 } as any)).toBeNull();
  });

  it('returns null for invalid devTypeId', () => {
    expect(utils.normalizeDeviceTarget({ id: 1, devTypeId: 'abc' } as any)).toBeNull();
  });

  it('falls back serialNumber to DEV-{id}', () => {
    const result = utils.normalizeDeviceTarget({ id: 99, devTypeId: 1 } as any);
    expect(result!.serialNumber).toBe('DEV-99');
  });

  it('falls back model to invType then UNKNOWN', () => {
    const r1 = utils.normalizeDeviceTarget({ id: 1, devTypeId: 1, invType: 'TYPE1' } as any);
    expect(r1!.model).toBe('TYPE1');

    const r2 = utils.normalizeDeviceTarget({ id: 1, devTypeId: 1 } as any);
    expect(r2!.model).toBe('UNKNOWN');
  });
});
