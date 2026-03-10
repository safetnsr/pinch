import { loadTasks, runBenchmarks } from './runner.js';
import { findReference, judgeAllResults } from './judge.js';
import { buildMatrix } from './matrix.js';
import { printReport, printJson } from './report.js';
import type { OptimizeOptions } from './types.js';

export async function runOptimize(options: OptimizeOptions): Promise<void> {
  const { tasks: tasksFile, models, thinking: thinkingLevels, json, baseline } = options;

  // 1. Load tasks
  console.log(`loading tasks from ${tasksFile}...`);
  const tasks = loadTasks(tasksFile);

  if (tasks.length === 0) {
    console.error('no tasks found in file');
    process.exit(1);
  }

  console.log(`found ${tasks.length} task(s). benchmarking ${models.length} model(s) × ${thinkingLevels.length} thinking level(s)...`);

  // 2. Run benchmarks
  const results = await runBenchmarks(tasks, models, thinkingLevels);

  if (results.length === 0) {
    console.error('no benchmark results — all runs failed');
    process.exit(1);
  }

  // 3. Find reference (best output)
  const reference = findReference(results, models);
  if (!reference) {
    console.error('could not determine reference output');
    process.exit(1);
  }

  // 4. Judge all outputs against reference
  console.log(`judging ${results.length} result(s)...`);
  const verdicts = await judgeAllResults(results, reference, models);

  // 5. Build matrix
  let baselineModel: string | undefined;
  let baselineThinking: string | undefined;
  if (baseline) {
    const parts = baseline.split(':');
    baselineModel = parts[0];
    baselineThinking = parts[1] ?? 'high';
  } else {
    baselineModel = models[0];
    baselineThinking = thinkingLevels[thinkingLevels.length - 1];
  }

  const matrix = buildMatrix(results, verdicts, baselineModel, baselineThinking);

  // 6. Print report
  if (json) {
    printJson(matrix);
  } else {
    printReport(matrix);
  }
}

export { loadTasks } from './runner.js';
export { buildMatrix } from './matrix.js';
export { findReference, judgeAllResults } from './judge.js';
export { printReport, printJson } from './report.js';
export type { TaskEntry, BenchmarkResult, JudgeVerdict, MatrixCell, OptimizeOptions } from './types.js';
