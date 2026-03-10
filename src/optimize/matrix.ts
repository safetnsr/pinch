import type { BenchmarkResult, JudgeVerdict, MatrixCell } from './types.js';

export interface MatrixData {
  cells: MatrixCell[];
  totalBenchmarkCost: number;
  baselineKey: string;
  optimalKey: string;
  projectedDailySavings: number;
  dailyCallsEstimate: number;
}

/**
 * Build a key for a model+thinking combo.
 */
export function comboKey(model: string, thinking: string): string {
  return `${model}::${thinking}`;
}

/**
 * Aggregate benchmark results and judge verdicts into a cost/quality matrix.
 */
export function buildMatrix(
  results: BenchmarkResult[],
  verdicts: Map<string, JudgeVerdict>,
  baselineModel?: string,
  baselineThinking?: string,
): MatrixData {
  // Group results by model+thinking combo
  const groups = new Map<string, BenchmarkResult[]>();
  for (const r of results) {
    const key = comboKey(r.model, r.thinking);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }

  // Aggregate scores per combo
  const cells: MatrixCell[] = [];
  let totalBenchmarkCost = 0;

  for (const [key, group] of groups.entries()) {
    const [model, thinking] = key.split('::');
    let totalScore = 0;
    let scoreCount = 0;
    let totalCost = 0;
    let totalLatency = 0;

    for (const r of group) {
      const vKey = `${r.model}::${r.thinking}::${r.task.prompt}`;
      const verdict = verdicts.get(vKey);
      if (verdict) {
        totalScore += verdict.score;
        scoreCount++;
      }
      totalCost += r.cost;
      totalLatency += r.latencyMs;
      totalBenchmarkCost += r.cost;
    }

    const avgScore = scoreCount > 0 ? totalScore / scoreCount : 0;
    const avgCost = group.length > 0 ? totalCost / group.length : 0;
    const avgLatency = group.length > 0 ? totalLatency / group.length : 0;

    cells.push({
      model,
      thinking,
      avgScore,
      avgCost,
      avgLatency,
      recommendation: 'degraded', // placeholder, set below
    });
  }

  // Don't double-count costs (they were counted per-result above, but we summed in the loop)
  // Fix: totalBenchmarkCost was summed correctly per result
  // Actually we need to fix the double count — totalBenchmarkCost sums all results
  // Reset and recount
  totalBenchmarkCost = results.reduce((sum, r) => sum + r.cost, 0);

  // Determine baseline
  const baseline = cells.find(
    c => c.model === baselineModel && c.thinking === baselineThinking,
  ) ?? cells.reduce((best, c) => c.avgCost > best.avgCost ? c : best, cells[0]);

  const baselineKey = comboKey(baseline?.model ?? '', baseline?.thinking ?? '');

  // Mark recommendations: find cheapest with score >= 90 as optimal
  // Sort by cost ascending
  const sorted = [...cells].sort((a, b) => a.avgCost - b.avgCost);

  let optimalCell: MatrixCell | null = null;
  for (const cell of sorted) {
    if (cell.avgScore >= 90) {
      optimalCell = cell;
      break;
    }
  }

  // If no cell hits 90, find cheapest >= 80
  if (!optimalCell) {
    for (const cell of sorted) {
      if (cell.avgScore >= 80) {
        optimalCell = cell;
        break;
      }
    }
  }

  // If still nothing, pick highest score
  if (!optimalCell && cells.length > 0) {
    optimalCell = cells.reduce((best, c) => c.avgScore > best.avgScore ? c : best, cells[0]);
  }

  const optimalKey = optimalCell ? comboKey(optimalCell.model, optimalCell.thinking) : baselineKey;

  // Set recommendations
  for (const cell of cells) {
    const key = comboKey(cell.model, cell.thinking);
    if (key === optimalKey) {
      cell.recommendation = 'optimal';
    } else if (cell.avgScore >= 80) {
      cell.recommendation = 'equivalent';
    } else {
      cell.recommendation = 'degraded';
    }
  }

  // Calculate projected savings (assuming 100 calls/day as estimate)
  const dailyCallsEstimate = 100;
  const baselineDailyCost = (baseline?.avgCost ?? 0) * dailyCallsEstimate;
  const optimalDailyCost = (optimalCell?.avgCost ?? 0) * dailyCallsEstimate;
  const projectedDailySavings = Math.max(0, baselineDailyCost - optimalDailyCost);

  return {
    cells,
    totalBenchmarkCost,
    baselineKey,
    optimalKey,
    projectedDailySavings,
    dailyCallsEstimate,
  };
}
