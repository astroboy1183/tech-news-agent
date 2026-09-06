# Tech News Agent

A one-stop portal for everything technology. It polls **180 sources every two
minutes**, collapses duplicate coverage into single stories, summarizes what
earns it under a fixed budget, and composes a front page by itself — all from a
single Cloudflare Worker, for under $20 a month.

**How it works:** [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — the full
picture with diagrams: runtime, request path, ingestion, clustering, the data
model, and the two platform limits that have bitten twice each.

**Ten sections:** AI & ML · Software · Hardware · Consumer Tech · Operating
Systems · Security · Cloud & Infra · Science · Gaming · Industry & Policy

---

## Status — v1.0.0

**Live:** https://tech-news-agent.jayanthapalla.workers.dev ·
[/health](https://tech-news-agent.jayanthapalla.workers.dev/health) ·
[/ops](https://tech-news-agent.jayanthapalla.workers.dev/ops)

| | |
|---|---|
| Sources | **180 active**, polled every 2 minutes |
| Articles | 4,400+, grouped into 4,100+ stories |
| Corroborated | 177 stories covered by more than one outlet |
| Sections | all ten populated |
| Tests | 143 |

All ten releases are tagged. The summarizer is built and deployed but dormant
until `ANTHROPIC_API_KEY` is set — `/health` reports which channels are live.


## Stack

| Layer | Choice |
|---|---|
| Language | TypeScript, frontend and backend |
| Runtime | Cloudflare Workers — `fetch`, `scheduled`, `queue` |
| Frontend | React 19 + **React Router 8**, server-rendered then hydrated |
| Styling | Hand-written CSS with custom properties — Paper (default) and Ink |
| Database | D1 (SQLite) + FTS5, via Drizzle ORM |
| Queues | Cloudflare Queues |
| Vectors | Vectorize + Workers AI `bge-small` |
| Cache | KV — etags, spend ledger, composed front page |
| Objects | R2 — thumbnail cache, nightly D1 backups |
| Identity | Cloudflare Access |
| AI | `claude-haiku-4-5` via `@anthropic-ai/sdk` |
| Plan | Workers **Paid**, $5/mo |
| Package manager | pnpm — npm 10 hits a resolver bug on this tree |
| Validation | Zod · **Feeds** fast-xml-parser · **Tests** Vitest with `@cloudflare/vitest-pool-workers` |

The alternatives were scored in detail before choosing — see the comparison link
below. Python scored higher on the merits; Cloudflare won on operational burden,
which matters more for a project maintained in evenings.

## Documents

| Document | What it is |
|---|---|
| **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** | **How the running system works — diagrams, runtime, data model** |
| [docs/RUNBOOK.md](docs/RUNBOOK.md) | What to check, what breaks, what to do |
| [docs/CLUSTERING.md](docs/CLUSTERING.md) | Every clustering threshold and the measurement behind it |
| [docs/BUDGET.md](docs/BUDGET.md) | How $20/month works, and what enforces it |
| [docs/CENSUS.md](docs/CENSUS.md) | Headline statistics the layout is set from |
| [docs/PLAN.md](docs/PLAN.md) | The original plan — sources, ranking, costs, risks |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | Ten phases, task-level, with acceptance checks |
| [docs/RELEASES.md](docs/RELEASES.md) | Version-wise release plan, v0.1 through v1.0 |
| [design/](design/) | 18 `.dc.html` artboards and `canvas.json` |
| [docs/artifacts/](docs/artifacts/) | Published HTML sources for the plan pages |

**Published pages** — stable links, updated in place:

- Build plan — https://claude.ai/code/artifact/7ce58298-ea09-4499-a60a-4c1fb8ed1dc9
- Build order — https://claude.ai/code/artifact/3ff59ffc-1089-4dfb-8ce1-5fc0fc8d9807
- Wireframes — https://claude.ai/code/artifact/08b440f2-47c5-4f27-92ae-413e6f6f5544
- Stack options — https://claude.ai/code/artifact/37d7324f-78f6-4a76-b371-82ab0909c69a
- Stack comparison — https://claude.ai/code/artifact/a2631aa5-fb50-48fb-a324-0bb9fddb6b0c

## Development

```bash
pnpm install
pnpm dev             # vite dev with local D1 and KV
pnpm lint            # biome
pnpm typecheck       # react-router typegen + wrangler types + tsc
pnpm test            # vitest in the real Workers runtime
pnpm build           # react-router build
pnpm deploy          # build + wrangler deploy
```

**Use pnpm, not npm.** npm 10 fails on this dependency tree with
`Cannot read properties of null (reading 'edgesOut')`, and the Workers vitest
pool pins vitest 4 while npm resolves 5.

### Branching and releases

`main` is always deployable and deploys to production on merge. Work on
`feat/*` or `fix/*`, open a PR, squash-merge. Tagging `v*` builds, deploys and
publishes a GitHub Release.

Commits follow Conventional Commits — `feat(collect): add WebSub subscriber` —
because release notes are generated from them.

### CI/CD

| Workflow | Trigger | Does |
|---|---|---|
| `ci.yml` | PRs and non-main pushes | Lint, typecheck, test, build, dry-run deploy, and a preview URL commented on the PR |
| `deploy.yml` | Push to `main` | Full checks, D1 migrations, deploy, then a `/health` smoke test with retries |
| `release.yml` | Tag `v*` | Full checks, migrate, deploy, publish the GitHub Release (`v0.1`–`v0.5` as pre-releases) |

**Repository secrets required:** `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.
**Repository variable:** `HEALTH_URL`.
The Anthropic key is a Worker secret, set with `wrangler secret put ANTHROPIC_API_KEY` — never in Actions.

## Roadmap — v2.0

Ordered by what the live data says is worth doing first, not by what is easiest
to build. Every measurement below came from the running system.

### First, because everything else is worth less without it

- [ ] **Turn the summarizer on.** It is built, deployed and dormant — it needs
      `wrangler secret put ANTHROPIC_API_KEY` and nothing else. Until then
      every card falls back to the publisher's own excerpt, which is why feed
      furniture occasionally shows through. Single biggest quality jump
      available, zero build cost.
      *Done when* `/health` reports `summarizer: enabled` and a week stays
      under $0.45/day with every section clearing its floor.

- [ ] **Raise the corroboration rate.** 255 of 4,249 stories have more than
      one outlet — **6.0%**. Clustering is what makes the budget work, so
      this number *is* the economics: one summary covering eight outlets is the
      whole saving. Adding 79 sources roughly tripled it; more mainstream
      newsrooms would push it further.
      *Done when* corroborated stories exceed 15% of the total on `/ops`.

### Content quality

- [ ] **Extract article bodies.** Summaries are written from a headline and a
      feed excerpt. Fetching the article and pulling readable text would make
      them markedly better — and would make genuine disagreement between
      outlets visible, which is currently invisible to the model.
- [ ] **Entity extraction and topic pages** — `/t/nvidia`, `/t/kubernetes`.
      `articles.topics_json` and `enrichments.topics_json` already exist and
      the summarizer already returns tags; this is mostly UI over data we will
      have as soon as the summarizer runs.
- [ ] **Use `clusters.velocity`.** It is computed and stored on every cluster
      and nothing reads it. Five outlets within an hour is categorically
      different from five across two days — that is a "developing" badge, a
      lead override, or a notification.
- [ ] **Cross-encoder pass on the ambiguous band.** Measured cosines leave a
      band where embeddings genuinely cannot decide (see
      [CLUSTERING.md](docs/CLUSTERING.md)). A tiny model judging only that band
      would recover merges currently declined for safety.

### The reader

- [ ] **Preference learning.** The `feedback` and `preferences` tables exist
      and are empty. Clicks are signal; the weekly agent could reweight
      *sections* the way it already reweights sources from corroboration.
- [ ] **Keyboard navigation** — `j`/`k` through stories, `/` to search. Cheap,
      and the layout is already a list of discrete items.
- [ ] **PWA manifest and offline shell.** The site is already responsive; a
      manifest plus a service worker gets most of what a mobile app would,
      for about a day's work.
- [ ] **Saved-list sync across devices.** Blocked on auth — the list
      deliberately lives only in the browser today.

### Operations

- [ ] **Authentication, so `/ops` can write.** Pinning a lead is currently a
      raw D1 statement. This one decision unblocks pinning, saved sync and
      email subscriptions together.
- [ ] **Alerting on a stalled pipeline.** `/pulse` shows a stall clearly but
      only to someone looking. A cron check that posts to Slack when no article
      has arrived in an hour would close the loop.
- [ ] **Per-source detail page** — history, failure reasons, weight over time.
      `/ops` lists failing sources but cannot explain one.
- [ ] **Remove dead dependencies.** `drizzle-orm`, `drizzle-kit` and `zod` are
      declared but imported nowhere, and `app/db/` is empty — scaffold
      leftovers. Every query is hand-written SQL.

### Deliberately not planned

- **Comments.** Moderation cost dwarfs the value at this scale.
- **A native mobile app.** The PWA above gets most of the benefit; a second
  codebase is not worth it for a reading surface.
- **Per-section colour.** Beyond about six, categorical hues stop separating
  reliably for colourblind readers — measured, not assumed. Identity stays with
  the section name and its position.

## Open decisions

1. **A domain.** The single biggest unblocker left: it gates email delivery,
   authentication, and anything meant to be shared. Most of the v2.0
   operations work waits behind it.
2. **Public, or behind Cloudflare Access?** Determines how `/saved` could
   identify a reader and whether `/ops` can ever write. Access is free to 50
   users and needs no auth code of our own.

1. **Public, or behind Cloudflare Access?** Blocks v0.7 — it determines how
   `/saved` identifies you. Access is free to 50 users and needs no auth code.
2. **Domain?** Only gates the email digest in v0.9.
