import { getTodayTotals, getWeekTotals, getMonthTotals } from '../store.js';
import { getBudgetStatus } from '../budget.js';

/**
 * pinch_check — "how much have I spent?"
 */
export function costCheck(): string {
  const today = getTodayTotals();
  const week = getWeekTotals();
  const month = getMonthTotals();
  const budget = getBudgetStatus();

  const lines: string[] = [];

  // Today
  let todayLine = `today: $${today.cost.toFixed(2)} (${today.records} runs)`;
  if (budget.daily) todayLine += ` — ${budget.daily.pct}% of $${budget.daily.budget} budget`;
  lines.push(todayLine);

  // Week
  let weekLine = `week: $${week.cost.toFixed(2)} (${week.records} runs)`;
  if (budget.weekly) weekLine += ` — ${budget.weekly.pct}% of $${budget.weekly.budget} budget`;
  lines.push(weekLine);

  // Month
  let monthLine = `month: $${month.cost.toFixed(2)} (${month.records} runs)`;
  if (budget.monthly) monthLine += ` — ${budget.monthly.pct}% of $${budget.monthly.budget} budget`;
  lines.push(monthLine);

  // Model breakdown (today)
  if (Object.keys(today.byModel).length > 0) {
    lines.push('');
    lines.push('by model (today):');
    const sorted = Object.entries(today.byModel).sort((a, b) => b[1].cost - a[1].cost);
    for (const [model, data] of sorted) {
      lines.push(`  ${model}: $${data.cost.toFixed(2)} (${data.records} runs)`);
    }
  }

  // Type breakdown (today)
  if (Object.keys(today.byType).length > 0) {
    lines.push('');
    lines.push('by type (today):');
    for (const [type, data] of Object.entries(today.byType)) {
      lines.push(`  ${type}: $${data.cost.toFixed(2)} (${data.records} runs)`);
    }
  }

  lines.push('');
  lines.push('note: current run cost not yet included.');

  return lines.join('\n');
}

export const costCheckTool = {
  name: 'pinch_check',
  description: 'Check current cost spend — today, this week, this month. Shows model breakdown and budget status.',
  parameters: {},
  execute: async () => costCheck(),
};
