export interface ModelPricing {
  provider: string;
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
  effectiveDate: string;
  source?: string;
  note?: string;
}

export interface PricingData {
  version: number;
  updatedAt: string;
  models: Record<string, ModelPricing>;
  aliases: Record<string, string>;
  providerPrefixes: string[];
}

export interface CostRecord {
  v: number;
  id: string;
  ts: number;
  sk: string;
  m: string;
  in: number;
  out: number;
  cr: number;
  cw: number;
  c: number;
  src: 'provider' | 'calculated' | 'override';
  tt: 'chat' | 'heartbeat' | 'cron' | 'subagent';
  tools: string[];
  dur: number;
  sub: boolean;
  par: string | null;
  pv: number;
  th: number;
}

export interface DailyAggregate {
  date: string;
  cost: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  records: number;
  byModel: Record<string, { cost: number; records: number }>;
  byType: Record<string, { cost: number; records: number }>;
  topSessions: { key: string; cost: number }[];
  pricingVersion: number;
}

export interface BudgetConfig {
  daily?: number;
  weekly?: number;
  monthly?: number;
}

export interface PinchConfig {
  budget?: BudgetConfig;
  dashboard?: {
    enabled?: boolean;
    port?: number;
  };
  pricing?: Record<string, Partial<ModelPricing>>;
  retentionDays?: number;
}

export interface TodayTotals {
  cost: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  records: number;
  byModel: Record<string, { cost: number; records: number }>;
  byType: Record<string, { cost: number; records: number }>;
}
