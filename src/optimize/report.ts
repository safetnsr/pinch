import chalk from 'chalk';
import Table from 'cli-table3';
import type { MatrixData } from './matrix.js';

/**
 * Format a cost number to a readable string.
 */
function fmtCost(cost: number): string {
  if (cost < 0.0001) return '<$0.0001';
  return `$${cost.toFixed(4)}`;
}

/**
 * Format latency in ms to readable string.
 */
function fmtLatency(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Print the matrix as a colored terminal table.
 */
export function printReport(matrix: MatrixData): void {
  console.log('\n' + chalk.bold('pinch optimize — model × thinking benchmark\n'));

  const table = new Table({
    head: [
      chalk.bold('model'),
      chalk.bold('thinking'),
      chalk.bold('quality'),
      chalk.bold('cost/call'),
      chalk.bold('latency'),
      chalk.bold('verdict'),
    ],
    style: { head: [] },
  });

  // Sort by cost ascending
  const sorted = [...matrix.cells].sort((a, b) => a.avgCost - b.avgCost);

  for (const cell of sorted) {
    const key = `${cell.model}::${cell.thinking}`;
    const isOptimal = key === matrix.optimalKey;
    const isBaseline = key === matrix.baselineKey;

    const modelCol = isOptimal
      ? chalk.green(cell.model)
      : isBaseline
        ? chalk.yellow(cell.model)
        : cell.model;

    const thinkingCol = isOptimal
      ? chalk.green(cell.thinking)
      : cell.thinking;

    const qualityCol = isOptimal
      ? chalk.green(`${cell.avgScore.toFixed(1)}`)
      : cell.avgScore >= 80
        ? chalk.cyan(`${cell.avgScore.toFixed(1)}`)
        : chalk.red(`${cell.avgScore.toFixed(1)}`);

    const costCol = isOptimal
      ? chalk.green(fmtCost(cell.avgCost))
      : fmtCost(cell.avgCost);

    const latencyCol = fmtLatency(cell.avgLatency);

    let verdictCol: string;
    if (cell.recommendation === 'optimal') {
      verdictCol = chalk.green('✓ optimal');
    } else if (cell.recommendation === 'equivalent') {
      verdictCol = chalk.cyan('~ equivalent');
    } else {
      verdictCol = chalk.red('✗ degraded');
    }

    table.push([modelCol, thinkingCol, qualityCol, costCol, latencyCol, verdictCol]);
  }

  console.log(table.toString());

  console.log(chalk.dim(`\nbenchmark cost: ${fmtCost(matrix.totalBenchmarkCost)}`));

  if (matrix.projectedDailySavings > 0) {
    const baselineCell = matrix.cells.find(c => `${c.model}::${c.thinking}` === matrix.baselineKey);
    const optimalCell = matrix.cells.find(c => `${c.model}::${c.thinking}` === matrix.optimalKey);
    if (baselineCell && optimalCell && matrix.baselineKey !== matrix.optimalKey) {
      console.log(
        chalk.green(
          `switching from ${baselineCell.model}+${baselineCell.thinking} to ${optimalCell.model}+${optimalCell.thinking} saves ${fmtCost(matrix.projectedDailySavings)}/day`,
        ) + chalk.dim(` (est. ${matrix.dailyCallsEstimate} calls/day)`),
      );
    }
  } else {
    console.log(chalk.dim('baseline is already optimal'));
  }

  console.log('');
}

/**
 * Output matrix data as JSON (for --json flag).
 */
export function printJson(matrix: MatrixData): void {
  console.log(JSON.stringify(matrix, null, 2));
}
