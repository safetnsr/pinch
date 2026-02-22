import { initStore, cleanupRetention } from './store.js';
import { loadPricing } from './pricing.js';
import { initBudget, checkBudgets } from './budget.js';
import { trackAgentEnd } from './tracker.js';
import { costCheck, costCheckTool } from './tools/cost-check.js';
import { costBreakdown, costBreakdownTool } from './tools/cost-breakdown.js';
import { budgetStatus, budgetStatusTool } from './tools/budget-status.js';
import { startDashboard } from './dashboard/server.js';
import { execFile } from 'child_process';
import type { PinchConfig } from './types.js';

export default {
  id: 'pinch',
  name: 'pinch',
  version: '0.1.0',

  register(api: any) {
    try {
      console.log('[pinch] registering...');
      // api.config is the FULL openclaw config — extract our plugin-specific config
      const fullConfig = api?.config || {};
      const config: PinchConfig = fullConfig?.plugins?.entries?.pinch?.config 
        || fullConfig?.config  // some plugin APIs pass config directly
        || {};
      console.log('[pinch] config:', JSON.stringify(config));

      // Initialize subsystems
      loadPricing(config.pricing);
      initStore();
      initBudget(config.budget);

    // Hook: agent_end — track costs
    api.on('agent_end', (event: any, ctx: any) => {
      const record = trackAgentEnd(event, ctx);
      
      if (record) {
        // Check budgets and send alerts to active channel (from heartbeat config)
        const alerts = checkBudgets();
        if (alerts.length > 0) {
          const text = `💰 ${alerts.join('\n')}`;
          // Resolve target dynamically from heartbeat config
          const fullConfig = api.config as any;
          const hb = fullConfig?.agents?.defaults?.heartbeat || {};
          const channel = hb.target || 'telegram';
          const target = hb.to || '';
          if (!target) {
            console.warn(`[pinch] Budget alert skipped — no heartbeat.to in config`);
          } else {
            execFile('openclaw', ['message', 'send', '--channel', channel, '--target', target, '--message', text], 
              { timeout: 10000 },
              (err) => {
                if (err) console.warn(`[pinch] Failed to send alert: ${err.message}`);
                else console.log(`[pinch] Budget alert sent to ${channel}:${target}`);
              }
            );
          }
        }
      }
    });

    // Register agent tools — must return { content: [{ type: 'text', text }] }
    const wrap = (fn: () => string) => ({ content: [{ type: 'text' as const, text: fn() }] });

    api.registerTool({
      name: costCheckTool.name,
      description: costCheckTool.description,
      parameters: costCheckTool.parameters || {},
      async execute(_id: string, _params: any) { return wrap(costCheck); },
    });

    api.registerTool({
      name: costBreakdownTool.name,
      description: costBreakdownTool.description,
      parameters: costBreakdownTool.parameters || {},
      async execute(_id: string, _params: any) { return wrap(costBreakdown); },
    });

    api.registerTool({
      name: budgetStatusTool.name,
      description: budgetStatusTool.description,
      parameters: budgetStatusTool.parameters || {},
      async execute(_id: string, _params: any) { return wrap(budgetStatus); },
    });

    // Start dashboard
    const dashboardConfig = config.dashboard || {};
    if (dashboardConfig.enabled !== false) {
      startDashboard(dashboardConfig.port || 3334);
    }

    // Retention cleanup (run once on startup)
    const retentionDays = config.retentionDays || 90;
    const deleted = cleanupRetention(retentionDays);
    if (deleted > 0) {
      console.log(`[pinch] Cleaned up ${deleted} old record files (retention: ${retentionDays} days)`);
    }

    console.log('[pinch] Cost tracking active');
    } catch (err: any) {
      console.error('[pinch] REGISTER FAILED:', err.stack || err.message);
    }
  },
};
