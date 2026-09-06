# Runbook

**v1.0.0.** What to check, what breaks, and what to do about it.

## Is it working?

Three URLs answer that.

- **`/ops`** — the honest one. The headline check is **articles collected in
  the last hour**, not whether the bindings respond, because every binding can
  be green while the pipeline has quietly stopped.
- **`/pulse`** — the collection cycle as it happens: how many sources are
  inside the two-minute interval, what the last dispatches carried, and a bar
  per minute of arrivals for the last half hour. A stall shows up as a visible
  gap rather than as a number you have to interpret. It refreshes itself.
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

## Ingestion and duplicates

**Every source is polled every two minutes.** All of them, on one interval —
there is no tiering. `/ops` shows the observed figure and, next to it, the
sweep capacity.

Capacity is derived rather than fixed: the scheduler ticks every minute against
a two-minute interval, so a full sweep needs half the fleet per tick, and the
limit is computed from the live source count with 25% headroom. A hard-coded
number silently breaks the cadence the moment the list grows past it — which is
not hypothetical, since the source list grows on its own every week. `/ops`
turns that check red rather than letting the sweep quietly fall behind.

**The source list expands by itself.** Aggregator feeds link out to whatever a
technical audience found worth reading, so a domain that appears there
repeatedly is a candidate. The weekly pass probes each one for a feed, verifies
it parses with at least three usable items, and adds at most ten. New sources
start at low weight and have to earn their place — the same weekly pass
promotes what gets corroborated and retires what stops answering.

Three guards keep it from becoming a firehose of blogs: a sighting threshold
(one link is somebody's weekend project), a denylist of platforms (github.com
is where publishers keep their code, not a publisher), and the weekly cap.

Coverage is judged on **who produced an article, not on the feed's address**. A
publisher's feed usually lives somewhere else entirely — Ars Technica publishes
at arstechnica.com but feeds from feeds.arstechnica.com, and The Hacker News
feeds from feedburner.com — so comparing hostnames re-proposed five publishers
we already had. If any non-aggregator source has produced an article on a host,
that host is covered whatever its feed looks like.

Conditional GET makes the steady state nearly free: a feed that has not
published answers `304` with no body. A source that fails backs off
exponentially to a six-hour ceiling and honours `Retry-After`, so a
rate-limiting origin removes itself from the fast lane without any tiering to
maintain.

Duplicates are stopped at four different levels, because they arrive in four
different shapes:

| shape | caught by |
|---|---|
| the same item at the same URL, seen again on the next poll | `url_hash` UNIQUE + `ON CONFLICT DO NOTHING` |
| the same item at a URL dressed with tracking parameters, AMP, or a redirector | canonicalization before hashing |
| the same item reposted by one source at a *different* URL | same source + same headline within 48 hours |
| the same event covered by several different outlets | **not dropped — clustered**, which is the entire point |

The last row is the important distinction. Two outlets covering one story are
not a duplicate to be discarded; they are corroboration, and the portal is
built to show it. Only a single publisher repeating *itself* is a duplicate.

The 48-hour repost window was measured rather than chosen. In the live corpus
the only genuine same-source duplicate — a link posted twice to r/devops — was
**0.3 hours** apart, while the legitimate repeats were Rock Paper Shotgun's
weekly columns at **exactly 168 and 169 hours**. Any boundary between those
works; 48 hours sits clear of both.

To check the current state:

```sql
SELECT COUNT(*) AS articles, COUNT(DISTINCT url_hash) AS distinct_urls FROM articles;
SELECT source_id, title, COUNT(*) FROM articles GROUP BY 1, 2 HAVING COUNT(*) > 1;
```

The first two numbers must match. The second query should return only titles
that are genuinely recurring columns, days apart.

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
