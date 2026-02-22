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
  return c.json(trend);
});

app.get('/api/latest', (c) => {
  const limit = parseInt(c.req.query('limit') || '10', 10);
  const records = getLatest(Math.min(limit, 100));
  return c.json(records);
});

// Dashboard HTML
app.get('/', (c) => {
  const thisDir = dirname(fileURLToPath(import.meta.url));
  const htmlPaths = [
    join(thisDir, 'index.html'),
    join(thisDir, '..', 'src', 'dashboard', 'index.html'),
    join(thisDir, '..', 'dashboard', 'index.html'),
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

export function startDashboard(port: number = 3334): void {
  if (server) return;
  
  try {
    server = serve({ fetch: app.fetch, port }, (info) => {
      console.log(`[pinch] dashboard running at http://localhost:${info.port}`);
    });
  } catch (err: any) {
    console.error(`[pinch] Failed to start dashboard: ${err.message}`);
  }
}

export function stopDashboard(): void {
  if (server) {
    server.close();
    server = null;
  }
}

export { app };
