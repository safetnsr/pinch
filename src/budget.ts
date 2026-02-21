import { existsSync, readFileSync, writeFileSync, renameSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { getTodayTotals, getWeekTotals, getMonthTotals, getTodayRecords } from './store.js';
import type { BudgetConfig } from './types.js';

const STATE_FILE = join(homedir(), '.openclaw', 'data', 'pinch', 'budget-state.json');

interface BudgetState {
  alertsSent: Record<string, string[]>; // date -> thresholds already alerted
  lastCheck: number;
}

let state: BudgetState = { alertsSent: {}, lastCheck: 0 };
let budgetConfig: BudgetConfig = {};

export function initBudget(config?: BudgetConfig): void {
  budgetConfig = config || {};
  loadBudgetState();
}

function loadBudgetState(): void {
  try {
    if (existsSync(STATE_FILE)) {
      state = JSON.parse(readFileSync(STATE_FILE, 'utf-8'));
    }
  } catch { /* ignore */ }
}

function saveBudgetState(): void {
  const tmp = STATE_FILE + '.tmp';
  writeFileSync(tmp, JSON.stringify(state));
  renameSync(tmp, STATE_FILE);
}

/**
 * Check budgets and return alerts if thresholds are crossed.
 * Returns array of alert messages (empty if no alerts needed).
 */
export function checkBudgets(): string[] {
  const alerts: string[] = [];
  const today = new Date().toISOString().slice(0, 10);

  // Clean old alert state
  if (!state.alertsSent[today]) {
    state.alertsSent = { [today]: [] };
  }

  const sent = state.alertsSent[today];

  if (budgetConfig.daily) {
    const totals = getTodayTotals();
    const alert = checkThreshold('daily', totals.cost, budgetConfig.daily, sent);
    if (alert) alerts.push(alert);
  }

  if (budgetConfig.weekly) {
    const totals = getWeekTotals();
    const alert = checkThreshold('weekly', totals.cost, budgetConfig.weekly, sent);
    if (alert) alerts.push(alert);
  }

  if (budgetConfig.monthly) {
    const totals = getMonthTotals();
    const alert = checkThreshold('monthly', totals.cost, budgetConfig.monthly, sent);
    if (alert) alerts.push(alert);
  }

  if (alerts.length > 0) {
    saveBudgetState();
  }

  return alerts;
}

function checkThreshold(
  period: string,
  spent: number,
  budget: number,
  sent: string[],
): string | null {
  const pct = (spent / budget) * 100;
  const remaining = budget - spent;

  // Thresholds: 50%, 80%, 95%, 100%
  const thresholds = [100, 95, 80, 50];
  
  for (const threshold of thresholds) {
    if (pct >= threshold) {
      const key = `${period}-${threshold}`;
      if (sent.includes(key)) return null;
      
      sent.push(key);

      const periodLabel = period === 'daily' ? 'vandaag' : period === 'weekly' ? 'deze week' : 'deze maand';
      let msg = `pinch: $${spent.toFixed(2)} van $${budget.toFixed(2)} ${periodLabel} (${Math.round(pct)}%).`;
      
      if (remaining > 0) {
        msg += ` nog $${remaining.toFixed(2)} over.`;
      } else {
        msg += ` budget overschreden!`;
      }

      // At 80%+ include top cost items
      if (pct >= 80) {
        const records = getTodayRecords();
        const bySk: Record<string, number> = {};
        for (const r of records) {
          bySk[r.sk] = (bySk[r.sk] || 0) + r.c;
        }
        const topItems = Object.entries(bySk)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([sk, cost]) => {
            const label = sk.split(':').pop() || sk;
            return `${label} ($${cost.toFixed(2)})`;
          });
        if (topItems.length > 0) {
          msg += ` grote kosten: ${topItems.join(', ')}.`;
        }
      }

      return msg;
    }
  }

  return null;
}

/**
 * Get budget status for the agent tool
 */
export function getBudgetStatus(): {
  daily?: { budget: number; spent: number; remaining: number; pct: number };
  weekly?: { budget: number; spent: number; remaining: number; pct: number };
  monthly?: { budget: number; spent: number; remaining: number; pct: number };
  projections?: { dailyRate: number; projectedMonthly: number };
} {
  const result: any = {};

  if (budgetConfig.daily) {
    const t = getTodayTotals();
    result.daily = {
      budget: budgetConfig.daily,
      spent: t.cost,
      remaining: Math.max(0, budgetConfig.daily - t.cost),
      pct: Math.round((t.cost / budgetConfig.daily) * 100),
    };
  }

  if (budgetConfig.weekly) {
    const t = getWeekTotals();
    result.weekly = {
      budget: budgetConfig.weekly,
      spent: t.cost,
      remaining: Math.max(0, budgetConfig.weekly - t.cost),
      pct: Math.round((t.cost / budgetConfig.weekly) * 100),
    };
  }

  if (budgetConfig.monthly) {
    const t = getMonthTotals();
    result.monthly = {
      budget: budgetConfig.monthly,
      spent: t.cost,
      remaining: Math.max(0, budgetConfig.monthly - t.cost),
      pct: Math.round((t.cost / budgetConfig.monthly) * 100),
    };
  }

  // Projections based on today's rate
  const today = getTodayTotals();
  const now = new Date();
  const hoursToday = now.getUTCHours() + now.getUTCMinutes() / 60;
  if (hoursToday > 1) {
    const dailyRate = today.cost / (hoursToday / 24);
    const daysInMonth = new Date(now.getUTCFullYear(), now.getUTCMonth() + 1, 0).getUTCDate();
    result.projections = {
      dailyRate: Math.round(dailyRate * 100) / 100,
      projectedMonthly: Math.round(dailyRate * daysInMonth * 100) / 100,
    };
  }

  return result;
}
