import { existsSync, mkdirSync, appendFileSync, readFileSync, writeFileSync, readdirSync, unlinkSync, renameSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { CostRecord, DailyAggregate, TodayTotals } from './types.js';

const DATA_DIR = join(homedir(), '.openclaw', 'data', 'pinch');
const RECORDS_DIR = join(DATA_DIR, 'records');
const DAILY_DIR = join(DATA_DIR, 'aggregates', 'daily');
const WEEKLY_DIR = join(DATA_DIR, 'aggregates', 'weekly');
const MONTHLY_DIR = join(DATA_DIR, 'aggregates', 'monthly');
const STATE_FILE = join(DATA_DIR, 'state.json');

// In-memory state
let currentDate = '';
let todayRecords: CostRecord[] = [];
let todayTotals: TodayTotals = emptyTotals();

function emptyTotals(): TodayTotals {
  return { cost: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, records: 0, byModel: {}, byType: {} };
}

function getDateStr(ts?: number): string {
  const d = ts ? new Date(ts * 1000) : new Date();
  return d.toISOString().slice(0, 10);
}

function ensureDirs() {
  for (const dir of [RECORDS_DIR, DAILY_DIR, WEEKLY_DIR, MONTHLY_DIR]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
}

/**
 * Initialize store — load today's records into memory
 */
export function initStore(): void {
  ensureDirs();
  currentDate = getDateStr();
  loadTodayRecords();
  loadState();
}

function loadTodayRecords(): void {
  const file = join(RECORDS_DIR, `${currentDate}.jsonl`);
  todayRecords = [];
  todayTotals = emptyTotals();
  
  if (existsSync(file)) {
    const lines = readFileSync(file, 'utf-8').split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const record = JSON.parse(line) as CostRecord;
        todayRecords.push(record);
        addToTotals(record);
      } catch {
        // Skip corrupted lines
      }
    }
  }
}

function addToTotals(record: CostRecord): void {
  todayTotals.cost += record.c;
  todayTotals.inputTokens += record.in;
  todayTotals.outputTokens += record.out;
  todayTotals.cacheReadTokens += record.cr;
  todayTotals.cacheWriteTokens += record.cw;
  todayTotals.records++;
  
  // By model
  if (!todayTotals.byModel[record.m]) {
    todayTotals.byModel[record.m] = { cost: 0, records: 0 };
  }
  todayTotals.byModel[record.m].cost += record.c;
  todayTotals.byModel[record.m].records++;
  
  // By type
  if (!todayTotals.byType[record.tt]) {
    todayTotals.byType[record.tt] = { cost: 0, records: 0 };
  }
  todayTotals.byType[record.tt].cost += record.c;
  todayTotals.byType[record.tt].records++;
}

/**
 * Write a cost record. Handles day rollover.
 */
export function writeRecord(record: CostRecord): void {
  const today = getDateStr();
  
  // Day rollover
  if (today !== currentDate) {
    rollDay(currentDate);
    currentDate = today;
    todayRecords = [];
    todayTotals = emptyTotals();
  }
  
  const file = join(RECORDS_DIR, `${today}.jsonl`);
  appendFileSync(file, JSON.stringify(record) + '\n');
  todayRecords.push(record);
  addToTotals(record);
  saveState();
}

/**
 * Roll a day into a daily aggregate
 */
function rollDay(date: string): void {
  const file = join(RECORDS_DIR, `${date}.jsonl`);
  if (!existsSync(file)) return;
  
  const records = readRecordFile(file);
  if (records.length === 0) return;
  
  const agg = aggregateRecords(records, date);
  const aggFile = join(DAILY_DIR, `${date}.json`);
  writeJsonAtomic(aggFile, agg);
}

function readRecordFile(file: string): CostRecord[] {
  const records: CostRecord[] = [];
  const lines = readFileSync(file, 'utf-8').split('\n').filter(Boolean);
  for (const line of lines) {
    try { records.push(JSON.parse(line)); } catch { /* skip */ }
  }
  return records;
}

function aggregateRecords(records: CostRecord[], date: string): DailyAggregate {
  const agg: DailyAggregate = {
    date,
    cost: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    records: records.length,
    byModel: {},
    byType: {},
    topSessions: [],
    pricingVersion: records[0]?.pv ?? 0,
  };
  
  const bySk: Record<string, number> = {};
  
  for (const r of records) {
    agg.cost += r.c;
    agg.inputTokens += r.in;
    agg.outputTokens += r.out;
    agg.cacheReadTokens += r.cr;
    agg.cacheWriteTokens += r.cw;
    
    if (!agg.byModel[r.m]) agg.byModel[r.m] = { cost: 0, records: 0 };
    agg.byModel[r.m].cost += r.c;
    agg.byModel[r.m].records++;
    
    if (!agg.byType[r.tt]) agg.byType[r.tt] = { cost: 0, records: 0 };
    agg.byType[r.tt].cost += r.c;
    agg.byType[r.tt].records++;
    
    bySk[r.sk] = (bySk[r.sk] || 0) + r.c;
  }
  
  agg.topSessions = Object.entries(bySk)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([key, cost]) => ({ key, cost }));
  
  return agg;
}

// --- Query functions ---

export function getTodayTotals(): TodayTotals & { date: string } {
  // Check for day rollover
  const today = getDateStr();
  if (today !== currentDate) {
    rollDay(currentDate);
    currentDate = today;
    todayRecords = [];
    todayTotals = emptyTotals();
    loadTodayRecords();
  }
  return { ...todayTotals, date: currentDate };
}

export function getWeekTotals(): TodayTotals & { from: string; to: string } {
  const now = new Date();
  const dayOfWeek = now.getUTCDay(); // 0=Sun
  const start = new Date(now);
  start.setUTCDate(now.getUTCDate() - ((dayOfWeek + 6) % 7)); // Monday
  start.setUTCHours(0, 0, 0, 0);
  
  return sumRange(start, now);
}

export function getMonthTotals(): TodayTotals & { from: string; to: string } {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return sumRange(start, now);
}

function sumRange(from: Date, to: Date): TodayTotals & { from: string; to: string } {
  const result = emptyTotals();
  const fromStr = from.toISOString().slice(0, 10);
  const toStr = to.toISOString().slice(0, 10);
  
  const d = new Date(from);
  while (d <= to) {
    const ds = d.toISOString().slice(0, 10);
    
    if (ds === currentDate) {
      // Use in-memory totals for today
      mergeTotals(result, todayTotals);
    } else {
      // Try daily aggregate
      const aggFile = join(DAILY_DIR, `${ds}.json`);
      if (existsSync(aggFile)) {
        try {
          const agg = JSON.parse(readFileSync(aggFile, 'utf-8')) as DailyAggregate;
          result.cost += agg.cost;
          result.inputTokens += agg.inputTokens;
          result.outputTokens += agg.outputTokens;
          result.cacheReadTokens += agg.cacheReadTokens;
          result.cacheWriteTokens += agg.cacheWriteTokens;
          result.records += agg.records;
          for (const [k, v] of Object.entries(agg.byModel)) {
            if (!result.byModel[k]) result.byModel[k] = { cost: 0, records: 0 };
            result.byModel[k].cost += v.cost;
            result.byModel[k].records += v.records;
          }
          for (const [k, v] of Object.entries(agg.byType)) {
            if (!result.byType[k]) result.byType[k] = { cost: 0, records: 0 };
            result.byType[k].cost += v.cost;
            result.byType[k].records += v.records;
          }
        } catch { /* skip */ }
      } else {
        // Fall back to raw records
        const recFile = join(RECORDS_DIR, `${ds}.jsonl`);
        if (existsSync(recFile)) {
          const recs = readRecordFile(recFile);
          for (const r of recs) {
            const t = emptyTotals();
            addToTotalsStatic(t, r);
            mergeTotals(result, t);
          }
        }
      }
    }
    
    d.setUTCDate(d.getUTCDate() + 1);
  }
  
  return { ...result, from: fromStr, to: toStr };
}

function addToTotalsStatic(totals: TodayTotals, record: CostRecord): void {
  totals.cost += record.c;
  totals.inputTokens += record.in;
  totals.outputTokens += record.out;
  totals.cacheReadTokens += record.cr;
  totals.cacheWriteTokens += record.cw;
  totals.records++;
  if (!totals.byModel[record.m]) totals.byModel[record.m] = { cost: 0, records: 0 };
  totals.byModel[record.m].cost += record.c;
  totals.byModel[record.m].records++;
  if (!totals.byType[record.tt]) totals.byType[record.tt] = { cost: 0, records: 0 };
  totals.byType[record.tt].cost += record.c;
  totals.byType[record.tt].records++;
}

function mergeTotals(target: TodayTotals, source: TodayTotals): void {
  target.cost += source.cost;
  target.inputTokens += source.inputTokens;
  target.outputTokens += source.outputTokens;
  target.cacheReadTokens += source.cacheReadTokens;
  target.cacheWriteTokens += source.cacheWriteTokens;
  target.records += source.records;
  for (const [k, v] of Object.entries(source.byModel)) {
    if (!target.byModel[k]) target.byModel[k] = { cost: 0, records: 0 };
    target.byModel[k].cost += v.cost;
    target.byModel[k].records += v.records;
  }
  for (const [k, v] of Object.entries(source.byType)) {
    if (!target.byType[k]) target.byType[k] = { cost: 0, records: 0 };
    target.byType[k].cost += v.cost;
    target.byType[k].records += v.records;
  }
}

export function getTrend(days: number): { date: string; cost: number; records: number }[] {
  const result: { date: string; cost: number; records: number }[] = [];
  const now = new Date();
  
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setUTCDate(now.getUTCDate() - i);
    const ds = d.toISOString().slice(0, 10);
    
    if (ds === currentDate) {
      result.push({ date: ds, cost: todayTotals.cost, records: todayTotals.records });
    } else {
      const aggFile = join(DAILY_DIR, `${ds}.json`);
      if (existsSync(aggFile)) {
        try {
          const agg = JSON.parse(readFileSync(aggFile, 'utf-8'));
          result.push({ date: ds, cost: agg.cost, records: agg.records });
        } catch {
          result.push({ date: ds, cost: 0, records: 0 });
        }
      } else {
        // Try raw file
        const recFile = join(RECORDS_DIR, `${ds}.jsonl`);
        if (existsSync(recFile)) {
          const recs = readRecordFile(recFile);
          const cost = recs.reduce((s, r) => s + r.c, 0);
          result.push({ date: ds, cost, records: recs.length });
        } else {
          result.push({ date: ds, cost: 0, records: 0 });
        }
      }
    }
  }
  
  return result;
}

export function getLatest(limit: number = 10): CostRecord[] {
  // Return latest from today's in-memory records
  return todayRecords.slice(-limit).reverse();
}

export function getBreakdown(by: 'model' | 'type' | 'session'): Record<string, { cost: number; records: number }> {
  if (by === 'model') return { ...todayTotals.byModel };
  if (by === 'type') return { ...todayTotals.byType };
  
  // By session
  const result: Record<string, { cost: number; records: number }> = {};
  for (const r of todayRecords) {
    if (!result[r.sk]) result[r.sk] = { cost: 0, records: 0 };
    result[r.sk].cost += r.c;
    result[r.sk].records++;
  }
  return result;
}

export function getTodayRecords(): CostRecord[] {
  return [...todayRecords];
}

// --- Retention cleanup ---

export function cleanupRetention(retentionDays: number): number {
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - retentionDays);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  let deleted = 0;
  
  try {
    const files = readdirSync(RECORDS_DIR).filter(f => f.endsWith('.jsonl'));
    for (const file of files) {
      const date = file.replace('.jsonl', '');
      if (date < cutoffStr) {
        unlinkSync(join(RECORDS_DIR, file));
        deleted++;
      }
    }
  } catch { /* ignore */ }
  
  return deleted;
}

// --- State persistence ---

function saveState(): void {
  const state = {
    date: currentDate,
    totals: todayTotals,
    savedAt: Date.now(),
  };
  writeJsonAtomic(STATE_FILE, state);
}

function loadState(): void {
  if (!existsSync(STATE_FILE)) return;
  try {
    const state = JSON.parse(readFileSync(STATE_FILE, 'utf-8'));
    if (state.date === currentDate && todayRecords.length === 0) {
      // Restore from state if no records loaded yet
      todayTotals = state.totals;
    }
  } catch { /* ignore */ }
}

function writeJsonAtomic(path: string, data: any): void {
  const tmp = path + '.tmp';
  writeFileSync(tmp, JSON.stringify(data));
  renameSync(tmp, path);
}
