# Runbook

**v1.0.0.** What to check, what breaks, and what to do about it.

## Is it working?

Two URLs answer that.

- **`/ops`** — the honest one. The headline check is **articles collected in
  the last hour**, not whether the bindings respond, because every binding can
  be green while the pipeline has quietly stopped.
- **`/health`** — machine-readable: bindings, the day's spend, whether the
  summarizer and each delivery channel are configured.

If `/ops` says nothing has been collected in an hour, something is actually
wrong. Everything else on the page is context for why.

## The schedule

| cron | stage | what it does |
|---|---|---|
| `* * * * *` | schedule + cluster | claim due sources, enqueue them; cluster the last minute's arrivals |
| `*/10 * * * *` | websub + select | renew hub subscriptions; spend the day's remaining budget on summaries |
| `0 2 * * *` | maintain | prune vectors for closed clusters |
| `30 2 * * *` | deliver | compose the digest, post to Slack |
| `0 3 * * 1` | agent + prune | reweight sources from evidence, retire the dead, trim past retention |

Dispatch and clustering run under `Promise.allSettled`, so a failure in one
cannot stop the other. Each records its own run.

## Common failures

**Nothing is being collected.**
Check `/ops` → Stages. If `schedule` has not run in minutes, the cron is not
firing — confirm with `npx wrangler deployments list` that the latest deploy
kept its triggers. A `wrangler deploy --triggers ...` flag silently *replaces*
the cron list; that once reverted the scheduler to five-minute ticks.

**Sources failing en masse.**
Almost always one origin rate-limiting, not a code fault. Failures back off
exponentially to a six-hour ceiling and honour `Retry-After`, so a source
removes itself. If `/ops` shows many sources failing at once, check whether
they share a host.

**Clustering has stopped merging.**
`/ops` → Stories shows articles-per-story. If it collapses to 1.00, either the
embedding call is failing (check the `cluster` stage for an error) or Vectorize
is unreachable. Clustering degrades safely: every article still gets its own
cluster and stays visible, so this is untidy rather than urgent.

**A story is duplicated on the front page.**
Expected sometimes, and the cheap direction to be wrong in. Thresholds are
deliberately conservative because a *false* merge hides a story entirely. See
[CLUSTERING.md](./CLUSTERING.md) for the measurements.

**The budget is exhausted.**
Normal. `/ops` shows the cap and what remains. The portal is fully readable
with no summaries; the cap resets at midnight UTC. To change it, set the
`DAILY_CAP_MICROS` var — see [BUDGET.md](./BUDGET.md).

**Summaries are not appearing.**
`/health` reports `summarizer: disabled — ANTHROPIC_API_KEY not set` when the
key is missing. Set it with `npx wrangler secret put ANTHROPIC_API_KEY`.

## Backups

**D1 Time Travel is the backup**, and there is no separate nightly export.

Time Travel keeps a 30-day point-in-time restore on the paid plan at no extra
cost, restoring to any timestamp or bookmark. An R2 export would be a second,
worse copy of the same thing: staler, unverified unless someone actually
restores it, and costing storage for the privilege.

```bash
npx wrangler d1 time-travel info tech-news            # current bookmark
npx wrangler d1 time-travel restore tech-news --timestamp <ISO-8601>
```

**Everything except `articles` and `sources` is derived** and can be rebuilt by
running the pipeline: clusters, enrichments and the vector index are all
recomputable. `migrations/0004_drop_orphan_clusters.sql` exists precisely
because re-running clustering is a normal operation.

## Restoring from nothing

1. `npx wrangler d1 migrations apply tech-news --remote`
2. `pnpm seed:remote` — re-seeds sources from `sources.seed.json`
3. Wait. Collection fills within minutes; clustering follows within one tick.

## Costs

| | |
|---|---|
| Workers Paid | $5/month |
| Claude Haiku, capped | $13.50/month at $0.45/day |
| D1, KV, Queues, Vectorize, Workers AI | under $1.50/month at this volume |

The cap is enforced in code, checked before every call and booked from the
usage the API actually reported. A corrupt ledger entry reads as *fully spent*
rather than zero, because failing open there would spend the budget twice.

## What is deliberately not automated

- **Pinning a lead** writes to the database, so `/ops` is read-only until there
  is authentication. Set a pin directly against D1.
- **Email delivery** has nowhere to send from without a domain.
- **Adding sources** is a judgement call. `pnpm opml:import` takes an OPML file.

## The one thing worth watching

Corroboration rate. Clustering is what makes the budget work — one summary
covers every outlet that filed a story — so if the source list drifts toward
blogs and aggregators that never cover the same events, cost per useful summary
rises and the front page loses its best signal. `/ops` shows corroborated
stories against total; if that ratio falls, add mainstream outlets rather than
more feeds.
