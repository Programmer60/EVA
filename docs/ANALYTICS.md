# EVA Analytics — Investigations & Examples

This document describes the analytics surfaces added in Phase 5.5, common investigation workflows, example queries, and where to place screenshots used for documentation.

> Note: Analytics and memory debug endpoints are internal tooling. Protect or disable them in public deployments.

## Overview

EVA collects per-turn telemetry (`TurnAnalytics`) and produces aggregated metrics via the analytics service. Key telemetry elements include:

- `replyMode` — selected reply strategy (REFLECTION, OPINION, CURIOSITY, SUGGESTION, etc.)
- `tone` — tone style for the reply (calm, playful, direct, etc.)
- `bondScore` — numeric bond signal with the current browser identity
- `memoriesRetrieved` — count/list of memory ids retrieved for the turn
- `providerUsed` — LLM provider chosen for the turn
- `latency` — provider/response latency in ms
- emotion tags — inferred emotion distribution for the turn

Aggregations computed by `GET /api/analytics` include totals, averages, distributions, trends, and recent-turn samples.

## Files & models

- `lib/models/TurnAnalytics.ts` — per-turn telemetry schema
- `lib/analytics/analyticsService.ts` — aggregation helpers and overview builder
- `app/api/analytics/route.ts` — analytics API handler
- `app/dashboard/page.tsx` — dashboard UI (cards, trends, recent-turn samples)

## How to access

Dashboard UI (local dev):

- Open the running app and navigate to:

  `/dashboard`

Analytics API:

- `GET /api/analytics`
  - Query params:
    - `userId` (optional): scope aggregation to a single browser identity.
    - `limit` (optional): number of recent-turn samples to include (default 50).

Examples:

Global aggregates (last 100 turns):

```bash
curl -sS "http://localhost:3000/api/analytics?limit=100" | jq
```

Per-browser analytics (replace `<your-local-userId>`):

```bash
curl -sS "http://localhost:3000/api/analytics?userId=<your-local-userId>&limit=50" | jq
```

Prometheus metrics (scrape):

- Metrics path: `GET /api/metrics`
- Important metric names:
  - `eva_provider_latency_seconds_bucket`
  - `eva_provider_errors_total`
  - `eva_provider_failures_total`

Prometheus scrape example:

```yaml
scrape_configs:
  - job_name: 'eva-ai'
    metrics_path: /api/metrics
    static_configs:
      - targets: ['localhost:3000']
```

## Memory debug endpoint & computed profile

- `GET /api/memory?userId=<id>&limit=<n>` — fast, returns raw memory facts.
- Add `profile=true` to include a computed profile snapshot (heavy aggregation):

```bash
curl -sS "http://localhost:3000/api/memory?userId=<your-local-userId>&limit=200&profile=true" | jq
```

Caution: `profile=true` runs resource-heavy aggregation; keep it opt-in for debugging.

## Quick investigation recipes

1) Find recent turns for a user and inspect reply modes and emotions:

```bash
curl -sS "http://localhost:3000/api/analytics?userId=<id>&limit=50" | jq '.recentTurns[] | {createdAt, replyMode, tone, bondScore, emotions, memoriesRetrieved, providerUsed, latency}'
```

2) Top retrieved memories (global):

- The analytics aggregation exposes `mostRetrievedMemories` with counts; example filter:

```bash
curl -sS "http://localhost:3000/api/analytics?limit=100" | jq '.mostRetrievedMemories | sort_by(-.count) | .[0:20]'
```

3) Bond score trend (per-user):

```bash
curl -sS "http://localhost:3000/api/analytics?userId=<id>&limit=200" | jq '.bondTrend'
```

4) Provider errors & latency checks (from Prometheus):

- In Prometheus, graph `eva_provider_errors_total` grouped by `provider` and inspect recent increases.
- For SLO checks, compute P95 from `eva_provider_latency_seconds_bucket` histogram.

## Dev utilities

- Find your browser `userId` (open DevTools → Console):

```js
// Print localStorage keys likely containing the user id
Object.keys(localStorage).filter(k => /eva|user|id/i.test(k)).forEach(k => console.log(k, localStorage.getItem(k)))

// If you know the key, e.g. 'eva_userId':
localStorage.getItem('eva_userId')
```

- Direct DB inspection (Mongo shell / mongosh):

```js
// Recent TurnAnalytics for a user
db.turnanalytics.find({ userId: "<id>" }).sort({ createdAt: -1 }).limit(50).pretty()
```

## Dashboard screenshots (placeholders)

Add screenshots under `docs/screenshots/` and reference them here. Suggested images:

- `docs/screenshots/dashboard-overview.png` — main dashboard with cards and trend charts
- `docs/screenshots/recent-turn-sample.png` — example recent-turn list with analytics metadata
- `docs/screenshots/memory-debug.png` — Memory Debug panel showing profile and raw facts

Example markdown image embed:

```md
![Dashboard overview](screenshots/dashboard-overview.png)
```

## Security & production notes

- The analytics and memory debug APIs are intended for internal use. Add authentication/ACLs before enabling in public environments.
- Disable or gate `profile=true` in production to avoid accidental heavy aggregations.
- For monitoring, create Prometheus alert rules for provider error spikes and P95/P99 latency breaches.

## Troubleshooting

- Empty analytics: verify `TurnAnalytics` documents are written and MongoDB is reachable.
- Empty metrics: confirm `prom-client` is available and `GET /api/metrics` returns text format output.
- If dashboard data looks stale, restart the app and check server logs for `analyticsService` errors.

---

If you'd like, I can also:

- Add example Grafana panels (JSON) for default dashboarding.
- Generate the placeholder screenshots using the running app (I can instruct how to capture them).

Tell me which of the above you'd like next.
