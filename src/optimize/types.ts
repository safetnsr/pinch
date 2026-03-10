export interface TaskEntry {
  prompt: string;
  type?: string; // commit-msg, code-review, refactor, etc.
  expected?: string; // optional expected output for comparison
}

export interface BenchmarkResult {
  task: TaskEntry;
  model: string;
  thinking: string;
  output: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  latencyMs: number;
}

export interface JudgeVerdict {
  equivalent: boolean;
  score: number; // 0-100
  reasoning: string;
}

export interface MatrixCell {
  model: string;
  thinking: string;
  avgScore: number;
  avgCost: number;
  avgLatency: number;
  recommendation: 'optimal' | 'equivalent' | 'degraded';
}

export interface OptimizeOptions {
  tasks: string;
  models: string[];
  thinking: string[];
  json: boolean;
  baseline?: string;
}
