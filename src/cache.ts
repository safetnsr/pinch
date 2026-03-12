import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { CostRecord } from './types.js';
import { getPricingData } from './pricing.js';
import { normalizeModelName } from './normalize.js';

const RECORDS_DIR = join(homedir(), '.openclaw', 'data', 'pinch', 'records');
const BEST_PRACTICE_HIT_RATE = 0.84;

export interface CacheSession {
  sk: string;
  hitRate: number;
  inputTokens: number;
  cacheRead: number;
  cacheWrite: number;
  wasteDollars: number;
  records: number;
}

export interface CacheDay {
  date: string;
  hitRate: number;
  inputTokens: number;
  cacheRead: number;
}

export interface CacheBuster {
  type: 'no-hits' | 'ttl-waste' | 'short-session';
  detail: string;
  sessionKey: string;
}

export interface CacheAnalysis {
  period: { from: string; to: string; days: number };
  overall: {
    hitRate: number;
    totalInput: number;
    totalCacheRead: number;
    totalCacheWrite: number;
    totalRecords: number;
  };
  wasteDollars: number;
  bestPracticeRate: number;
  topWasteSessions: CacheSession[];
  perDay: CacheDay[];
  cacheBusters: CacheBuster[];
}

interface SessionData {
  sk: string;
  inputTokens: number;
  cacheRead: number;
  cacheWrite: number;
  records: number;
  modelCosts: Map<string, { input: number; cacheRead: number; cacheWrite: number }>;
}

interface DayData {
  inputTokens: number;
  cacheRead: number;
}

/**
 * Analyze cache hit rates from the last N days of cost records
 */
export function analyzeCacheRates(days: number): CacheAnalysis {
  const pricing = getPricingData();
  const now = new Date();
  const fromDate = new Date(now);
  fromDate.setUTCDate(now.getUTCDate() - days + 1);
  fromDate.setUTCHours(0, 0, 0, 0);
  
  const from = fromDate.toISOString().slice(0, 10);
  const to = now.toISOString().slice(0, 10);
  
  // Collect all records for the period
  const records = readRecordsForPeriod(fromDate, now);
  
  if (records.length === 0) {
    return emptyAnalysis(from, to, days);
  }
  
  // Aggregate by session
  const sessionMap = new Map<string, SessionData>();
  const dayMap = new Map<string, DayData>();
  
  for (const rec of records) {
    // Session aggregation
    if (!sessionMap.has(rec.sk)) {
      sessionMap.set(rec.sk, {
        sk: rec.sk,
        inputTokens: 0,
        cacheRead: 0,
        cacheWrite: 0,
        records: 0,
        modelCosts: new Map(),
      });
    }
    const sess = sessionMap.get(rec.sk)!;
    sess.inputTokens += rec.in;
    sess.cacheRead += rec.cr;
    sess.cacheWrite += rec.cw;
    sess.records++;
    
    // Track per-model usage for cost calculation
    const normalized = normalizeModelName(rec.m, pricing);
    if (!sess.modelCosts.has(normalized)) {
      sess.modelCosts.set(normalized, { input: 0, cacheRead: 0, cacheWrite: 0 });
    }
    const modelCost = sess.modelCosts.get(normalized)!;
    modelCost.input += rec.in;
    modelCost.cacheRead += rec.cr;
    modelCost.cacheWrite += rec.cw;
    
    // Day aggregation
    const dateStr = new Date(rec.ts * 1000).toISOString().slice(0, 10);
    if (!dayMap.has(dateStr)) {
      dayMap.set(dateStr, { inputTokens: 0, cacheRead: 0 });
    }
    const day = dayMap.get(dateStr)!;
    day.inputTokens += rec.in;
    day.cacheRead += rec.cr;
  }
  
  // Calculate session-level metrics
  const sessions: CacheSession[] = [];
  let totalWaste = 0;
  
  for (const sess of sessionMap.values()) {
    const totalTokens = sess.cacheRead + sess.inputTokens;
    const hitRate = totalTokens > 0 ? sess.cacheRead / totalTokens : 0;
    const wasteDollars = calculateWaste(sess, pricing);
    
    sessions.push({
      sk: sess.sk,
      hitRate,
      inputTokens: sess.inputTokens,
      cacheRead: sess.cacheRead,
      cacheWrite: sess.cacheWrite,
      wasteDollars,
      records: sess.records,
    });
    
    totalWaste += wasteDollars;
  }
  
  // Sort by waste descending, take top 10
  const topWasteSessions = sessions
    .sort((a, b) => b.wasteDollars - a.wasteDollars)
    .slice(0, 10);
  
  // Per-day metrics
  const perDay: CacheDay[] = [];
  for (const [date, day] of dayMap.entries()) {
    const totalTokens = day.cacheRead + day.inputTokens;
    const hitRate = totalTokens > 0 ? day.cacheRead / totalTokens : 0;
    perDay.push({
      date,
      hitRate,
      inputTokens: day.inputTokens,
      cacheRead: day.cacheRead,
    });
  }
  perDay.sort((a, b) => a.date.localeCompare(b.date));
  
  // Overall metrics
  const totalInput = sessions.reduce((sum, s) => sum + s.inputTokens, 0);
  const totalCacheRead = sessions.reduce((sum, s) => sum + s.cacheRead, 0);
  const totalCacheWrite = sessions.reduce((sum, s) => sum + s.cacheWrite, 0);
  const overallHitRate = totalInput + totalCacheRead > 0
    ? totalCacheRead / (totalInput + totalCacheRead)
    : 0;
  
  // Detect cache busters
  const cacheBusters = detectCacheBusters(sessions);
  
  return {
    period: { from, to, days },
    overall: {
      hitRate: overallHitRate,
      totalInput,
      totalCacheRead,
      totalCacheWrite,
      totalRecords: records.length,
    },
    wasteDollars: totalWaste,
    bestPracticeRate: BEST_PRACTICE_HIT_RATE,
    topWasteSessions,
    perDay,
    cacheBusters,
  };
}

/**
 * Calculate waste (dollars left on table if we achieved best practice 84% hit rate)
 */
function calculateWaste(sess: SessionData, pricing: any): number {
  const totalTokens = sess.cacheRead + sess.inputTokens;
  if (totalTokens === 0) return 0;
  
  const currentHitRate = sess.cacheRead / totalTokens;
  
  // If already at or above best practice, no waste
  if (currentHitRate >= BEST_PRACTICE_HIT_RATE) return 0;
  
  let actualCost = 0;
  let potentialCost = 0;
  
  // Calculate per-model
  for (const [model, usage] of sess.modelCosts.entries()) {
    const modelPricing = pricing.models[model];
    if (!modelPricing) continue;
    
    const inputRate = modelPricing.input || 0;
    const cacheReadRate = modelPricing.cacheRead || inputRate * 0.1;
    const cacheWriteRate = modelPricing.cacheWrite || inputRate * 1.25;
    
    const modelTotalTokens = usage.input + usage.cacheRead;
    
    // Actual cost
    actualCost += (usage.input / 1_000_000) * inputRate;
    actualCost += (usage.cacheRead / 1_000_000) * cacheReadRate;
    actualCost += (usage.cacheWrite / 1_000_000) * cacheWriteRate;
    
    // Potential cost at 84% hit rate
    const potentialCacheReads = modelTotalTokens * BEST_PRACTICE_HIT_RATE;
    const potentialRegularInput = modelTotalTokens * (1 - BEST_PRACTICE_HIT_RATE);
    potentialCost += (potentialCacheReads / 1_000_000) * cacheReadRate;
    potentialCost += (potentialRegularInput / 1_000_000) * inputRate;
    // Cache writes stay same in this simplified model
    potentialCost += (usage.cacheWrite / 1_000_000) * cacheWriteRate;
  }
  
  return Math.max(0, actualCost - potentialCost);
}

/**
 * Detect cache-killing patterns
 */
function detectCacheBusters(sessions: CacheSession[]): CacheBuster[] {
  const busters: CacheBuster[] = [];
  
  for (const sess of sessions) {
    const totalTokens = sess.cacheRead + sess.inputTokens;
    
    // No hits: > 1000 input tokens but 0 cache reads
    if (totalTokens > 1000 && sess.cacheRead === 0) {
      busters.push({
        type: 'no-hits',
        detail: `zero cache hits on ${formatTokens(totalTokens)} input tokens`,
        sessionKey: sess.sk,
      });
    }
    
    // TTL waste: writing 3x more to cache than reading
    if (sess.cacheWrite > sess.cacheRead * 3 && sess.cacheRead > 0) {
      busters.push({
        type: 'ttl-waste',
        detail: `writing ${formatTokens(sess.cacheWrite)} to cache, reading only ${formatTokens(sess.cacheRead)} — TTL expiring before reuse`,
        sessionKey: sess.sk,
      });
    }
    
    // Short session: < 3 records (too few API calls to benefit from cache)
    if (sess.records < 3 && sess.cacheWrite > 0) {
      busters.push({
        type: 'short-session',
        detail: `only ${sess.records} API ${sess.records === 1 ? 'call' : 'calls'} — session too short for cache TTL`,
        sessionKey: sess.sk,
      });
    }
  }
  
  return busters;
}

/**
 * Read all cost records for a date range
 */
function readRecordsForPeriod(from: Date, to: Date): CostRecord[] {
  const records: CostRecord[] = [];
  const d = new Date(from);
  
  while (d <= to) {
    const dateStr = d.toISOString().slice(0, 10);
    const file = join(RECORDS_DIR, `${dateStr}.jsonl`);
    
    if (existsSync(file)) {
      const lines = readFileSync(file, 'utf-8').split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const record = JSON.parse(line) as CostRecord;
          records.push(record);
        } catch {
          // Skip corrupted lines
        }
      }
    }
    
    d.setUTCDate(d.getUTCDate() + 1);
  }
  
  return records;
}

/**
 * Format token counts for display
 */
export function formatTokens(count: number): string {
  if (count >= 1_000_000) {
    return (count / 1_000_000).toFixed(1) + 'M';
  }
  if (count >= 1_000) {
    return (count / 1_000).toFixed(1) + 'K';
  }
  return count.toString();
}

function emptyAnalysis(from: string, to: string, days: number): CacheAnalysis {
  return {
    period: { from, to, days },
    overall: {
      hitRate: 0,
      totalInput: 0,
      totalCacheRead: 0,
      totalCacheWrite: 0,
      totalRecords: 0,
    },
    wasteDollars: 0,
    bestPracticeRate: BEST_PRACTICE_HIT_RATE,
    topWasteSessions: [],
    perDay: [],
    cacheBusters: [],
  };
}
