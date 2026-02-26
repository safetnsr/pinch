import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getTodayTotals, getWeekTotals, getMonthTotals, getTrend, getLatest } from '../store.js';
import { getBudgetStatus } from '../budget.js';

const app = new Hono();

// API routes
app.get('/api/today', (c) => {
  const totals = getTodayTotals();
  const budgetInfo = getBudgetStatus();
  // flatten budget for dashboard: expects today.budget (number) and today.budgetPct (0-1)
  const dailyBudget = budgetInfo?.daily?.budget || null;
  const budgetPct = dailyBudget ? totals.cost / dailyBudget : null;
  // flatten byModel/byType for dashboard: {name: cost} instead of {name: {cost, records}}
  const flatByModel: Record<string, number> = {};
  const flatByType: Record<string, number> = {};
  for (const [k, v] of Object.entries(totals.byModel || {})) {
    flatByModel[k] = typeof v === 'object' ? (v as any).cost : v;
  }
  for (const [k, v] of Object.entries(totals.byType || {})) {
    flatByType[k] = typeof v === 'object' ? (v as any).cost : v;
  }
  return c.json({ ...totals, byModel: flatByModel, byType: flatByType, budget: dailyBudget, budgetPct, budgetDetail: budgetInfo });
});

app.get('/api/week', (c) => {
  const totals = getWeekTotals();
  return c.json(totals);
});

app.get('/api/month', (c) => {
  const totals = getMonthTotals();
  return c.json(totals);
});

app.get('/api/trend', (c) => {
  const days = parseInt(c.req.query('days') || '7', 10);
  const trend = getTrend(Math.min(days, 90));
  return c.json({ days: trend });
});

app.get('/api/latest', (c) => {
  const limit = parseInt(c.req.query('limit') || '10', 10);
  const records = getLatest(Math.min(limit, 100));
  // Map raw records to dashboard format
  const mapped = records.map(r => ({
    ts: r.ts,
    label: r.sk.replace(/^agent:main:/, '').replace(/^agent:/, '') || 'main',
    model: r.m.replace(/^anthropic\//, '').replace(/^openai\//, ''),
    cost: r.c,
    type: r.tt,
    tools: r.tools,
    dur: r.dur,
  }));
  return c.json({ records: mapped });
});

// Dashboard HTML
app.get('/', (c) => {
  // When bundled into plugin.js, import.meta.url points to plugin.js (one level up from dashboard/)
  // Try multiple paths to handle both bundled and unbundled cases
  const thisFile = fileURLToPath(import.meta.url);
  const thisDir = dirname(thisFile);
  const htmlPaths = [
    join(thisDir, 'dashboard', 'index.html'),             // bundled: plugin.js → dashboard/index.html
    join(thisDir, 'index.html'),                          // unbundled: server/dashboard/server.js → index.html
    join(thisDir, '..', 'dashboard', 'index.html'),       // fallback
    join(thisDir, '..', 'src', 'dashboard', 'index.html'), // dev fallback
  ];
  
  for (const p of htmlPaths) {
    if (existsSync(p)) {
      const html = readFileSync(p, 'utf-8');
      return c.html(html);
    }
  }
  
  return c.html('<html><body><h1>pinch dashboard</h1><p>index.html not found</p></body></html>');
});

let server: any = null;

export function startDashboard(preferredPort: number = 3334): number | null {
  if (server) return null;

  // Try preferred port, then fallback up to 10 ports
  for (let port = preferredPort; port < preferredPort + 10; port++) {
    try {
      let resolvedPort = port;
      server = serve({ fetch: app.fetch, port }, (info) => {
        resolvedPort = info.port;
        console.log(`[pinch] dashboard → http://localhost:${info.port}`);
      });
      return resolvedPort;
    } catch (err: any) {
      if (err.code === 'EADDRINUSE') {
        console.log(`[pinch] port ${port} in use, trying ${port + 1}...`);
        continue;
      }
      console.error(`[pinch] dashboard failed: ${err.message}`);
      return null;
    }
  }
  console.error(`[pinch] no free port found in range ${preferredPort}-${preferredPort + 9}`);
  return null;
}

export function stopDashboard(): void {
  if (server) {
    server.close();
    server = null;
  }
}

export { app };
