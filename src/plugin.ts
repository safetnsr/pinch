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
    const config: PinchConfig = api.getConfig?.() || {};

    // Initialize subsystems
    try {
      loadPricing(config.pricing);
      initStore();
      initBudget(config.budget);
    } catch (err: any) {
      console.error(`[pinch] Init error: ${err.message}`);
      return;
    }

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
    api.registerTool(costCheckTool.name, {
      description: costCheckTool.description,
      parameters: costCheckTool.parameters,
      execute: costCheckTool.execute,
    });

    api.registerTool(costBreakdownTool.name, {
      description: costBreakdownTool.description,
      parameters: costBreakdownTool.parameters,
      execute: costBreakdownTool.execute,
    });

    api.registerTool(budgetStatusTool.name, {
      description: budgetStatusTool.description,
      parameters: budgetStatusTool.parameters,
      execute: budgetStatusTool.execute,
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
  },
};
