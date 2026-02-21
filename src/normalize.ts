import type { PricingData } from './types.js';

/**
 * Normalize a model name to match pricing.json entries.
 * Handles provider prefixes, aliases, date suffixes, and fuzzy matching.
 */
export function normalizeModelName(raw: any, pricing: PricingData): string {
  if (!raw || typeof raw !== 'string') return 'unknown';
  let name = raw.toLowerCase().trim();

  // 1. Strip known provider prefixes (openrouter style)
  for (const prefix of pricing.providerPrefixes) {
    if (name.startsWith(prefix)) {
      name = name.slice(prefix.length);
      break;
    }
  }

  // 2. Check aliases (exact match on original or stripped)
  if (pricing.aliases[raw]) return pricing.aliases[raw];
  if (pricing.aliases[name]) return pricing.aliases[name];

  // 3. Exact match in models
  if (pricing.models[name]) return name;

  // 4. Strip date suffix: claude-opus-4-20250514 → claude-opus-4
  const dateStripped = name.replace(/-\d{8}$/, '').replace(/-\d{4}$/, '');
  if (dateStripped !== name && pricing.models[dateStripped]) return dateStripped;

  // 5. Fuzzy: find model that starts with same prefix
  // "claude-opus-4-latest" → match "claude-opus-4"
  const modelNames = Object.keys(pricing.models);
  // Prefer longer matches first (more specific)
  const sorted = modelNames.sort((a, b) => b.length - a.length);
  for (const known of sorted) {
    if (name.startsWith(known)) return known;
  }
  for (const known of sorted) {
    if (known.startsWith(name)) return known;
  }

  // 6. Unknown — return normalized but unmatched
  return name;
}
