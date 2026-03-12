#!/usr/bin/env node

import { Command } from 'commander';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));

const program = new Command();

program
  .name('pinch')
  .description(
    'know what your agent costs — openclaw cost tracking plugin\n' +
    'Install via: openclaw plugins install @safetnsr/pinch\n' +
    'Dashboard: http://localhost:3334'
  )
  .version(pkg.version);

program
  .command('optimize')
  .description('benchmark prompts across model tiers and thinking levels — find cheapest combo that maintains quality')
  .requiredOption('--tasks <file>', 'JSONL file with tasks (each line: {"prompt": "..."})')
  .option(
    '--models <models>',
    'comma-separated list of models to benchmark',
    'claude-sonnet-4-5,claude-haiku-3-5',
  )
  .option(
    '--thinking <levels>',
    'comma-separated thinking levels: low,medium,high',
    'low,medium,high',
  )
  .option('--json', 'output results as JSON', false)
  .option(
    '--baseline <model:thinking>',
    'baseline for savings calculation (e.g. claude-sonnet-4-5:high)',
  )
  .action(async (opts) => {
    // Dynamically import optimize from built output
    let runOptimize;
    try {
      const mod = await import('../server/optimize/index.js');
      runOptimize = mod.runOptimize;
    } catch (err) {
      console.error('pinch: could not load optimize module. Did you run npm run build?');
      console.error(err.message);
      process.exit(1);
    }

    const models = opts.models.split(',').map(s => s.trim()).filter(Boolean);
    const thinking = opts.thinking.split(',').map(s => s.trim()).filter(Boolean);

    await runOptimize({
      tasks: opts.tasks,
      models,
      thinking,
      json: opts.json,
      baseline: opts.baseline,
    });
  });

program
  .command('cache')
  .description('prompt cache hit rate analysis — find what kills your cache')
  .option('--since <days>', 'analyze last N days', '7')
  .option('--json', 'JSON output')
  .action(async (opts) => {
    const { runCacheAnalysis } = await import('../server/cache-display.js');
    await runCacheAnalysis({
      days: parseInt(opts.since, 10) || 7,
      json: opts.json || false,
    });
  });

program.parse();
