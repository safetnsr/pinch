import Anthropic from '@anthropic-ai/sdk';
import type { BenchmarkResult, JudgeVerdict } from './types.js';

/**
 * Find the best reference result (highest thinking + best model priority).
 */
export function findReference(results: BenchmarkResult[], models: string[]): BenchmarkResult | null {
  if (results.length === 0) return null;

  const thinkingOrder = { high: 3, medium: 2, low: 1, none: 0 };

  // Sort by: model index (lower = better), then thinking level (higher = better)
  const sorted = [...results].sort((a, b) => {
    const aModelIdx = models.indexOf(a.model);
    const bModelIdx = models.indexOf(b.model);
    if (aModelIdx !== bModelIdx) return aModelIdx - bModelIdx;
    const aThink = thinkingOrder[a.thinking as keyof typeof thinkingOrder] ?? 0;
    const bThink = thinkingOrder[b.thinking as keyof typeof thinkingOrder] ?? 0;
    return bThink - aThink;
  });

  return sorted[0];
}

/**
 * Judge a single candidate against a reference output.
 */
export async function judgeOutputs(
  client: Anthropic,
  task: BenchmarkResult['task'],
  reference: string,
  candidate: string,
): Promise<JudgeVerdict> {
  const prompt = `Compare these two outputs for the task: ${task.prompt}

Output A (reference): ${reference}

Output B (candidate): ${candidate}

Are they equivalent in quality for this task type? Score 0-100 where 100 = identical quality. Respond as JSON only: {"equivalent": bool, "score": number, "reasoning": string}`;

  const response = await client.messages.create({
    model: 'claude-haiku-3-5',
    max_tokens: 512,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content.find(b => b.type === 'text')?.text ?? '{}';

  // Extract JSON from response (handle markdown code blocks)
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return { equivalent: false, score: 0, reasoning: 'Failed to parse judge response' };
  }

  try {
    const verdict = JSON.parse(jsonMatch[0]);
    return {
      equivalent: Boolean(verdict.equivalent),
      score: Number(verdict.score) || 0,
      reasoning: String(verdict.reasoning || ''),
    };
  } catch {
    return { equivalent: false, score: 0, reasoning: 'Invalid JSON from judge' };
  }
}

/**
 * Judge all benchmark results against the reference.
 * Reference gets score 100 (it IS the reference).
 */
export async function judgeAllResults(
  results: BenchmarkResult[],
  reference: BenchmarkResult,
  models: string[],
): Promise<Map<string, JudgeVerdict>> {
  const client = new Anthropic();
  const verdicts = new Map<string, JudgeVerdict>();
  const refKey = `${reference.model}::${reference.thinking}::${reference.task.prompt}`;

  // Reference scores 100
  verdicts.set(refKey, { equivalent: true, score: 100, reasoning: 'Reference output' });

  for (const result of results) {
    const key = `${result.model}::${result.thinking}::${result.task.prompt}`;
    if (key === refKey) continue;
    if (verdicts.has(key)) continue;

    // Only judge results for the same task
    if (result.task.prompt !== reference.task.prompt) {
      // Find reference for this specific task
      const taskRef = results.find(
        r => r.task.prompt === result.task.prompt &&
          r.model === reference.model &&
          r.thinking === reference.thinking,
      ) ?? reference;

      try {
        const verdict = await judgeOutputs(client, result.task, taskRef.output, result.output);
        verdicts.set(key, verdict);
      } catch (err: any) {
        console.warn(`  judge failed for ${result.model}/${result.thinking}: ${err.message}`);
        verdicts.set(key, { equivalent: false, score: 0, reasoning: 'Judge error' });
      }
    } else {
      try {
        const verdict = await judgeOutputs(client, result.task, reference.output, result.output);
        verdicts.set(key, verdict);
      } catch (err: any) {
        console.warn(`  judge failed for ${result.model}/${result.thinking}: ${err.message}`);
        verdicts.set(key, { equivalent: false, score: 0, reasoning: 'Judge error' });
      }
    }
  }

  return verdicts;
}
