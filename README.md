# pinch

know what your agent costs. per session, per tool, per day.

openclaw plugin that tracks every token and dollar your agent spends. local-first, zero accounts, budget alerts.

## install

```bash
openclaw plugins install @safetnsr/pinch
```

no config needed. pinch starts tracking immediately.

## what you get

### cost tracking
every agent run, cron job, heartbeat, and sub-agent is recorded with:
- model used and token counts (input, output, cache read, cache write, thinking)
- cost in USD (from provider when available, calculated from built-in pricing table otherwise)
- session type detection (chat, cron, heartbeat, subagent)
- sub-agent costs attributed to parent session

### dashboard

open `http://localhost:3334` after install.

one page, no navigation:
- **KPI strip** — today / this week / this month cost, with deltas vs previous period
- **budget bar** — green/yellow/red progress (only shows if budget is set)
- **7-day chart** — area chart with 7d/30d/90d tabs
- **breakdown** — by model, type, or session with bar-fill rows
- **latest runs** — recent agent runs with cost per run

dark mode only. auto-refreshes every 30 seconds. 12KB single HTML file.

### agent tools

the agent knows what it costs:

**pinch_check** — "how much have i spent today?"
```
today: $4.82 (69% of $7.00 budget)
this week: $18.40
this month: $52.10

by model:
- claude-opus-4: $3.40 (71%)
- claude-sonnet-4: $1.20 (25%)
- claude-haiku-3.5: $0.22 (4%)
```

**pinch_breakdown** — "what's costing the most?"
```
top sessions today:
1. readme rewrite — $0.85
2. twitter cron (8 runs) — $0.72
3. heartbeats (48 runs) — $0.42
```

**pinch_budget** — "am i near my limit?"
```
daily: $4.82 / $7.00 (69%) — on track
projected: $6.20 today

suggestion: heartbeats cost $0.42/day — consider extending interval
```

### budget alerts

set a budget and get alerts in your chat (telegram, discord, whatever channel you use):

```
pinch: $5.60 of $7.00 today (80%). $1.40 left. top costs: readme rewrite ($0.85), twitter crons ($0.72).
```

alerts fire at 50%, 80%, and 100% of budget. deduplicated per day.

## config

everything is optional. pinch works with zero config.

```json
{
  "plugins": {
    "entries": {
      "pinch": {
        "config": {
          "budget": {
            "daily": 7.00,
            "weekly": 35.00,
            "monthly": 100.00
          }
        }
      }
    }
  }
}
```

### all options

```json
{
  "budget": {
    "daily": 0,                  // USD, 0 = unlimited
    "weekly": 0,
    "monthly": 0,
    "enforcement": "warn",       // "warn" | "throttle" | "block"
    "alertAt": [0.5, 0.8, 1.0]  // alert thresholds
  },
  "dashboard": {
    "enabled": true,
    "port": 3334
  },
  "pricing": {                   // override built-in pricing
    "my-local-model": { "input": 0, "output": 0 },
    "custom/model": { "input": 0.50, "output": 1.50 }
  },
  "retentionDays": 90            // raw records kept for 90 days
}
```

## pricing

pinch ships with pricing for 21 models across 7 providers:

| provider | models |
|----------|--------|
| anthropic | opus 4, sonnet 4, haiku 3.5 |
| openai | gpt-4o, 4o-mini, 4.1, 4.1-mini, 4.1-nano, o3, o4-mini |
| google | gemini 2.5 pro, 2.5 flash, 2.0 flash |
| deepseek | chat, reasoner |
| mistral | large, codestral |
| xai | grok-3, grok-3-mini |
| meta | llama-4 maverick, scout |

### cost resolution

1. **provider-reported** — if openclaw passes cost from the API response, pinch uses it (most accurate)
2. **calculated** — match model name against built-in pricing table
3. **config override** — user-defined pricing in plugin config
4. **unknown** — tokens tracked, cost = $0, warning logged

### model name handling

pinch normalizes model names automatically:
- strips provider prefixes: `anthropic/claude-opus-4` → `claude-opus-4`
- strips date suffixes: `claude-opus-4-20250514` → `claude-opus-4`
- resolves aliases: `claude-3-5-haiku` → `claude-haiku-3.5`

### updating pricing

pricing lives in `pricing.json` at the repo root. to add a model or update a price:

1. fork the repo
2. edit `pricing.json` — add the model with `effectiveDate` and `source` URL
3. PR — we merge pricing PRs quickly

or override locally in your config:

```json
{
  "pricing": {
    "new-model": { "input": 1.00, "output": 5.00 }
  }
}
```

## storage

all data stays on your machine:

```
~/.openclaw/data/pinch/
├── records/              # raw JSONL, one file per day
│   ├── 2026-02-21.jsonl
│   └── ...
├── aggregates/           # daily/weekly/monthly rollups
│   ├── daily/
│   ├── weekly/
│   └── monthly/
├── state.json            # in-memory state, budget alert tracking
└── pricing-history.json  # pricing version snapshots
```

- raw records: kept for 90 days (configurable)
- aggregates: kept forever (~400KB for 2 years)
- total disk usage: ~4MB after 2 years of heavy use

## development

```bash
git clone https://github.com/safetnsr/pinch
cd pinch
npm install
npm run build
npm test
```

## license

MIT
