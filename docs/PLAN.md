# Tech News Agent — Build Plan

**Owner:** jayanth · **Drafted:** 2026-08-23 · **Timezone assumed:** IST (UTC+5:30)

An autonomous agent that sweeps the internet daily for news in three focus
areas, ranks and summarizes it, and delivers it as a website, a Slack bot,
an RSS feed, and an email digest.

## 1. The three lanes

Every article gets classified into exactly one primary lane (and may carry
secondary tags). The lanes drive collection, ranking, site navigation, Slack
commands, and per-lane feeds.

| Lane | Slug | Covers |
|---|---|---|
| Gadgets & Hardware | `hardware` | Phones, laptops, wearables, audio, cameras. CPUs, GPUs, motherboards, RAM, storage, PC building, homelab and servers, silicon and semiconductors. Launches, reviews, benchmarks |
| Technology | `tech` | AI/ML, software, big tech, startups, security, policy, space/science-adjacent |
| Operating Systems | `os` | Windows, macOS, Linux, Android, iOS, ChromeOS, BSD. Releases, updates, kernels, distros, desktop environments, filesystems |

## 2. Architecture

One Cloudflare Worker holds the whole system. It exposes four entrypoints
against shared storage.

```
                         ┌─────────────────────────────┐
   Cron Triggers ───────►│                             │
   (collect / enrich /   │      tech-news-agent         │
    curate / deliver)    │      (single Worker)         │
                         │                             │
   HTTPS  ──────────────►│  fetch()      → site + API   │
   (browser, Slack,      │  scheduled()  → pipeline     │──► Claude Haiku 4.5
    RSS readers)         │  queue()      → enrichment   │──► Slack Web API
                         │  assets       → css/js/img   │──► Email Sending
                         └──────────┬──────────────────┘
                                    │
              ┌─────────────────────┼──────────────────────┐
              │                     │                      │
         ┌────▼────┐          ┌─────▼─────┐          ┌─────▼─────┐
         │   D1    │          │    KV     │          │  Queues   │
         │ articles│          │ etags,    │          │ enrich    │
         │ digests │          │ budget,   │          │ jobs      │
         │ sources │          │ sessions  │          │           │
         └─────────┘          └───────────┘          └───────────┘
```

**Why one Worker:** the site, the API, the Slack endpoints and the cron
pipeline all read the same D1 database. Splitting them across services would
mean service bindings and duplicated schema access for no benefit at this
scale.

### The pipeline runs at two speeds

This is the central design decision. **Comprehensiveness is nearly free;
only AI summarization scales with volume.** So the two are decoupled: everything
collected appears on the site within seconds at no cost, and AI is spent, under a
hard budget, only on the stories that earn it.

**Fast path — free, continuous, no AI**

| Stage | Trigger | What it does |
|---|---|---|
| **Schedule** | cron, every minute | Select sources whose `next_poll_at` has passed, take a slice, enqueue them. Every source is on a two-minute interval; the slice keeps a backlog draining steadily rather than in one burst |
| **Collect** | queue consumer | Conditional GET, parse, canonicalize, dedupe by URL hash, classify lane by keyword rules, score heuristically, insert as `status='live'`. **The article is on the site now** |
| **Push** | `POST /websub` | WebSub hubs notify us the moment a supported feed publishes. Same collect path, zero polling latency |

**Slow path — budgeted, AI**

| Stage | Trigger | What it does |
|---|---|---|
| **Select** | cron, every 10 min | Rank `status='live'` articles; take the ones worth spending on — corroborated by 2+ sources, high heuristic score, or in a lane you read heavily — up to the remaining daily budget |
| **Enrich** | queue consumer | Haiku call → summary, why-it-matters, lane confirmation, tags → `status='enriched'`. The card on the site gains a summary a few minutes after appearing |
| **Cluster** | queue consumer | Adjudicate flagged near-duplicate pairs; merge into clusters |
| **Curate** | cron, 02:00 UTC | Assemble the daily digest from the day's enriched stories → `digests` |
| **Deliver** | cron, 02:30 UTC | Slack digest, email, plus breaking pushes for anything above the alert threshold |

Stages are decoupled through the `status` column, so any stage can be re-run
independently and a failure never strands the others. If the AI budget is
exhausted, the fast path keeps running — you get a complete feed with fewer
summaries, never an empty one.

### Polling tiers

Uniform polling is either too slow for the fast movers or rude to everyone else.
Each source carries a `poll_interval` and a `next_poll_at`:

| Tier | Interval | Sources | Examples |
|---|---|---|---|
| **A** | 2–5 min | ~40 | Hacker News, The Verge, Ars Technica, Reddit, Phoronix |
| **B** | 15 min | ~120 | Most publications |
| **C** | 1 hour | ~100 | Lower-velocity blogs, GitHub release feeds |
| **D** | 6–24 h | ~50 | LWN weekly, DistroWatch, changelogs, newsletters |

That is roughly **1,300 fetches an hour**, but conditional GET means an unchanged
feed returns a 304 costing almost nothing. Intervals adapt: a source that returns
new items every poll moves up a tier, one that has not changed in a week moves
down.

## 3. Sources

**Target: 300+ feeds.** Stored in D1 (`sources` table), seeded from
`sources.seed.json`, editable at runtime, and grown by the weekly gap sweep.
The list below is the launch seed — roughly 90 sources across the three lanes.
Getting from there to 300 is the job of the gap sweep (§12) plus bulk import
from public OPML collections, not hand-curation.

Expect **~3,500 articles a day** at that scale, after URL deduplication.

**Gadgets & Hardware:**
*Consumer devices* — The Verge, Engadget, Ars Technica (Gadgets), Notebookcheck,
GSMArena, Android Authority, XDA Developers, 9to5Mac, 9to5Google, Liliputing,
DPReview, iFixit, r/gadgets.
*PC & component hardware* — Tom's Hardware, TechPowerUp, VideoCardz,
Gamers Nexus, Hardware Unboxed, Level1Techs, r/hardware, r/buildapc.
*Silicon & deep analysis* — Chips and Cheese, SemiAnalysis, The Chip Letter,
IEEE Spectrum (semiconductors), AMD / Intel / NVIDIA newsrooms.
*Servers & homelab* — ServeTheHome, r/homelab.

**Technology:** Hacker News (front page + Algolia search), Ars Technica,
TechCrunch, Wired, The Register, MIT Technology Review, Reuters Technology,
Slashdot, Lobste.rs, Simon Willison's blog, Hacker Newsletter, r/technology

**Operating Systems:**
*Linux* — Phoronix, LWN.net, OMG! Ubuntu, It's FOSS, Linuxiac, 9to5Linux,
Fedora Magazine, Arch Linux news, Debian news, kernel.org releases,
DistroWatch Weekly, GitHub release feeds (linux, systemd, mesa, GNOME, KDE,
Wayland), r/linux, r/linux_gaming.
*Windows* — Windows Central, Neowin, Microsoft Windows blog, Windows Insider
blog, r/windows.
*macOS & iOS* — MacRumors, Apple Newsroom, Six Colors, Michael Tsai,
Howard Oakley (Eclectic Light), r/macos.
*Android & ChromeOS* — Android Police, Android Developers blog,
About Chromebooks, r/android.
*BSD & other* — Undeadly (OpenBSD), FreeBSD news, Haiku activity reports.

Because the Operating Systems lane now overlaps the other two — 9to5Mac
covers both new hardware and macOS releases — the `lane` column on a source is
only a **default hint**. The enrichment step scores every article against all
three lanes and assigns the primary lane per article, so a MacRumors post about
an iPhone lands in Gadgets & Hardware while one about an iOS 27 build lands in
Operating Systems. The same applies to Phoronix, whose hardware benchmarks
belong to Hardware even though the feed is seeded as Operating Systems.

### "Everywhere on the internet" — what that actually means

RSS covers roughly 85% of what matters. The remaining 15% needs these:

| Method | Purpose |
|---|---|
| **RSS / Atom / JSON Feed** | The backbone. Cheap, polite, well-structured |
| **Hacker News Algolia API** | Keyword queries beyond the front page (`kernel`, `RISC-V`, your saved terms) |
| **Reddit RSS** | Subreddit feeds carry upvote counts, useful as an engagement signal |
| **GitHub Releases Atom** | Catches releases that never get press coverage |
| **Google News RSS queries** | `news.google.com/rss/search?q=...` — a catch-all net over outlets we don't feed directly |
| **Claude web search (weekly)** | A "what did we miss?" sweep that proposes new sources for approval |

That last one is the honest answer to full-internet coverage: no crawler
reaches everything, so the system audits its own blind spots weekly and asks
to add sources.

## 4. Data model (D1 / SQLite)

```sql
sources        id, name, homepage, feed_url, kind, lane, weight, active,
               poll_interval, next_poll_at, tier, websub_hub, websub_state,
               last_fetched_at, last_status, etag, last_modified,
               items_per_day, consecutive_failures

articles       id, url_canonical, url_hash UNIQUE, source_id, title, author,
               published_at, fetched_at, excerpt, image_url, lane, status,
               heuristic_score, engagement_score, cluster_id
               -- status: live -> enriched.  INDEX (status, heuristic_score)
               -- and (fetched_at DESC) for the live feed

enrichments    article_id PK, summary, why_it_matters, tags_json,
               lane_scores_json, score, model, tokens_in, tokens_out,
               created_at

clusters       id, digest_id, primary_article_id, member_ids_json, headline

digests        id, date, lane, intro, status, published_at

digest_items   digest_id, article_id, cluster_id, rank, lane

deliveries     id, digest_id, channel, target, status, sent_at, error

feedback       id, article_id, signal (up|down|save|click), source (slack|web),
               created_at

preferences    id, doc_json, updated_at        -- learned, one live row

runs           id, stage, started_at, ended_at, counts_json, error

subscribers    id, email, lanes_json, cadence, verified, unsub_token

slack_install  team_id, channel_id, bot_token, installed_at

articles_fts   -- FTS5 virtual table over title + summary, for /search
```

**KV** holds only volatile things: conditional-GET etags, the rolling AI
spend counter, rate-limit buckets, and Slack OAuth state.

The live feed reads `articles WHERE status IN ('live','enriched') ORDER BY
fetched_at DESC` — so it must be indexed on `fetched_at`, and paginated by
cursor rather than `OFFSET`, which degrades badly past a few thousand rows.

## 5. Deduplication

Three layers, cheapest first:

1. **URL canonicalization** — strip `utm_*`, `ref`, `fbclid`, `at_medium`;
   unwrap AMP and news-aggregator redirects; lowercase host; drop trailing
   slash → SHA-256 → unique index. Catches exact re-posts for free.
2. **Title similarity** — normalized title trigram Jaccard within a rolling
   48-hour window flags candidate pairs. Pure SQL and string work, no AI.
3. **AI adjudication** — only flagged candidates go to one Haiku call:
   "same underlying story?" Confirmed matches join a cluster.

The site then shows one card per cluster: the best-written version, with
*"also covered by The Verge, Engadget +3"* underneath. This is the single
biggest quality difference between this and a raw feed reader.

## 6. Ranking

Composite score, 0–100:

| Component | Weight | Source |
|---|---|---|
| Lane relevance | 40 | Haiku scores 0–1 against your lane definitions + learned preferences |
| Recency | 20 | Exponential decay, 18-hour half-life |
| Source weight | 15 | Per-source trust, hand-set at seed, adjusted by your feedback |
| Corroboration | 15 | Cluster size — three outlets covering it means it matters |
| Engagement | 10 | HN points / Reddit upvotes where available, normalized |

Then a diversity pass: at most **one story per source per lane** in the top 8,
so a prolific outlet can't dominate the digest.

## 7. AI usage and cost

**Model:** `claude-haiku-4-5` — $1.00 / MTok input, $5.00 / MTok output.

**Two cost controls that matter:**
- **Heuristic prefilter** cuts ~250 collected articles/day down to ~120
  before any AI call (lane keyword match, source weight floor, age cutoff).
- **Batch API** at 50% off. Enrichment runs at 22:00 UTC and the digest is
  built at 02:00 UTC — a 4-hour buffer, comfortably more than batch needs.
  Anything unfinished at digest time falls back to synchronous calls.

**Three cost controls, and they compound.**

*Prompt caching.* The shared system prompt — scoring rubric plus few-shot
examples — is deliberately kept **above 1,024 tokens** so caching engages, then
read at $0.10/MTok instead of $1.00. Below that threshold caching silently does
nothing, so this is not optional.

*Batch API.* Half price. Roughly 70% of enrichment is not urgent (anything not
breaking) and goes through batch; the remaining 30% runs synchronously so
breaking stories get summaries within minutes.

**Cost of one enrichment**

| Component | Tokens | Sync | Batch |
|---|---|---|---|
| System prompt, cached read | 1,200 | $0.00012 | $0.00006 |
| Article excerpt, fresh | ~800 | $0.00080 | $0.00040 |
| Output | ~200 | $0.00100 | $0.00050 |
| **Per story** | | **$0.00192** | **$0.00096** |

Blended at 30% sync / 70% batch: **~$0.00125 per story**.

**What the budget buys**

| Daily AI budget | Stories summarized/day | Monthly |
|---|---|---|
| $0.13 | ~100 | $4 |
| $0.40 | **~320** | **$12** |
| $0.50 | ~400 | $15 |
| $1.30 | ~1,000 | $39 |

**Set at $0.40–0.50/day → $12–15/month**, summarizing roughly **300–400 of the
~3,500 articles collected daily**. The other ~3,100 still appear on the site
immediately with headline, source, timestamp, lane and tags — they simply have
no AI summary.

Selection is by merit, not arrival order: corroborated by 2+ sources, high
heuristic score, or in a lane you read heavily. A hard cap in KV stops
enrichment when the day's budget is spent; the fast path never stops.

## 8. Running costs — read this before we start

**The Cloudflare free tier will not carry this**, for two concrete reasons:

- **50 subrequests per invocation** (free) vs 10,000 (paid). One collect run
  hits ~60 feeds, so it blows the free cap on the first stage.
- **10ms CPU per invocation** (free) vs 30s (paid). Parsing 60 XML feeds is
  far past 10ms of actual CPU.

Queues also requires the paid plan.

| Item | Cost |
|---|---|
| Workers Paid (required — includes Queues, D1, KV) | $5.00/mo |
| D1 rows written — ~10K/day at $1/M | ~$0.30/mo |
| D1 storage — ~2 GB/yr of articles + summaries | $0 (5 GB included) |
| D1 rows read, KV, requests | $0 (inside allowance) |
| Claude Haiku 4.5 — budget-capped | $12–15/mo |
| Domain (only needed for email + a nice URL) | ~$10/yr |
| **Total** | **~$18–21/month** |

Continuous polling does **not** move this. 1,300 fetches an hour is ~31K
subrequests a day against a 10,000-per-*invocation* limit and no daily cap; the
scheduler cron is 1,440 invocations a day against 10M included requests a month.
Comprehensiveness is genuinely close to free — the AI line is the whole bill,
and it is capped by design.

**D1 growth is the thing to watch.** At ~3,500 articles/day you cross the 5 GB
included storage in roughly two years, and the 10 GB per-database ceiling in
four. Plan a retention policy in Phase 7: keep summaries and metadata forever,
drop raw excerpts after 90 days.

Without a domain, the site lives at `tech-news-agent.<you>.workers.dev` and
everything except email works.

## 9. Website

Server-rendered on the Worker with Hono + JSX, styled with hand-written CSS,
served alongside static assets. No SPA framework — pages are read-once and
should paint instantly.

**The front page is the live feed.** Reverse-chronological, everything the agent
has collected, updating as it arrives. The curated daily digest moves to
`/digest` and still drives Slack and email — so you can graze all day or read
once in the morning.

At ~3,500 items a day the firehose is only usable with strong filtering, so the
feed carries these controls in one row above it: lane, minimum score, source,
**"corroborated only"** (2+ outlets on the same story), and **"summarized
only"**. The default view is all lanes above a modest score floor.

Updates arrive by polling `/api/latest?since=<cursor>` every 45 seconds and
prepending — cheap, robust, nothing to keep alive. A *"12 new stories"* pill
appears rather than content jumping under you while you read.

| Route | Purpose |
|---|---|
| `/` | **The live feed** — everything, newest first, auto-updating, with filters |
| `/digest` | Today's curated digest — three lane sections, hero story each |
| `/lane/hardware` `/lane/tech` `/lane/os` | Full lane view, more depth |
| `/d/2026-08-23` | Any past day, with previous/next navigation |
| `/archive` | Year of month calendars — per-day story count and lane split |
| `/search?q=` | Full-text over titles and summaries (D1 FTS5) |
| `/tag/:tag` | Everything tagged, with activity over time and a follow action |
| `/saved` | Your read-later list |
| `/sources` | Per-feed table — status, items/week, published, your open rate, weight |
| `/dashboard` | KPIs, collection funnel, source leaderboard, AI spend |
| `/feed.xml`, `/feed/:lane.xml`, `/feed/tag/:tag.xml`, `/feed/saved.xml` | RSS/Atom output |
| `/api/latest?since=` | Live-feed cursor endpoint the front page polls |
| `/api/digest/today.json` | Public JSON API |
| `/health` | Pipeline status for monitoring |


**`/dashboard` and `/sources` split the same data deliberately.** The dashboard
carries the summary — four KPI tiles, the funnel, the source leaderboard, spend —
and tells you *that* four feeds need attention. `/sources` is the deep table of
all 65 feeds where you actually act on them: retry, re-point, re-weight, remove.

### What a story card contains

Every story, on every channel, links out to the original. Nothing is a
dead end.

| Element | Detail |
|---|---|
| **Headline** | Links directly to the original article at the publisher |
| **Source + time** | e.g. *Phoronix · 3h ago* — the outlet is always named |
| **Summary** | 2–3 lines, generated only from the fetched text |
| **Why it matters** | One line of context, where the story warrants it |
| **Tags** | Clickable, e.g. `kernel`, `apple`, `risc-v` |
| **Also covered by** | Each outlet in the cluster is its **own link** to that outlet's version, so you can pick whose write-up you prefer |
| **Actions** | Save for later, 👍/👎 |

The same rule holds across channels: Slack section blocks link the headline
and list cluster members as links; the RSS `<link>` element points at the
original article, never at my site; the email digest links every headline and
source. Summaries exist to help you decide what to open — the link is the
point.

**Reading features:** cluster cards ("also covered by…"), read/unread state,
save-for-later, `j`/`k` keyboard navigation, dark and light themes,
mobile-first layout.

## 10. Slack bot

**Daily push** at 08:00 IST: one Block Kit message per lane, each story a
section block with title link, two-line summary, source, and 👍/👎/🔖 buttons.

**Breaking pushes**, separately and sparingly. Three thousand items a day cannot
go to Slack, so a story is pushed immediately only if it clears a high bar:
corroborated by 3+ sources within an hour, or above a score threshold you set.
Expect a handful a day, not a stream — and it posts to its own channel so the
daily digest stays calm. The threshold is tunable from `/dashboard`.

**Slash commands:**

| Command | Result |
|---|---|
| `/technews` | Today's digest, all three lanes |
| `/technews os` · `/technews hardware` | One lane |
| `/technews search wayland` | Full-text search over the archive |
| `/technews sources` | Feed health |
| `/technews more` | Next 10 stories below the digest cut |
| `/technews live` | The last 10 items from the live feed, any lane |

**Two implementation rules that are easy to get wrong:**
- Verify every request with the Slack v0 HMAC signature and reject timestamps
  older than 5 minutes.
- Slack demands a response in **3 seconds**. Acknowledge immediately, then do
  the real work in `ctx.waitUntil()` and post back via `response_url`.

**Scopes needed:** `chat:write`, `commands`, `incoming-webhook`. Ships with an
app manifest so setup is paste-and-go.

## 11. Email digest

Cloudflare Email Sending via the Worker `send_email` binding — no API keys,
no third party.

**Prerequisite:** a domain onboarded with `wrangler email sending enable
yourdomain.com`, plus SPF/DKIM records. If you don't have a domain yet, this
is the one feature that has to wait; everything else ships without it.

Daily HTML email with a plain-text alternative, per-lane sections, one-click
unsubscribe, and a subscriber table so you can add other recipients later.

## 12. What makes it an agent, not an aggregator

Three feedback loops that change the system's behavior over time:

**Preference learning.** Every 👍/👎/save/click writes to `feedback`. A weekly
cron feeds the last 7 days of signals to Claude, which rewrites a preferences
document: topics you actually read, sources to boost or demote, keywords to
mute. That document is injected into the scoring prompt, so ranking adapts to
you rather than to a fixed rubric.

**Gap sweeps.** Weekly, Claude runs with the web search tool: *"What
significant news in these three areas did my sources miss this week?"* It
proposes new feeds, which arrive in Slack as approve/reject buttons. Approved
ones are written to the `sources` table. The system grows its own coverage.

**Self-repair.** Sources that fail three consecutive fetches get flagged, and
the agent tries to find a replacement feed URL before deactivating them.

## 13. Observability

- `runs` table records every stage execution with counts, duration, errors.
- `/health` and `/sources` expose that as readable pages.
- Slack alerts on: pipeline failure, a source dead >3 days, daily AI spend
  over budget.
- A soft spend cap in KV; when the day's AI spend crosses it, enrichment
  degrades to headline-only rather than silently running up a bill.

## 14. Repository layout

```
tech-news-agent/
├── wrangler.jsonc              # bindings, crons, queues
├── package.json
├── sources.seed.json           # the source list
├── migrations/
│   └── 0001_init.sql
├── src/
│   ├── index.ts                # fetch + scheduled + queue handlers
│   ├── collect/                # feed parsers, canonicalize, dedupe
│   ├── enrich/                 # Claude client, prompts, batch runner
│   ├── rank/                   # scoring, clustering, diversity
│   ├── deliver/                # slack, email, rss
│   ├── routes/                 # web, api, slack, feeds
│   ├── db/                     # queries + migrations helpers
│   └── views/                  # JSX components
├── public/                     # css, icons
└── docs/PLAN.md
```

## 15. Build phases

Every phase ends with something deployed and working. Summarised here; the
task-level breakdown, effort estimates, dependency map and milestones live in
[DEVELOPMENT.md](DEVELOPMENT.md).

**Phase 0 — Scaffold.** Repo, `wrangler.jsonc`, D1 database and schema
migration, Hono skeleton, seeded sources, local dev running.
*Done when:* `/health` returns green locally and in production.

**Phase 1 — Collector.** RSS/Atom/JSON Feed parsing, URL canonicalization,
conditional GET with etag caching, D1 writes, dedupe layers 1 and 2, cron
every 3h. **No AI yet.**
*Done when:* the `articles` table fills up on its own and `/sources` shows
green across the board.

**Phase 2 — Enrichment and ranking.** Heuristic prefilter, Haiku batch
enrichment, scoring, clustering, digest assembly.
*Done when:* `/api/digest/today.json` returns a good digest you'd actually
read.

**Phase 3 — Website.** All routes, FTS5 search, RSS output, styling, dark
mode, keyboard nav.
*Done when:* the site is live and you read it in the morning by choice.

**Phase 4 — Slack.** Manifest, OAuth install, signature verification, slash
commands, daily scheduled push, feedback buttons.
*Done when:* the digest lands in your channel at 08:00 without you touching
anything.

**Phase 5 — Email.** Domain onboarding, SPF/DKIM, HTML template, subscriber
table, unsubscribe flow.
*Done when:* the digest arrives in your inbox. *(Needs a domain.)*

**Phase 6 — The agent loop.** Preference learning, weekly gap sweeps, source
auto-discovery, self-repair, alerting, spend caps.
*Done when:* the ranking visibly shifts toward what you actually click.

## 16. Risks and honest caveats

| Risk | Mitigation |
|---|---|
| **Free tier won't work** | Budget $5/mo for Workers Paid. Non-negotiable — see §8 |
| **Truncated feeds** — many outlets publish excerpt-only RSS | Optional full-text fetch, robots.txt-respecting, per-domain allowlist, polite rate limits. Summaries from excerpts are thinner but still useful |
| **Copyright / ToS** | Summarize and link with clear attribution — never republish full articles. This is the standard aggregator posture. Keep the site personal-use or behind auth if you're unsure |
| **AI hallucination in summaries** | Prompt hard for "summarize only from the provided text, no outside knowledge"; store the exact excerpt each summary came from; always show the source link |
| **Feed rot** | Health dashboard + self-repair + weekly gap sweep |
| **Cron is UTC** | All schedules written UTC with the IST equivalent in a comment. 08:00 IST = 02:30 UTC |
| **Slack's 3-second timeout** | Ack first, work in `ctx.waitUntil()` |
| **Email deliverability** | Needs a domain and DNS records — not instant. Phased last for that reason |

## 17. Open decisions

1. **Domain** — do you own one, or want one? Gates Phase 5 and gives the site
   a real URL.
2. **Slack workspace** — a personal one, or somewhere shared? Changes whether
   we build the full OAuth install flow or hardcode a single bot token.
3. **Site visibility** — public, or behind Cloudflare Access? Affects the
   copyright posture in §16.
4. **Digest time** — plan assumes 08:00 IST. Easy to change.

None of these block Phase 0 through 3.
