import { initStore, cleanupRetention } from './store.js';
import { loadPricing } from './pricing.js';
import { initBudget, checkBudgets } from './budget.js';
import { trackAgentEnd } from './tracker.js';
import { costCheckTool } from './tools/cost-check.js';
import { costBreakdownTool } from './tools/cost-breakdown.js';
import { budgetStatusTool } from './tools/budget-status.js';
import { startDashboard } from './dashboard/server.js';
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
        // Check budgets and send alerts
        const alerts = checkBudgets();
        for (const alert of alerts) {
          if (api.sendMessage) {
            api.sendMessage(alert);
          } else {
            console.warn(`[pinch] ${alert}`);
          }
        }
      }
    });

    // Register agent tools
    api.registerTool({
      name: costCheckTool.name,
      description: costCheckTool.description,
      parameters: costCheckTool.parameters || {},
      async execute(_id: string, params: any) { return costCheckTool.execute(); },
    });

    api.registerTool({
      name: costBreakdownTool.name,
      description: costBreakdownTool.description,
      parameters: costBreakdownTool.parameters || {},
      async execute(_id: string, params: any) { return costBreakdownTool.execute(); },
    });

    api.registerTool({
      name: budgetStatusTool.name,
      description: budgetStatusTool.description,
      parameters: budgetStatusTool.parameters || {},
      async execute(_id: string, params: any) { return budgetStatusTool.execute(); },
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
