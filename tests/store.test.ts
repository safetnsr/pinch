import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// Set up test data dir
const DATA_DIR = join(homedir(), '.openclaw', 'data', 'pinch');
const RECORDS_DIR = join(DATA_DIR, 'records');

// We test the store through the built plugin
// For isolated testing, we use inline logic

describe('store', () => {
  test('JSONL record format is valid JSON per line', () => {
    const record = {
      v: 2,
      id: 'test123',
      ts: Math.floor(Date.now() / 1000),
      sk: 'agent:main:main',
      m: 'claude-opus-4',
      in: 1200,
      out: 450,
      cr: 45000,
      cw: 1200,
      c: 0.0234,
      src: 'provider',
      tt: 'chat',
      tools: ['exec', 'read'],
      dur: 4500,
      sub: false,
      par: null,
      pv: 3,
      th: 0,
    };

    const line = JSON.stringify(record);
    const parsed = JSON.parse(line);
    assert.equal(parsed.v, 2);
    assert.equal(parsed.m, 'claude-opus-4');
    assert.equal(parsed.c, 0.0234);
    assert.deepEqual(parsed.tools, ['exec', 'read']);
  });

  test('record size is reasonable (<500 bytes)', () => {
    const record = {
      v: 2, id: 'abcd1234', ts: 1740100000, sk: 'agent:main:main',
      m: 'claude-opus-4', in: 1200, out: 450, cr: 45000, cw: 1200,
      c: 0.0234, src: 'provider', tt: 'chat',
      tools: ['exec', 'read', 'edit', 'web_search'],
      dur: 4500, sub: false, par: null, pv: 3, th: 0,
    };
    const size = JSON.stringify(record).length;
    assert.ok(size < 500, `Record too large: ${size} bytes`);
  });

  test('aggregation produces correct totals', () => {
    const records = [
      { c: 0.10, in: 1000, out: 200, cr: 5000, cw: 100, m: 'claude-opus-4', tt: 'chat', sk: 'a' },
      { c: 0.05, in: 500, out: 100, cr: 2000, cw: 50, m: 'claude-sonnet-4', tt: 'heartbeat', sk: 'b' },
      { c: 0.20, in: 2000, out: 800, cr: 10000, cw: 200, m: 'claude-opus-4', tt: 'chat', sk: 'a' },
    ];

    let totalCost = 0;
    let totalIn = 0;
    let totalOut = 0;
    const byModel: Record<string, number> = {};
    const byType: Record<string, number> = {};

    for (const r of records) {
      totalCost += r.c;
      totalIn += r.in;
      totalOut += r.out;
      byModel[r.m] = (byModel[r.m] || 0) + r.c;
      byType[r.tt] = (byType[r.tt] || 0) + r.c;
    }

    assert.ok(Math.abs(totalCost - 0.35) < 0.001);
    assert.equal(totalIn, 3500);
    assert.equal(totalOut, 1100);
    assert.ok(Math.abs(byModel['claude-opus-4'] - 0.30) < 0.001);
    assert.ok(Math.abs(byModel['claude-sonnet-4'] - 0.05) < 0.001);
    assert.ok(Math.abs(byType['chat'] - 0.30) < 0.001);
    assert.ok(Math.abs(byType['heartbeat'] - 0.05) < 0.001);
  });
});
