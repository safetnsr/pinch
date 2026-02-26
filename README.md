# pinch

know what your agent costs — per session, per model, per day.

openclaw plugin that tracks every token and dollar your agent spends. no accounts, no cloud, no surprises.

```
$ pinch_check

today: $4.82 (69% of $7.00 budget)
this week: $18.40
this month: $52.10

by model:
  claude-opus-4-6    $3.40   71%
  claude-sonnet-4-6  $1.20   25%
  claude-haiku-3.5   $0.22    4%
```

![pinch dashboard](https://raw.githubusercontent.com/safetnsr/pinch/main/docs/dashboard.png)

---

## install

```bash
openclaw plugins install @safetnsr/pinch
```

no config needed. pinch starts tracking immediately.

open the dashboard at `http://localhost:3334`.

---

## what you get

### agent tools

three tools the agent can call directly:

**`pinch_check`** — current spend across today / week / month, with model breakdown

**`pinch_breakdown`** — top sessions by cost, useful for spotting expensive crons or heartbeats

```
top sessions today:
  1. readme rewrite         $0.85
  2. twitter cron (8 runs)  $0.72
  3. heartbeats (48 runs)   $0.42
```

**`pinch_budget`** — budget status with projection and optimization hints

```
daily: $4.82 / $7.00 (69%) — on track
projected: $6.20 today

suggestion: heartbeats cost $0.42/day — consider extending interval
```

### dashboard

one page at `http://localhost:3334`. kpi strip, budget bar, 7d/30d/90d trend chart, breakdown by model/type/session, latest runs. auto-refreshes every 30s. dark mode. 12KB single HTML file.

### budget alerts

alerts fire in your chat at 50%, 80%, and 100% of budget. deduplicated per day.

---

## config

everything is optional.

```json
{
  "budget": {
    "daily": 7.00,
    "weekly": 35.00,
    "monthly": 100.00,
    "enforcement": "warn",
    "alertAt": [0.5, 0.8, 1.0]
  },
  "dashboard": { "enabled": true, "port": 3334 },
  "pricing": {
    "my-local-model": { "input": 0, "output": 0 }
  },
  "retentionDays": 90
}
```

`enforcement`: `"warn"` logs only · `"throttle"` slows requests · `"block"` halts new sessions.

---

## how it works

**cost resolution order:**
1. provider-reported cost from api response (most accurate)
2. calculated from built-in pricing table
3. user config override
4. unknown model — tokens tracked, cost = $0

**model name normalization:**
- strips provider prefixes: `anthropic/claude-opus-4` → `claude-opus-4`
- strips date suffixes: `claude-opus-4-20250514` → `claude-opus-4`
- resolves aliases: `claude-3-5-haiku` → `claude-haiku-3.5`

**storage** — local only, `~/.openclaw/data/pinch/`. raw jsonl records (90d), daily/weekly/monthly aggregates (forever). ~4MB after 2 years of heavy use.

**pricing:** ships with 25+ models across 8 providers. to add or update:

```json
{
  "pricing": {
    "new-model": { "input": 1.00, "output": 5.00 }
  }
}
```

or open a PR — pricing PRs merge fast.

---

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
