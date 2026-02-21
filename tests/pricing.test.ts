import { readFileSync } from 'fs';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const data = JSON.parse(readFileSync(new URL('../pricing.json', import.meta.url), 'utf-8'));

describe('pricing.json', () => {
  test('has valid structure', () => {
    assert.ok(data.version > 0);
    assert.match(data.updatedAt, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(Object.keys(data.models).length > 0);
    assert.ok(Array.isArray(data.providerPrefixes));
  });

  test('all models have required fields', () => {
    for (const [name, model] of Object.entries(data.models) as any) {
      assert.ok(model.provider, `${name} missing provider`);
      assert.ok(model.input >= 0, `${name} invalid input`);
      assert.ok(model.output >= 0, `${name} invalid output`);
      assert.match(model.effectiveDate || '', /^\d{4}-\d{2}-\d{2}$/, `${name} invalid effectiveDate`);
    }
  });

  test('output >= input for all models (sanity check)', () => {
    for (const [name, model] of Object.entries(data.models) as any) {
      if (model.input > 0 && model.output > 0) {
        assert.ok(model.output >= model.input, `${name}: output ($${model.output}) < input ($${model.input})`);
      }
    }
  });

  test('all aliases point to real models', () => {
    for (const [alias, target] of Object.entries(data.aliases) as any) {
      assert.ok(data.models[target], `alias "${alias}" points to unknown model "${target}"`);
    }
  });

  test('has expected models', () => {
    const expected = ['claude-opus-4', 'claude-sonnet-4', 'gpt-4o', 'gemini-2.5-pro'];
    for (const m of expected) {
      assert.ok(data.models[m], `missing expected model: ${m}`);
    }
  });
});
