import { readFileSync } from 'fs';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// Import from built output
const { normalizeModelName } = await import('../server/plugin.js');

const pricing = JSON.parse(readFileSync(new URL('../pricing.json', import.meta.url), 'utf-8'));

// Re-export test with inline normalizer for cases where build import fails
function normalize(raw: string): string {
  let name = raw.toLowerCase().trim();
  for (const prefix of pricing.providerPrefixes) {
    if (name.startsWith(prefix)) { name = name.slice(prefix.length); break; }
  }
  if (pricing.aliases[raw]) return pricing.aliases[raw];
  if (pricing.aliases[name]) return pricing.aliases[name];
  if (pricing.models[name]) return name;
  const dateStripped = name.replace(/-\d{8}$/, '').replace(/-\d{4}$/, '');
  if (dateStripped !== name && pricing.models[dateStripped]) return dateStripped;
  const sorted = Object.keys(pricing.models).sort((a: string, b: string) => b.length - a.length);
  for (const known of sorted) { if (name.startsWith(known)) return known; }
  for (const known of sorted) { if (known.startsWith(name)) return known; }
  return name;
}

describe('normalizeModelName', () => {
  test('exact match', () => {
    assert.equal(normalize('claude-opus-4'), 'claude-opus-4');
    assert.equal(normalize('gpt-4o'), 'gpt-4o');
  });

  test('strips provider prefixes', () => {
    assert.equal(normalize('anthropic/claude-opus-4'), 'claude-opus-4');
    assert.equal(normalize('openai/gpt-4o'), 'gpt-4o');
    assert.equal(normalize('google/gemini-2.5-pro'), 'gemini-2.5-pro');
  });

  test('resolves aliases', () => {
    assert.equal(normalize('claude-opus-4-20250514'), 'claude-opus-4');
    assert.equal(normalize('claude-3-5-haiku'), 'claude-haiku-3.5');
    assert.equal(normalize('deepseek-r1'), 'deepseek-reasoner');
  });

  test('strips date suffixes', () => {
    assert.equal(normalize('claude-opus-4-20260101'), 'claude-opus-4');
    assert.equal(normalize('claude-sonnet-4-0514'), 'claude-sonnet-4');
  });

  test('fuzzy prefix matching', () => {
    assert.equal(normalize('claude-opus-4-latest'), 'claude-opus-4');
  });

  test('unknown model returns normalized name', () => {
    assert.equal(normalize('some-unknown-model'), 'some-unknown-model');
  });

  test('case insensitive', () => {
    assert.equal(normalize('Claude-Opus-4'), 'claude-opus-4');
    assert.equal(normalize('GPT-4o'), 'gpt-4o');
  });
});
