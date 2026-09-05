# Tech News Agent

A one-stop portal for everything technology. It polls 500+ sources continuously,
collapses duplicate coverage into single stories, summarizes what earns it under
a fixed budget, and composes a front page by itself.

**Ten sections:** AI & ML · Software · Hardware · Consumer Tech · Operating
Systems · Security · Cloud & Infra · Science · Gaming · Industry & Policy

---

## Status — design complete, ready for v0.1.0

Planning and design are finished. **No application code written yet.** The stack
is decided and the release plan is agreed; next step is Phase 0.

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
| Frontend | React 19 + React Router v7, server-rendered then hydrated |
| Styling | Hand-written CSS with custom properties — Paper (default) and Ink |
| Database | D1 (SQLite) + FTS5, via Drizzle ORM |
| Queues | Cloudflare Queues |
| Vectors | Vectorize + Workers AI `bge-small` |
| Cache | KV — etags, spend ledger, composed front page |
| Objects | R2 — thumbnail cache, nightly D1 backups |
| Identity | Cloudflare Access |
| AI | `claude-haiku-4-5` via `@anthropic-ai/sdk` |
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
npm install
npm run dev          # wrangler dev with local D1, KV, R2
npm run lint         # biome
npm run typecheck    # tsc --noEmit
npm run test         # vitest in the Workers runtime
npm run build        # react-router build
```

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
