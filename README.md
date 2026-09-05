# Tech News Agent

A one-stop portal for everything technology. It polls 500+ sources continuously,
collapses duplicate coverage into single stories, summarizes what earns it under
a fixed budget, and composes a front page by itself.

**Ten sections:** AI & ML · Software · Hardware · Consumer Tech · Operating
Systems · Security · Cloud & Infra · Science · Gaming · Industry & Policy

---

## Status — v0.2.0 deployed

**Live:** https://tech-news-agent.jayanthapalla.workers.dev ·
[/health](https://tech-news-agent.jayanthapalla.workers.dev/health)

The collector runs continuously. ~2,400 articles from 85 working sources
across all ten sections, with WebSub push confirmed active on hubs that
support it.

| Endpoint | |
|---|---|
| [`/health`](https://tech-news-agent.jayanthapalla.workers.dev/health) | every binding, last run per stage |
| [`/raw`](https://tech-news-agent.jayanthapalla.workers.dev/raw) | the composition check — real headlines, no styling |
| [`/census`](https://tech-news-agent.jayanthapalla.workers.dev/census) | headline measurements; findings in [docs/CENSUS.md](docs/CENSUS.md) |
| `/websub` | hub verification and content push |

**Next: v0.3.0 — clustering.** `/raw` already shows the same story twice from
different outlets, which is what clustering fixes, and it has to land before
summarisation so one AI call can cover eight outlets.

**Running on Workers Paid.** Four cron triggers registered, Vectorize and
Workers AI bound. The scheduler dispatches every minute and the collect
consumer drains the queue.

**Every source is polled every two minutes** — all 101 of them, about 72,700
polls a day. The tiering this replaced (5 min / 15 min / hourly / 12-hourly)
existed to ration a scarce budget, but conditional GET makes the steady state
almost free: a feed that has not published answers `304` with no body. Sources
that fail back off exponentially to a six-hour ceiling and honour `Retry-After`,
so a rate-limiting origin removes itself without any tier to maintain. WebSub
push delivers instantly for feeds that support it.

**R2 still needs a one-time enable** in the dashboard — it is a separate opt-in
from Workers Paid. Nothing uses it until v0.5.0 (thumbnail cache) and v1.0.0
(nightly backups); the binding is commented in `wrangler.jsonc` until then.

**Running cost: ~$20/month** — $5 Workers Paid, ~$1.50 D1/R2/Vectorize, ~$13.50
Claude Haiku.

### The idea that makes it affordable

Comprehensiveness is nearly free; only AI summarization scales with volume. So
the pipeline runs at two speeds:

- **Fast path, free.** ~7,900 articles a day collected, deduped, classified by
  keyword rules and on the site within seconds.
- **Slow path, budgeted.** Clustering happens *before* summarizing, so one call
  covers eight outlets. ~510 cluster summaries a day, allocated per section with
  a floor each, against a hard KV spend cap. At the cap the feed keeps filling —
  it just stops gaining summaries.

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
| [docs/PLAN.md](docs/PLAN.md) | Architecture, sources, data model, ranking, costs, risks |
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

## Open decisions

1. **Public, or behind Cloudflare Access?** Blocks v0.7 — it determines how
   `/saved` identifies you. Access is free to 50 users and needs no auth code.
2. **Domain?** Only gates the email digest in v0.9.
