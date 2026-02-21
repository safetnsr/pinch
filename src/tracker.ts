import { getCost } from './pricing.js';
import { normalizeModelName } from './normalize.js';
import { writeRecord } from './store.js';
import { getPricingData } from './pricing.js';
import type { CostRecord } from './types.js';

/**
 * Extract cost data from an agent_end event and write to store.
 * Adapted from comrade-connect's agent-end.ts pattern.
 */
export function trackAgentEnd(event: any, ctx: any): CostRecord | null {
  try {
    const messages = event?.messages || [];
    if (messages.length === 0) return null;

    const sessionKey = ctx?.sessionKey || 'unknown';
    const durationMs = event?.durationMs || 0;
    const pricing = getPricingData();

    // Find last user message — only process current turn
    let lastUserIndex = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]?.role === 'user' || messages[i]?.role === 'human') {
        lastUserIndex = i;
        break;
      }
    }
    const turnMessages = lastUserIndex >= 0 ? messages.slice(lastUserIndex + 1) : messages;

    // Extract totals from turn messages
    let inputTokens = 0;
    let outputTokens = 0;
    let cacheRead = 0;
    let cacheWrite = 0;
    let providerCost = 0;
    let model = 'unknown';
    let thinkingTokens = 0;
    const toolsUsed = new Set<string>();

    for (const msg of turnMessages) {
      if (!msg) continue;

      if (msg.usage) {
        inputTokens += msg.usage.input || 0;
        outputTokens += msg.usage.output || 0;
        cacheRead += msg.usage.cacheRead || 0;
        cacheWrite += msg.usage.cacheWrite || 0;
        if (msg.usage.cost?.total) {
          providerCost += msg.usage.cost.total;
        }
      }

      if (msg.model && model === 'unknown') {
        model = msg.model;
      }

      // Extract tools used
      if (msg.role === 'assistant' && Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if ((block?.type === 'toolCall' || block?.type === 'tool_use') && block.name) {
            toolsUsed.add(block.name);
          }
          if (block?.type === 'thinking') {
            // Count thinking tokens if available
            if (typeof block.thinking === 'string') {
              // Rough estimate: ~4 chars per token
              thinkingTokens += Math.ceil(block.thinking.length / 4);
            }
          }
        }
      }
    }

    // Normalize model name
    const normalizedModel = normalizeModelName(model, pricing);

    // Calculate cost
    const { cost, source } = getCost(
      model, inputTokens, outputTokens, cacheRead, cacheWrite,
      providerCost > 0 ? providerCost : undefined,
    );

    // Detect trace type
    const traceType = detectTraceType(sessionKey, turnMessages);

    // Detect sub-agent
    const isSubAgent = sessionKey.includes(':subagent:');
    let parentSession: string | null = null;
    if (isSubAgent) {
      const parts = sessionKey.split(':subagent:');
      if (parts.length > 0) {
        parentSession = parts[0] + ':main';
      }
    }

    const record: CostRecord = {
      v: 2,
      id: generateId(),
      ts: Math.floor(Date.now() / 1000),
      sk: sessionKey,
      m: normalizedModel,
      in: inputTokens,
      out: outputTokens,
      cr: cacheRead,
      cw: cacheWrite,
      c: Math.round(cost * 1_000_000) / 1_000_000, // Round to 6 decimal places
      src: source,
      tt: traceType,
      tools: Array.from(toolsUsed),
      dur: durationMs,
      sub: isSubAgent,
      par: parentSession,
      pv: pricing.version,
      th: thinkingTokens,
    };

    writeRecord(record);
    return record;
  } catch (err: any) {
    console.error(`[pinch] Error tracking agent_end: ${err.message}`);
    return null;
  }
}

function detectTraceType(sessionKey: string, messages: any[]): 'chat' | 'heartbeat' | 'cron' | 'subagent' {
  if (sessionKey.includes(':subagent:')) return 'subagent';

  // Check for heartbeat pattern
  const userMsg = messages.length > 0 ? null : null; // Messages are already turn-only
  // Look at the full session key for cron patterns
  if (sessionKey.includes(':cron:') || sessionKey.includes('cron-')) return 'cron';

  // Detect heartbeat from user message content
  for (const msg of messages) {
    if (msg?.role === 'user' || msg?.role === 'human') {
      const content = typeof msg.content === 'string' ? msg.content :
        Array.isArray(msg.content) ? msg.content.map((b: any) => b?.text || '').join('') : '';
      if (content.includes('Read HEARTBEAT.md') || content.includes('heartbeat')) {
        return 'heartbeat';
      }
    }
  }

  return 'chat';
}

function generateId(): string {
  return Math.random().toString(36).substring(2, 10);
}
