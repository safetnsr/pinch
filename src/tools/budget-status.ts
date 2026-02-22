import { getBudgetStatus } from '../budget.js';
import { getTodayRecords } from '../store.js';

/**
 * pinch_budget — "am I near my limit?"
 */
export function budgetStatus(): string {
  const status = getBudgetStatus();
  const lines: string[] = [];

  if (!status.daily && !status.weekly && !status.monthly) {
    lines.push('no budgets configured.');
    lines.push('set budgets in openclaw config: plugins.pinch.budget.daily / weekly / monthly');
    return lines.join('\n');
  }

  if (status.daily) {
    const s = status.daily;
    lines.push(`daily: $${s.spent.toFixed(2)} / $${s.budget.toFixed(2)} (${s.pct}%) — $${s.remaining.toFixed(2)} remaining`);
  }

  if (status.weekly) {
    const s = status.weekly;
    lines.push(`weekly: $${s.spent.toFixed(2)} / $${s.budget.toFixed(2)} (${s.pct}%) — $${s.remaining.toFixed(2)} remaining`);
  }

  if (status.monthly) {
    const s = status.monthly;
    lines.push(`monthly: $${s.spent.toFixed(2)} / $${s.budget.toFixed(2)} (${s.pct}%) — $${s.remaining.toFixed(2)} remaining`);
  }

  // Projections
  if (status.projections) {
    lines.push('');
    lines.push(`projected daily rate: $${status.projections.dailyRate.toFixed(2)}`);
    lines.push(`projected monthly: $${status.projections.projectedMonthly.toFixed(2)}`);
  }

  // Suggestions
  const suggestions = generateSuggestions();
  if (suggestions.length > 0) {
    lines.push('');
    lines.push('suggestions:');
    for (const s of suggestions) {
      lines.push(`  — ${s}`);
    }
  }

  return lines.join('\n');
}

function generateSuggestions(): string[] {
  const suggestions: string[] = [];
  const records = getTodayRecords();

  // Heartbeat cost
  const hbRecords = records.filter(r => r.tt === 'heartbeat');
  if (hbRecords.length > 0) {
    const hbCost = hbRecords.reduce((s, r) => s + r.c, 0);
    const avgCost = hbCost / hbRecords.length;
    if (hbRecords.length >= 6) {
      suggestions.push(`heartbeats cost $${hbCost.toFixed(2)}/day (${hbRecords.length} runs × $${avgCost.toFixed(3)}) — consider extending interval`);
    }
  }

  // Expensive model usage
  const byModel: Record<string, { cost: number; records: number }> = {};
  for (const r of records) {
    if (!byModel[r.m]) byModel[r.m] = { cost: 0, records: 0 };
    byModel[r.m].cost += r.c;
    byModel[r.m].records++;
  }
  
  const sorted = Object.entries(byModel).sort((a, b) => b[1].cost - a[1].cost);
  if (sorted.length > 1) {
    const [topModel, topData] = sorted[0];
    const totalCost = records.reduce((s, r) => s + r.c, 0);
    const pct = (topData.cost / totalCost) * 100;
    if (pct > 80) {
      suggestions.push(`${topModel} accounts for ${Math.round(pct)}% of costs — consider using a cheaper model for routine tasks`);
    }
  }

  return suggestions;
}

export const budgetStatusTool = {
  name: 'pinch_budget',
  description: 'Budget status — remaining budget per period, projections, and cost optimization suggestions.',
  parameters: {},
  execute: async () => ({ content: [{ type: 'text', text: budgetStatus() }] }),
};
