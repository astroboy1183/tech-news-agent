# Development Plan

**A one-stop tech news portal.** Ten sections, unlimited sources, continuous
collection, an editorial system that composes the front page, and a hard
$20/month ceiling.

Companion to [PLAN.md](PLAN.md) — that document is *what and why*; this one is
*the order we build it in*. Effort is in **focused days**.
Total: **26–33 focused days**.

---

## The one structural change from the last version

The earlier plan built the website at Phase 4, on day 14. That meant **the layout
would not meet a real headline until two weeks in** — and real headlines are
ragged, 24 to 190 characters, full of colons and CVE numbers and appended outlet
names. Every front page that has ever broken, broke there.

So Phase 1 now ends with an **ugly but real front page**: no styling, no images,
just the composition slots filled with live feed data. It exists to answer one
question on day 4 instead of day 14 — *does this hold up?* Everything downstream
is designed against what that shows.

That single reordering is the difference between a portal that works and one
that looked good in a mockup.

---

## The four constraints that shape everything

**1. Unlimited sources, $20/month.** Collection is nearly free; only AI scales
with volume. The pipeline runs at two speeds and the AI half is budget-governed.
Adding a source costs nothing.

**2. ~510 summaries a day out of ~7,900.** That is 6%. The other 94% must read
as complete, not degraded. The compact card is the *normal* card.

**3. Every section gets summaries every day.** AI & ML alone would eat the whole
budget on volume, so the budget is allocated per section — a floor each, then a
merit pool.

**4. Nobody edits the front page.** So the rules that fill it have to be good,
inspectable, and overridable by hand in three seconds.

---

## Tech stack

All Cloudflare, one platform, no servers.

| Layer | Choice | Why |
|---|---|---|
| **Compute** | Workers — `fetch`, `scheduled`, `queue` | One runtime for site, cron and pipeline |
| **Database** | D1 (SQLite) + FTS5 | Relational, and full-text search without a second service |
| **Queues** | Cloudflare Queues | Decouples collect → cluster → enrich |
| **Vectors** | Vectorize + Workers AI `bge-small` | Semantic clustering; embeddings inside the free 10k neurons/day |
| **Cache / counters** | KV | Conditional-GET etags, spend ledger, composed front page |
| **Objects** | R2 | Thumbnail cache for hotlink-blocked sources, nightly D1 backups |
| **Language** | TypeScript, frontend and backend | One `Article` type used by collector, summarizer and component |
| **Web** | React 19 + React Router v7, SSR then hydrate | File routes and loaders; the composed page is cached in KV, so render cost is paid once per 10 minutes |
| **ORM** | Drizzle over D1 | Typed queries and real migrations |
| **Libraries** | Zod · fast-xml-parser · `@anthropic-ai/sdk` | Validation, feed parsing, summaries |
| **Tests** | Vitest + `@cloudflare/vitest-pool-workers` | Runs in the real Workers runtime, not a mock |
| **Identity** | Cloudflare Access | Free to 50 users, zero auth code |
| **AI** | `claude-haiku-4-5` | Summaries and cluster adjudication, budget-capped |

**Rejected, and why.** *Postgres + pgvector* — better archive ceiling and real
FTS, but adds a vendor, connection pooling and ~$20/mo that the AI budget needs
more. *A VPS* — no platform limits, but you own uptime and patching. *Next.js on
Vercel* — good DX, worse cron and a $20/mo Pro tier for what Workers does at $5.
Revisit Postgres only if D1's 10 GB ceiling actually bites, which retention
should prevent for three years.


### The first thing to prove

React Router v7's Cloudflare template gives you a `fetch` handler. This project
also needs `scheduled` and `queue` exported from the same Worker, which is
straightforward but is not the template's default shape. **Wire and deploy that
before building anything on top of it** — it is an hour, and it is what Phase 0
exists for.

### What $20 buys

| Item | Monthly |
|---|---|
| Workers Paid — Queues, D1, KV, Vectorize access | $5.00 |
| D1 rows written — ~24K/day | $0.72 |
| Vectorize — clustering only, selective | ~$0.50 |
| R2 — thumbnail cache + backups | ~$0.30 |
| Workers AI embeddings | $0.00 — inside the free allocation |
| **Claude Haiku — everything left** | **$13.50** |

~510 cluster summaries a day, and only because of three decisions together:
summaries capped at ~130 output tokens (**output is 70% of the cost**),
summarizing the **cluster** not each article, and 85% through the Batch API.

---

## Dependency map

```
P0 Scaffold
 └─► P1 Collector + REALITY CHECK ──► P2 Cluster ──► P3 Summarizer
                                                       │
                                          P4 Editorial engine
                                                       │
                          ┌────────────────────────────┼──────────────┐
                          ▼                            ▼              ▼
                     P5 Website ──► P9 Hardening   P6 Slack      P7 Email
                          │                            │         (needs domain)
                          └──────────┬─────────────────┘
                                     ▼
                              P8 Agent loop
```

---

## Phase 0 — Scaffold · 0.5 day

1. `npm create cloudflare@latest` — Hono, TypeScript.
2. **Upgrade to Workers Paid.** Hard prerequisite.
3. Create D1, KV, R2 bucket, `collect` and `enrich` queues, Vectorize index
   (`bge-small`, 384 dims).
4. `migrations/0001_init.sql` — full schema including `articles_fts` and its
   sync triggers. Write the triggers now; backfilling FTS later is miserable.
5. `GET /health` — D1, KV, R2, Vectorize, last run per stage.
6. `sources.seed.json` — ~200 feeds across ten sections. Seed and deploy.

**Done when** `/health` is green in production and `sources` counts ~200.

---

## Phase 1 — Collector, ending in a reality check · 4 days

### Fetching
1. **Tiered scheduler** — cron every minute picks sources where `next_poll_at`
   has passed. Tiers A 2–5 min, B 15 min, C hourly, D 6–24 h. Intervals adapt.
2. **Conditional GET** — 304 is success-with-no-work. Content-hash fallback.
3. **WebSub** at `POST /websub` with signature verification and renewal.
4. **Politeness** — per-domain floor, honour `Retry-After`, hard 429 backoff,
   real User-Agent with a contact URL.

### Parsing
5. Parsers to one shape: RSS 2.0, Atom, JSON Feed.
6. Adapters: HN Algolia, Reddit, GitHub releases, **arXiv**, Google News, Lobste.rs.
7. **Bulk OPML import** — what makes "unlimited sources" true rather than aspirational.
8. URL canonicalizer → SHA-256 → unique index.
9. **Headline normalisation on ingest** — strip appended outlet names, collapse
   ALL-CAPS to sentence case, straighten quotes, drop trailing ellipses, lift
   `EXCLUSIVE —` prefixes into a badge field. Store both raw and normalised.
10. **Rule-based section + topic classification** and a heuristic score at insert.
    No AI, so every article is usable the moment it lands.

### The reality check — this is the point of the phase
11. `GET /raw` — the composition slots filled with live data. **No CSS.** Lead,
    two secondaries, four across, ten section blocks, latest rail.
12. **Headline census.** Dump 500 real headlines and measure: character-length
    distribution, longest token, how many arrive ALL-CAPS, how many carry the
    outlet name, how many have no thumbnail.
13. **Feed the census back into the design.** Set the lead clamp, the row clamp
    and the thumbnail fallback from real numbers, not from placeholder copy.

**Done when** 24 hours unattended yields ~7,900 rows each with a section and a
score; re-running adds **zero**; and `/raw` shows a front page you can read,
built from real headlines, with the census numbers written down.

**Watch out for** feeds that lie about encoding, use six date formats, or omit
GUIDs. Wrap every source so one bad feed cannot fail a run.

---

## Phase 2 — Cluster · 2 days

Before summarizing, because we summarize clusters, not articles. That ordering
is most of why $20 works.

1. **Title-trigram similarity** in a 48-hour window flags candidates. Pure SQL.
2. **Embeddings only for the ambiguous ones** — `bge-small`, ~600–800/day,
   inside the free allocation.
3. **Vector search** resolves candidates into clusters. No LLM call in this phase.
4. Cluster records: primary by source weight and completeness; members keep
   their own headlines and links.
5. **Arrival timeline** per cluster — first-seen and per-source offsets. This is
   what the story page renders.
6. Corroboration and **velocity** scores — sources per hour, not just total.

**Done when** clusters average >1.8 members on genuinely duplicated stories, 30
spot-checked clusters show no false merges, and the timeline reads correctly.
**Cost: ~$0.**

**Watch out for over-merging.** Two Nvidia announcements on one day are not one
story. A missed merge is an annoyance; a false merge hides news.

---

## Phase 3 — Summarizer · 2.5 days

1. **Per-section allocation** — a floor of ~40 summaries per section per day, then
   a merit pool of ~110 by your read rate. Recomputed nightly.
2. **Merit selection** within a section — corroboration, velocity, score, recency.
   A cron every 10 minutes enqueues only what the remaining allocation affords.
3. **Summarize the cluster.** One call covers every member.
4. Cost discipline together: system prompt above **1,024 tokens** so caching
   engages; `max_tokens` ~130; 85% Batch API.
5. **Spend ledger in KV.** At the cap, selection stops; the fast path is untouched.
6. The same call confirms the rule-based section and refines topics.

**Done when** ~510 summaries land daily, every section clears its floor, and a
week of ledger stays under $0.45/day. Verify `cache_read_input_tokens > 0`.

**Watch out for** anything in a summary that is not in the source excerpt —
store the excerpt each summary came from. Batch results arrive out of order;
key by `custom_id`.

---

## Phase 4 — Editorial engine · 2.5 days

**New phase, and the one that makes this a portal rather than a ranked list.**

1. **The five lead gates** — 3+ independent sources; has a summary; under 6 hours
   *or still gaining sources*; not the same section as yesterday's lead unless it
   wins by 25%; not muted by preferences.
2. **Manual pin** — one click pins any story as lead for 12 hours, overriding all
   five, with a visible marker that the page is not running on rules.
3. **Slot filler** — lead → 2 hero secondaries (different sections) → 4 across
   (four unused sections) → 10 section blocks × 5 → 12-item latest rail → 4 most
   covered. Each slot removes its picks from the pool below. **No story twice.**
4. **Empty states**: no story clears the gates → lead collapses, four-across
   promotes; quiet section → shows what it has and says so; no image → thumbnail
   dropped, not greyed.
5. **Image pipeline** — extract `media:thumbnail` / `og:image`, validate
   dimensions and content-type, hotlink by default with `loading="lazy"` and a
   referrer policy, and cache to R2 only for sources that block hotlinking.
6. **Composition cache** — the whole front page recomposed every 10 minutes into
   KV, so a page view is one KV read rather than fifteen D1 queries.

**Done when** `/api/frontpage.json` returns 73 stories with no duplicates, every
slot filled or correctly collapsed, and the pin works.

---

## Phase 5 — Website · 6–7 days

Eighteen screens. Built against the Phase 1 census, so the type is already sized
for real headlines.

**5a — Shell and front page (2.5d).** Token CSS for Paper (default) and Ink, all
three theme states; toggle persists. The front page. The two-state story card,
line-clamped everywhere. `j`/`k` navigation.

**5b — Sections and stories (2d).** `/section/:s` for all ten with topic chips;
**`/story/:id`** — the cluster page with the arrival timeline; `/live`;
`/digest`.

**5c — Finding and keeping (1.5d).** `/search` over FTS5 with `bm25()`;
`/topic/:t`; `/archive`; `/d/:date`; `/saved`; RSS for every section and topic.

**5d — Ops and mobile (1d).** `/sources` with OPML import; `/dashboard`; the
phone layout at 390px — front page, not a feed.

**Done when** every route renders with real data, the theme survives a reload,
and **you read it in the morning by choice.**

---

## Phase 6 — Slack · 1.5 days

Manifest, single bot token. **v0 HMAC over the raw body** with a 5-minute replay
window — read the body before any JSON parsing. **3-second ack**, work in
`ctx.waitUntil()`, post via `response_url`. Block Kit digest by section;
`/technews`, `<section>`, `live`, `search`, `sources`. Breaking pushes to a
separate channel at 3+ sources within an hour.

## Phase 7 — Email · 1 day · *needs a domain*

Domain onboarded, SPF and DKIM, `send_email` binding. Table layout, inline
styles, plain-text alternative. Subscriber table, double opt-in, one-click
unsubscribe.

## Phase 8 — Agent loop · 2 days

Feedback aggregated per source, section and topic. A **weekly preference pass**
rewrites a preferences document that feeds the scoring prompt, shifts the
per-section budget, and can mute a topic out of lead contention. Source weights
move within 0.3–2.0. A **weekly gap sweep** proposes new sources as Slack
approve/reject buttons. Self-repair after three failures.

**Watch out for feedback loops eating themselves.** Reserve 2 slots per section
for high-scoring stories your preferences do *not* favour.

## Phase 9 — Hardening · 2 days

Nightly D1 export to R2 with **one verified restore**. Rate limiting. Unit tests
on parsers, canonicalizer, normaliser, classifier, scorer and slot filler — the
six places a silent bug corrupts data. End-to-end run against fixture feeds.
**Retention: keep summaries and metadata, drop raw excerpts after 90 days** — D1
caps at 10 GB and 7,900/day reaches it in about three years otherwise. Error
budget on `/health`. A runbook.

---

## Milestones

| # | After | You have |
|---|---|---|
| M1 | P1 | ~7,900 articles/day arriving, **and a real front page proving the layout** |
| M2 | P2 | Duplicates collapsed, arrival timelines — still $0 of AI |
| M3 | P3 | Summaries on what matters, every section fed, under cap |
| M4 | P4 | A front page that composes itself, with a pin for when it's wrong |
| M5 | P5 | The portal you read every morning |
| M6 | P6 / P7 | It comes to you |
| M7 | P8 | It learns what you read |
| M8 | P9 | You can stop thinking about it |

## Decisions and when they block

| Decision | Needed by |
|---|---|
| Workers Paid upgrade | **P0** — hard prerequisite |
| Public, or behind Cloudflare Access | **P5c** — determines how `/saved` knows you |
| Digest time (assumed 08:00 IST) | P6 |
| Domain, or not | P7 — everything else ships without one |

## Explicitly not in v1

Full-text scraping beyond excerpt fetch · multi-user accounts · a native mobile
app · push notifications · comments · translation · podcast and video sources ·
semantic search across the whole archive (embeddings are for clustering only, to
stay inside the free allocation).
