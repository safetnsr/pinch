import { initStore, cleanupRetention } from './store.js';
import { loadPricing } from './pricing.js';
import { initBudget, checkBudgets } from './budget.js';
import { trackAgentEnd } from './tracker.js';
import { costCheck, costCheckTool } from './tools/cost-check.js';
import { costBreakdown, costBreakdownTool } from './tools/cost-breakdown.js';
import { budgetStatus, budgetStatusTool } from './tools/budget-status.js';
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
        if (alerts.length > 0) {
          const text = `💰 ${alerts.join('\n')}`;
          const fullConfig = api.config as any;
          const hb = fullConfig?.agents?.defaults?.heartbeat || {};
          const channel = hb.target; // telegram, discord, slack, etc.
          const chatId = hb.to;

          // Channel-specific delivery
          if (channel === 'telegram') {
            const botToken = fullConfig?.channels?.telegram?.botToken;
            if (botToken && chatId) {
              fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: chatId, text }),
              }).then(r => r.json()).then((r: any) => {
                if (r.ok) console.log(`[pinch] Alert sent to telegram:${chatId}`);
                else console.warn(`[pinch] Telegram error: ${r.description}`);
              }).catch(err => console.warn(`[pinch] Alert failed: ${err.message}`));
            }
          } else if (channel === 'discord') {
            // Discord webhook from config or alertDelivery.webhookUrl
            const webhookUrl = config.alertDelivery?.webhookUrl;
            if (webhookUrl) {
              fetch(webhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content: text }),
              }).catch(err => console.warn(`[pinch] Discord alert failed: ${err.message}`));
            }
          } else if (config.alertDelivery?.webhookUrl) {
            // Generic webhook fallback for any channel
            fetch(config.alertDelivery.webhookUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ text, channel, target: chatId, alerts }),
            }).catch(err => console.warn(`[pinch] Webhook alert failed: ${err.message}`));
          } else {
            console.warn(`[pinch] No alert delivery method for channel: ${channel}. Set alertDelivery.webhookUrl in pinch config.`);
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
