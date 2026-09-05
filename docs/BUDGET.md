# The budget — how $20 a month works

**v0.5.0, 5 September 2026.** Every figure here is either a published price or
a measured one, and the enforcement is in `app/lib/budget.server.ts`.

## The allocation

| | per month |
|---|---|
| Cloudflare Workers Paid | $5.00 |
| Claude Haiku 4.5, at the $0.45/day cap | $13.50 |
| Workers AI embeddings, Vectorize, D1, KV, Queues | well under $1.50 |
| **Total** | **under $20** |

The daily cap is set at $0.45 rather than the $0.50 the arithmetic allows,
because the ledger is a read-modify-write on KV and can undercount slightly
when two ticks overlap. The gap absorbs that.

## Why it is affordable at all: clustering

This is the whole trick, and everything else is rounding error beside it.

Six outlets filed the Nexus Mods/SteamDB acquisition. Summarizing per *article*
is six calls; summarizing per *story* is one. Across a day where roughly 800
articles arrive as roughly 700 stories, the saving is real but modest — the
saving that matters is concentrated exactly on the stories that get
summarized, because the stories worth summarizing are the ones many outlets
covered.

It also produces a better summary. The model sees every version at once, so
where outlets disagree on a number it can prefer what most of them report —
something a per-article summarizer structurally cannot do.

## What a summary costs

Claude Haiku 4.5 is $1/Mtok in and $5/Mtok out.

| | tokens | cost |
|---|---|---|
| system prompt (cached after the first call) | ~1,100 | ~$0.00011 |
| the story: up to 8 headlines and openings | ~600 | ~$0.00060 |
| output: two sentences, a stake, tags | ~130 | ~$0.00065 |
| **per summary** | | **~$0.0014** |

At $0.45/day that is roughly **300 summaries a day**, against roughly 700 new
stories. So most stories are never summarized, and choosing between them is a
real editorial problem rather than a formality — see the rationing below.

## Why not the Batch API

The plan called for it, and it halves the price. It was dropped because it can
take hours to return, and this portal's entire premise is that the news is as
fresh as possible. A story summarized tomorrow morning is not a summarized
story — it is yesterday's news with a paragraph attached.

Prompt caching recovers most of the difference: the system prompt is identical
on every call in a run and is charged at a tenth of the input price after the
first. The budget lands inside $20 either way.

## Rationing: floors before merit

Ranking purely on score would be wrong, and predictably so. AI and hardware
generate the loudest headlines, so an open ranking summarizes those two
sections and leaves Science and Cloud & Infra permanently blank. A portal with
two well-covered sections is not a one-stop portal.

So each of the ten sections gets a **floor of 10 summaries a day**, filled
round-robin — a tick that runs out of budget has then touched several sections
rather than filling one. Only the remainder is competed for on merit, where
corroboration counts: a story four newsrooms ran beats a higher-scoring one a
single blog posted.

## Enforcement

- The cap is checked **before** every call and booked **after** it, from the
  token counts the API actually reported. An estimate that drifted low would
  spend past the cap without ever admitting it.
- A refusal is a normal answer, not an error. The portal is completely readable
  with no summaries at all, so exhausting the budget degrades the product
  instead of breaking it.
- A **corrupt ledger entry reads as fully spent**, never as zero. Failing open
  here would mean spending the day's budget a second time.
- The enrich consumer stops the whole batch on the first budget refusal and
  acks the rest rather than retrying: the cap is a property of the day, not of
  the message, so retrying only burns queue attempts.

`GET /health` reports the day's spend, the cap, what remains, and whether the
summarizer is switched on at all.
