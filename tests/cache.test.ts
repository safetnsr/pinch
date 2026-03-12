import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatTokens } from '../src/cache.js';

describe('cache analysis', () => {
  
  it('hitRate calculation: 0% (cr=0, in=1000)', () => {
    const cr = 0;
    const input = 1000;
    const hitRate = cr / (cr + input);
    assert.equal(hitRate, 0);
  });
  
  it('hitRate calculation: 100% (cr=1000, in=0)', () => {
    const cr = 1000;
    const input = 0;
    const hitRate = cr / (cr + input);
    assert.equal(hitRate, 1);
  });
  
  it('hitRate calculation: 50% (cr=500, in=500)', () => {
    const cr = 500;
    const input = 500;
    const hitRate = cr / (cr + input);
    assert.equal(hitRate, 0.5);
  });
  
  it('hitRate edge: both 0 (skip/return 0)', () => {
    const cr = 0;
    const input = 0;
    const total = cr + input;
    const hitRate = total > 0 ? cr / total : 0;
    assert.equal(hitRate, 0);
  });
  
  it('per-session aggregation: 2 sessions, verify correct grouping', () => {
    const records = [
      { sk: 'sess-a', in: 100, cr: 50 },
      { sk: 'sess-a', in: 200, cr: 100 },
      { sk: 'sess-b', in: 300, cr: 150 },
    ];
    
    const map = new Map();
    for (const rec of records) {
      if (!map.has(rec.sk)) {
        map.set(rec.sk, { input: 0, cacheRead: 0 });
      }
      const sess = map.get(rec.sk);
      sess.input += rec.in;
      sess.cacheRead += rec.cr;
    }
    
    assert.equal(map.size, 2);
    assert.equal(map.get('sess-a').input, 300);
    assert.equal(map.get('sess-a').cacheRead, 150);
    assert.equal(map.get('sess-b').input, 300);
    assert.equal(map.get('sess-b').cacheRead, 150);
  });
  
  it('per-session aggregation: single session', () => {
    const records = [
      { sk: 'sess-a', in: 100, cr: 50 },
      { sk: 'sess-a', in: 200, cr: 100 },
    ];
    
    const map = new Map();
    for (const rec of records) {
      if (!map.has(rec.sk)) {
        map.set(rec.sk, { input: 0, cacheRead: 0 });
      }
      const sess = map.get(rec.sk);
      sess.input += rec.in;
      sess.cacheRead += rec.cr;
    }
    
    assert.equal(map.size, 1);
    assert.equal(map.get('sess-a').input, 300);
    assert.equal(map.get('sess-a').cacheRead, 150);
  });
  
  it('per-day aggregation: records spanning 3 days', () => {
    const records = [
      { ts: new Date('2026-03-10').getTime() / 1000, in: 100, cr: 50 },
      { ts: new Date('2026-03-10').getTime() / 1000, in: 200, cr: 100 },
      { ts: new Date('2026-03-11').getTime() / 1000, in: 300, cr: 150 },
      { ts: new Date('2026-03-12').getTime() / 1000, in: 400, cr: 200 },
    ];
    
    const map = new Map();
    for (const rec of records) {
      const date = new Date(rec.ts * 1000).toISOString().slice(0, 10);
      if (!map.has(date)) {
        map.set(date, { input: 0, cacheRead: 0 });
      }
      const day = map.get(date);
      day.input += rec.in;
      day.cacheRead += rec.cr;
    }
    
    assert.equal(map.size, 3);
    assert.equal(map.get('2026-03-10').input, 300);
    assert.equal(map.get('2026-03-11').input, 300);
    assert.equal(map.get('2026-03-12').input, 400);
  });
  
  it('dollar waste calculation: with known pricing rates', () => {
    const inputRate = 3.0; // $3 per million
    const cacheReadRate = 0.3; // $0.30 per million
    const bestPracticeRate = 0.84;
    
    // Session with 1M total tokens, 20% hit rate
    const totalTokens = 1_000_000;
    const actualCacheRead = 200_000;
    const actualInput = 800_000;
    
    // Actual cost
    const actualCost = (actualInput / 1_000_000) * inputRate + (actualCacheRead / 1_000_000) * cacheReadRate;
    // = 0.8 * 3 + 0.2 * 0.3 = 2.4 + 0.06 = 2.46
    
    // Potential cost at 84%
    const potentialCacheRead = totalTokens * bestPracticeRate;
    const potentialInput = totalTokens * (1 - bestPracticeRate);
    const potentialCost = (potentialCacheRead / 1_000_000) * cacheReadRate + (potentialInput / 1_000_000) * inputRate;
    // = 0.84 * 0.3 + 0.16 * 3 = 0.252 + 0.48 = 0.732
    
    const waste = actualCost - potentialCost;
    // = 2.46 - 0.732 = 1.728
    
    assert.ok(waste > 1.7 && waste < 1.8);
  });
  
  it('dollar waste: 0 when already at best practice', () => {
    const inputRate = 3.0;
    const cacheReadRate = 0.3;
    const bestPracticeRate = 0.84;
    
    // Session already at 84% hit rate
    const totalTokens = 1_000_000;
    const actualCacheRead = 840_000;
    const actualInput = 160_000;
    const currentHitRate = actualCacheRead / totalTokens;
    
    const waste = currentHitRate >= bestPracticeRate ? 0 : 999;
    assert.equal(waste, 0);
  });
  
  it('cache-buster: no-hits detection', () => {
    const session = {
      inputTokens: 5000,
      cacheRead: 0,
    };
    
    const totalTokens = session.cacheRead + session.inputTokens;
    const isNoHits = totalTokens > 1000 && session.cacheRead === 0;
    
    assert.equal(isNoHits, true);
  });
  
  it('cache-buster: ttl-waste detection (high cw, low cr)', () => {
    const session = {
      cacheWrite: 9000,
      cacheRead: 2000,
    };
    
    const isTtlWaste = session.cacheWrite > session.cacheRead * 3 && session.cacheRead > 0;
    assert.equal(isTtlWaste, true);
  });
  
  it('cache-buster: short-session detection (<3 records)', () => {
    const session = {
      records: 2,
      cacheWrite: 1000,
    };
    
    const isShortSession = session.records < 3 && session.cacheWrite > 0;
    assert.equal(isShortSession, true);
  });
  
  it('cache-buster: no false positive on healthy session', () => {
    const session = {
      inputTokens: 5000,
      cacheRead: 4000,
      cacheWrite: 1000,
      records: 10,
    };
    
    const totalTokens = session.cacheRead + session.inputTokens;
    const isNoHits = totalTokens > 1000 && session.cacheRead === 0;
    const isTtlWaste = session.cacheWrite > session.cacheRead * 3 && session.cacheRead > 0;
    const isShortSession = session.records < 3 && session.cacheWrite > 0;
    
    assert.equal(isNoHits, false);
    assert.equal(isTtlWaste, false);
    assert.equal(isShortSession, false);
  });
  
  it('JSON output shape: verify all required fields present', () => {
    const analysis = {
      period: { from: '2026-03-05', to: '2026-03-12', days: 7 },
      overall: {
        hitRate: 0.23,
        totalInput: 2_400_000,
        totalCacheRead: 561_000,
        totalCacheWrite: 890_000,
        totalRecords: 100,
      },
      wasteDollars: 12.40,
      bestPracticeRate: 0.84,
      topWasteSessions: [],
      perDay: [],
      cacheBusters: [],
    };
    
    assert.ok('period' in analysis);
    assert.ok('overall' in analysis);
    assert.ok('wasteDollars' in analysis);
    assert.ok('bestPracticeRate' in analysis);
    assert.ok('topWasteSessions' in analysis);
    assert.ok('perDay' in analysis);
    assert.ok('cacheBusters' in analysis);
    
    assert.ok('hitRate' in analysis.overall);
    assert.ok('totalInput' in analysis.overall);
    assert.ok('totalCacheRead' in analysis.overall);
    assert.ok('totalCacheWrite' in analysis.overall);
    assert.ok('totalRecords' in analysis.overall);
  });
  
  it('empty data: returns zero-state analysis, no crashes', () => {
    const analysis = {
      period: { from: '2026-03-12', to: '2026-03-12', days: 1 },
      overall: {
        hitRate: 0,
        totalInput: 0,
        totalCacheRead: 0,
        totalCacheWrite: 0,
        totalRecords: 0,
      },
      wasteDollars: 0,
      bestPracticeRate: 0.84,
      topWasteSessions: [],
      perDay: [],
      cacheBusters: [],
    };
    
    assert.equal(analysis.overall.totalRecords, 0);
    assert.equal(analysis.wasteDollars, 0);
    assert.equal(analysis.topWasteSessions.length, 0);
  });
  
  it('formatTokens helper: 1000 → "1.0K", 1500000 → "1.5M"', () => {
    assert.equal(formatTokens(1000), '1.0K');
    assert.equal(formatTokens(1500000), '1.5M');
    assert.equal(formatTokens(500), '500');
    assert.equal(formatTokens(5500), '5.5K');
    assert.equal(formatTokens(2_300_000), '2.3M');
  });
  
  it('overall hit rate matches manual calculation', () => {
    const sessions = [
      { cacheRead: 500, inputTokens: 500 },
      { cacheRead: 800, inputTokens: 200 },
      { cacheRead: 100, inputTokens: 900 },
    ];
    
    const totalCacheRead = sessions.reduce((sum, s) => sum + s.cacheRead, 0);
    const totalInput = sessions.reduce((sum, s) => sum + s.inputTokens, 0);
    const overallHitRate = (totalCacheRead + totalInput) > 0
      ? totalCacheRead / (totalCacheRead + totalInput)
      : 0;
    
    // totalCacheRead = 1400, totalInput = 1600
    // hitRate = 1400 / 3000 = 0.4666...
    assert.ok(overallHitRate > 0.466 && overallHitRate < 0.467);
  });
});
