import { getTodayRecords, getBreakdown } from '../store.js';

/**
 * pinch_breakdown — "what's my most expensive task?"
 */
export function costBreakdown(): string {
  const records = getTodayRecords();
  const lines: string[] = [];

  if (records.length === 0) {
    return 'no cost records today yet.';
  }

  // Top sessions by cost
  const bySk: Record<string, { cost: number; records: number; models: Set<string> }> = {};
  for (const r of records) {
    if (!bySk[r.sk]) bySk[r.sk] = { cost: 0, records: 0, models: new Set() };
    bySk[r.sk].cost += r.c;
    bySk[r.sk].records++;
    bySk[r.sk].models.add(r.m);
  }

  const topSessions = Object.entries(bySk)
    .sort((a, b) => b[1].cost - a[1].cost)
    .slice(0, 10);

  lines.push('top sessions today:');
  for (const [sk, data] of topSessions) {
    const label = sk.split(':').slice(-2).join(':');
    const models = Array.from(data.models).join(', ');
    lines.push(`  ${label}: $${data.cost.toFixed(2)} (${data.records} runs, ${models})`);
  }

  // Cron costs
  const cronRecords = records.filter(r => r.tt === 'cron');
  if (cronRecords.length > 0) {
    lines.push('');
    lines.push('cron jobs:');
    const byCron: Record<string, { cost: number; records: number }> = {};
    for (const r of cronRecords) {
      const label = r.sk.split(':').pop() || r.sk;
      if (!byCron[label]) byCron[label] = { cost: 0, records: 0 };
      byCron[label].cost += r.c;
      byCron[label].records++;
    }
    const sorted = Object.entries(byCron).sort((a, b) => b[1].cost - a[1].cost);
    for (const [label, data] of sorted) {
      lines.push(`  ${label}: $${data.cost.toFixed(2)} (${data.records} runs)`);
    }
  }

  // Sub-agent costs
  const subRecords = records.filter(r => r.sub);
  if (subRecords.length > 0) {
    lines.push('');
    lines.push('sub-agents:');
    const totalSubCost = subRecords.reduce((s, r) => s + r.c, 0);
    lines.push(`  total: $${totalSubCost.toFixed(2)} (${subRecords.length} runs)`);
    
    // Group by parent
    const byParent: Record<string, number> = {};
    for (const r of subRecords) {
      const parent = r.par || 'unknown';
      byParent[parent] = (byParent[parent] || 0) + r.c;
    }
    for (const [parent, cost] of Object.entries(byParent).sort((a, b) => b[1] - a[1])) {
      const label = parent.split(':').slice(-2).join(':');
      lines.push(`  parent ${label}: $${cost.toFixed(2)}`);
    }
  }

  // Heartbeat costs
  const hbRecords = records.filter(r => r.tt === 'heartbeat');
  if (hbRecords.length > 0) {
    const hbCost = hbRecords.reduce((s, r) => s + r.c, 0);
    lines.push('');
    lines.push(`heartbeats: $${hbCost.toFixed(2)} (${hbRecords.length} runs)`);
  }

  lines.push('');
  lines.push('note: current run cost not yet included.');

  return lines.join('\n');
}

export const costBreakdownTool = {
  name: 'pinch_breakdown',
  description: 'Cost breakdown — top sessions, cron jobs, sub-agents, heartbeats. Shows where your money goes.',
  parameters: {},
  execute: async () => ({ content: [{ type: 'text', text: costBreakdown() }] }),
};
