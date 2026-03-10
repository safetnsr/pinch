import { readFileSync } from 'fs';
import Anthropic from '@anthropic-ai/sdk';
import type { TaskEntry, BenchmarkResult } from './types.js';

// Models that support extended thinking
const THINKING_CAPABLE_MODELS = new Set([
  'claude-sonnet-4-5',
  'claude-sonnet-4-6',
  'claude-sonnet-4',
  'claude-opus-4',
  'claude-opus-4-5',
  'claude-opus-4-6',
  'claude-sonnet-3.7',
]);

const THINKING_BUDGETS: Record<string, number> = {
  low: 1024,
  medium: 4096,
  high: 16384,
};

/**
 * Parse a JSONL file into TaskEntry array.
 * Skips invalid lines with a warning.
 */
export function loadTasks(filePath: string): TaskEntry[] {
  const content = readFileSync(filePath, 'utf-8').trim();
  if (!content) return [];

  const tasks: TaskEntry[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    let parsed: any;
    try {
      parsed = JSON.parse(line);
    } catch {
      console.warn(`[pinch optimize] Line ${i + 1}: invalid JSON, skipping`);
      continue;
    }

    if (!parsed.prompt || typeof parsed.prompt !== 'string') {
      console.warn(`[pinch optimize] Line ${i + 1}: missing "prompt" field, skipping`);
      continue;
    }

    tasks.push({
      prompt: parsed.prompt,
      type: parsed.type,
      expected: parsed.expected,
    });
  }

  return tasks;
}

/**
 * Calculate cost from token counts using known per-MTok rates.
 */
export function calculateCost(model: string, inputTokens: number, outputTokens: number): number {
  const rates: Record<string, { input: number; output: number }> = {
    'claude-opus-4': { input: 15.0, output: 75.0 },
    'claude-opus-4-5': { input: 15.0, output: 75.0 },
    'claude-opus-4-6': { input: 15.0, output: 75.0 },
    'claude-sonnet-4-5': { input: 3.0, output: 15.0 },
    'claude-sonnet-4-6': { input: 3.0, output: 15.0 },
    'claude-sonnet-4': { input: 3.0, output: 15.0 },
    'claude-haiku-3-5': { input: 0.8, output: 4.0 },
    'claude-haiku-3.5': { input: 0.8, output: 4.0 },
    'claude-haiku-4-5': { input: 1.0, output: 5.0 },
  };

  const rate = rates[model] ?? { input: 3.0, output: 15.0 };
  return (inputTokens / 1_000_000) * rate.input + (outputTokens / 1_000_000) * rate.output;
}

/**
 * Run a single prompt against the API with optional extended thinking.
 */
async function runSingle(
  client: Anthropic,
  task: TaskEntry,
  model: string,
  thinkingLevel: string,
): Promise<BenchmarkResult> {
  const start = Date.now();
  const supportsThinking = THINKING_CAPABLE_MODELS.has(model);
  const budget = THINKING_BUDGETS[thinkingLevel] ?? 1024;

  const requestParams: any = {
    model,
    max_tokens: supportsThinking && thinkingLevel !== 'none' ? budget + 4096 : 4096,
    messages: [{ role: 'user', content: task.prompt }],
  };

  if (supportsThinking && thinkingLevel !== 'none') {
    requestParams.thinking = {
      type: 'enabled',
      budget_tokens: budget,
    };
  }

  const response = await client.messages.create(requestParams);
  const latencyMs = Date.now() - start;

  // Extract text output (skip thinking blocks)
  let output = '';
  for (const block of response.content) {
    if (block.type === 'text') {
      output = block.text;
      break;
    }
  }

  const inputTokens = response.usage.input_tokens;
  const outputTokens = response.usage.output_tokens;
  const cost = calculateCost(model, inputTokens, outputTokens);

  return {
    task,
    model,
    thinking: supportsThinking ? thinkingLevel : 'none',
    output,
    inputTokens,
    outputTokens,
    cost,
    latencyMs,
  };
}

/**
 * Run benchmarks for all task × model × thinking combinations.
 */
export async function runBenchmarks(
  tasks: TaskEntry[],
  models: string[],
  thinkingLevels: string[],
): Promise<BenchmarkResult[]> {
  const client = new Anthropic();
  const results: BenchmarkResult[] = [];

  for (const task of tasks) {
    for (const model of models) {
      const supportsThinking = THINKING_CAPABLE_MODELS.has(model);

      if (!supportsThinking) {
        // Run once without thinking
        console.log(`  running ${model} (no thinking)...`);
        let result: BenchmarkResult | null = null;
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            result = await runSingle(client, task, model, 'none');
            break;
          } catch (err: any) {
            if (attempt === 0) {
              console.warn(`  retry ${model}: ${err.message}`);
              await new Promise(r => setTimeout(r, 2000));
            } else {
              console.warn(`  skip ${model}: ${err.message}`);
            }
          }
        }
        if (result) results.push(result);
      } else {
        // Run for each thinking level
        for (const level of thinkingLevels) {
          console.log(`  running ${model} (thinking=${level})...`);
          let result: BenchmarkResult | null = null;
          for (let attempt = 0; attempt < 2; attempt++) {
            try {
              result = await runSingle(client, task, model, level);
              break;
            } catch (err: any) {
              if (attempt === 0) {
                console.warn(`  retry ${model}/${level}: ${err.message}`);
                await new Promise(r => setTimeout(r, 2000));
              } else {
                console.warn(`  skip ${model}/${level}: ${err.message}`);
              }
            }
          }
          if (result) results.push(result);
        }
      }
    }
  }

  return results;
}
