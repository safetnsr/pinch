import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import type { PricingData, ModelPricing, PinchConfig } from './types.js';
import { normalizeModelName } from './normalize.js';

let pricingData: PricingData | null = null;
let userOverrides: Record<string, Partial<ModelPricing>> = {};
const warnedModels = new Set<string>();

/**
 * Load pricing.json from the package root
 */
export function loadPricing(overrides?: Record<string, Partial<ModelPricing>>): PricingData {
  if (!pricingData) {
    // pricing.json is at repo root, compiled output is in server/
    const thisDir = dirname(fileURLToPath(import.meta.url));
    // Try multiple paths (dev vs installed)
    const paths = [
      join(thisDir, '..', 'pricing.json'),
      join(thisDir, 'pricing.json'),
    ];
    
    for (const p of paths) {
      try {
        const raw = readFileSync(p, 'utf-8');
        pricingData = JSON.parse(raw) as PricingData;
        break;
      } catch { /* try next */ }
    }
    
    if (!pricingData) {
      throw new Error('[pinch] Could not load pricing.json');
    }
  }
  
  if (overrides) {
    userOverrides = overrides;
  }
  
  return pricingData;
}

export function getPricingData(): PricingData {
  if (!pricingData) loadPricing();
  return pricingData!;
}

/**
 * Calculate cost for a model usage.
 * 
 * @param model - Raw model name (will be normalized)
 * @param inputTokens - Input token count
 * @param outputTokens - Output token count
 * @param cacheRead - Cache read tokens
 * @param cacheWrite - Cache write tokens
 * @param providerCost - Cost reported by the provider (if available)
 */
export function getCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheRead: number = 0,
  cacheWrite: number = 0,
  providerCost?: number,
): { cost: number; source: 'provider' | 'calculated' | 'override' } {
  // Priority 1: provider-reported cost (most accurate)
  if (providerCost != null && providerCost > 0) {
    return { cost: providerCost, source: 'provider' };
  }
  
  const pricing = getPricingData();
  const normalized = normalizeModelName(model, pricing);
  
  // Priority 2: user overrides
  if (userOverrides[normalized]) {
    const o = userOverrides[normalized];
    const cost = calculateFromRates(
      inputTokens, outputTokens, cacheRead, cacheWrite,
      o.input ?? 0, o.output ?? 0, o.cacheRead, o.cacheWrite,
    );
    return { cost, source: 'override' };
  }
  
  // Priority 3: pricing.json
  const modelPricing = pricing.models[normalized];
  if (modelPricing) {
    const cost = calculateFromRates(
      inputTokens, outputTokens, cacheRead, cacheWrite,
      modelPricing.input, modelPricing.output,
      modelPricing.cacheRead, modelPricing.cacheWrite,
    );
    return { cost, source: 'calculated' };
  }
  
  // Unknown model
  if (!warnedModels.has(normalized)) {
    warnedModels.add(normalized);
    console.warn(`[pinch] Unknown model: "${model}" (normalized: "${normalized}") — cost will be $0`);
  }
  return { cost: 0, source: 'calculated' };
}

/**
 * Calculate cost from per-million-token rates
 */
function calculateFromRates(
  inputTokens: number,
  outputTokens: number,
  cacheRead: number,
  cacheWrite: number,
  inputRate: number,
  outputRate: number,
  cacheReadRate?: number,
  cacheWriteRate?: number,
): number {
  let cost = 0;
  cost += (inputTokens / 1_000_000) * inputRate;
  cost += (outputTokens / 1_000_000) * outputRate;
  if (cacheReadRate != null && cacheRead > 0) {
    cost += (cacheRead / 1_000_000) * cacheReadRate;
  }
  if (cacheWriteRate != null && cacheWrite > 0) {
    cost += (cacheWrite / 1_000_000) * cacheWriteRate;
  }
  return cost;
}
