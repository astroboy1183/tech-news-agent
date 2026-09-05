# Release Plan

**Ten releases to 1.0.** Semantic versioning, one release per phase, every one
tagged and deployed. `v0.1` through `v0.5` are GitHub **pre-releases** — the
pipeline works but there is nothing to look at. **`v0.6` is the first release you
would actually open.**

## How releases work

| | |
|---|---|
| **Branching** | `main` is always deployable. Work on `feat/*` or `fix/*`, open a PR, squash-merge. |
| **Deploy** | Every merge to `main` deploys to production automatically. There is no separate staging — a Worker version is cheap to roll back. |
| **Tagging** | `git tag v0.3.0 && git push --tags` triggers the release workflow: build, deploy, then create the GitHub Release. |
| **Notes** | Generated from Conventional Commit messages since the previous tag, then edited by hand before publishing. |
| **Rollback** | `wrangler rollback` reverts the Worker in seconds. D1 migrations are forward-only, so every migration must be additive. |

**Commit convention.** `feat:`, `fix:`, `perf:`, `refactor:`, `docs:`, `test:`,
`chore:`. The scope is the phase area — `feat(collect): add WebSub subscriber`.
This is what makes generated release notes readable.

---

## v0.1.0 — Foundation · *pre-release*

**Phase 0 · ~0.5 day**

Deployed Worker with the full schema behind it. Nothing user-facing.

- React Router v7 on Workers, with `scheduled` and `queue` handlers wired
  alongside `fetch` — the integration proved before anything is built on it
- D1 database, full migration including `articles_fts` and its triggers
- KV, R2 bucket, `collect` and `enrich` queues, Vectorize index
- `GET /health` reporting every binding
- ~200 seed sources loaded
- CI green, deploy pipeline working end to end

**Ship when** `/health` is green in production and CI deploys on merge.

## v0.2.0 — Collector · *pre-release*

**Phase 1 · ~4 days**

The database fills itself. Still no AI, still nothing to look at.

- Tiered scheduler, conditional GET, WebSub push
- RSS, Atom and JSON Feed parsing with adapters for HN, Reddit, GitHub, arXiv
- URL canonicalization and dedupe
- Headline normalisation on ingest
- Rule-based section and topic classification
- Bulk OPML import
- **`/raw` — the reality check.** Composition slots filled with live data, no CSS
- **The headline census** committed to the repo as a document

**Ship when** 24 hours unattended yields ~7,900 rows and re-running adds zero.

## v0.3.0 — Clusters · *pre-release*

**Phase 2 · ~2 days**

Eight outlets covering one story become one story.

- Trigram candidate detection, embeddings for the ambiguous cases
- Vector search resolution, cluster records, arrival timelines
- Corroboration and velocity scoring

**Ship when** clusters average >1.8 members and 30 spot-checks show no false merges.

## v0.4.0 — Summaries · *pre-release*

**Phase 3 · ~2.5 days**

The first release that costs money.

- Per-section budget allocation with floors
- Cluster-level summarization through the Batch API
- KV spend ledger with a hard daily cap
- Prompt caching verified working

**Ship when** a full week stays under $0.45/day with every section clearing its floor.

## v0.5.0 — Editorial engine · *pre-release*

**Phase 4 · ~2.5 days**

The front page composes itself.

- Five lead gates, manual pin override
- Slot filler across 73 positions with no story repeated
- Empty states for every slot
- Image pipeline with R2 fallback
- Composition cached in KV every 10 minutes
- `GET /api/frontpage.json`

**Ship when** the API returns a correct front page and the pin works.

---

## v0.6.0 — The Portal · **first real release**

**Phase 5a + 5b · ~4.5 days**

The first version you open in the morning.

- Paper and Ink themes, toggle persisted
- The front page, image-led, 73 stories
- Story cards in both states, line-clamped
- All ten section pages with topic filters
- **`/story/:id`** — cluster pages with arrival timelines
- `/live` and `/digest`
- `j`/`k` navigation

**Ship when** you read it by choice rather than to test it.

## v0.7.0 — Discovery

**Phase 5c · ~1.5 days**

Finding things and keeping them.

- Full-text search with `bm25()` ranking
- Topic pages, archive, any past day
- Saved list, click tracking, feedback capture
- RSS for the portal, every section and every topic

## v0.8.0 — Operations

**Phase 5d · ~1 day**

- `/sources` with OPML import and per-feed controls
- `/dashboard` — KPIs, funnel, budget by section, latency
- Phone layout at 390px

## v0.9.0 — Delivery

**Phases 6 + 7 · ~2.5 days**

It comes to you instead of you going to it.

- Slack: daily digest by section, slash commands, breaking channel, feedback buttons
- Email: daily HTML digest, double opt-in, one-click unsubscribe *(needs a domain)*

**Release candidate.** Everything but the learning loop.

---

## v1.0.0 — The Agent

**Phases 8 + 9 · ~4 days**

1.0 means it runs unattended and gets better on its own.

- Weekly preference pass reshaping ranking, budget allocation and lead contention
- Weekly gap sweep proposing sources via Slack approve/reject
- Source self-repair and weight adjustment
- Nightly D1 backup to R2 with a **verified restore**
- Tests on the six correctness-critical modules
- Retention policy, rate limiting, error budget, runbook

**Ship when** you can ignore it for a month and it is still right.

---

## After 1.0

| Version | Theme |
|---|---|
| **v1.1** | Source expansion past 514 — OPML packs per section |
| **v1.2** | Better clustering: tuned thresholds, cross-language matching |
| **v1.3** | Reading history and a genuinely personal front page |
| **v1.4** | Public sharing — clean permalinks, OG cards, optional public mode |
| **v2.0** | Only if the data says so: Postgres migration when D1's ceiling nears |

## Timeline

Sequential, at one focused day per working day:

| Milestone | Cumulative |
|---|---|
| v0.1 Foundation | day 1 |
| v0.2 Collector | day 5 |
| v0.3 Clusters | day 7 |
| v0.4 Summaries | day 10 |
| v0.5 Editorial | day 12 |
| **v0.6 Portal** | **day 17** |
| v0.7 Discovery | day 18 |
| v0.8 Operations | day 19 |
| v0.9 Delivery | day 22 |
| **v1.0 Agent** | **day 26** |

Evenings and weekends only, that is roughly **three months** to 1.0 — and
something readable at **v0.6**, about six weeks in.
