# Clustering — measured thresholds

**v0.3.0, 5 September 2026.** Every number in `app/lib/cluster/` comes from one
of the two probes below. None of them were chosen by intuition, because the
first attempt that was chosen by intuition turned out to be backwards.

Reproduce: `pnpm tsx scripts/probe-guard.mts` (offline, replays recorded
cosines) and `scripts/probe-embeddings.ts` (needs real Workers AI —
`wrangler dev --remote` against a config binding only `AI`).

## Why clustering exists

Eight outlets cover one announcement. Clustering makes that one story, so the
summarizer spends one Claude call instead of eight. It is the single reason the
$20/month budget is achievable — every other saving is rounding error next to
an 8× reduction in the thing that actually costs money.

Clustering therefore has to run **before** summarizing, and it has to be right:
a false merge does not show a duplicate, it **hides a story completely**.

## Probe 1 — trigram similarity is not a similarity measure

Seven labelled pairs, scored by `compareTitles`:

| score | truth | pair |
|---|---|---|
| 1.000 | same | near-identical |
| 0.895 | same | light reword |
| **0.333** | *different* | Rust 1.94 vs 1.95 |
| **0.311** | *different* | two CVEs in one product |
| **0.226** | same | different angle |
| **0.198** | same | heavy reword |
| 0.087 | different | same company, two stories |

**Same-story pairs sit on both sides of every different-story pair.** A
reworded headline scores *below* two unrelated ones. No threshold separates
them, and the "escalate the middle band to embeddings" design this was built
for is therefore worthless — the pairs that need escalating never reach the
band, and the band fills with genuine negatives instead.

What survived: the top of the range. At ≥0.72 with key-token overlap, trigrams
correctly caught both near-identical pairs and nothing else. That is a free
fast path for syndication and reposts, and it is all this tier is used for.

## Probe 2 — embeddings are better, and still not enough alone

`@cf/baai/bge-small-en-v1.5`, cosine, twelve labelled pairs including
deliberately adversarial negatives:

| score | truth | pair |
|---|---|---|
| 1.000 | same | near-identical |
| 0.980 | same | light reword |
| 0.901 | same | headline vs consequence |
| 0.878 | same | heavy reword |
| **0.853** | ***different*** | **two CVEs in one product** |
| 0.825 | same | different angle |
| **0.793** | ***different*** | **iOS 26.2 vs 26.3** |
| **0.787** | ***different*** | **Rust 1.94 vs 1.95** |
| 0.783 | same | announcement vs analysis |
| 0.764 | different | same quarter, two companies |
| 0.716 | different | same company, two stories |
| 0.595 | different | two companies, same layoff story |

Ordering is nearly right — embeddings recover exactly the rewordings trigrams
cannot see. But the worst positive (0.783) sits below the best negative
(0.853), so this is still not separable, and the three offenders share one
shape: **one subject, two events, told apart only by an identifier.**

## The guard

Semantic similarity cannot see the difference between `CVE-2026-31847` and
`CVE-2026-31999` — to an embedding those *are* nearly the same sentence. A
string comparison sees it exactly, and costs nothing.

`discriminatorsConflict` extracts CVE ids, dotted versions, quarters and
integers of two digits or more, and refuses a merge when both titles carry
identifiers of the same kind and **the sets do not intersect**. Overlap
suffices, so *"Top 10 features of iOS 26"* still merges with *"iOS 26 ships
today"*; and a kind only votes when both sides use it, so an analysis piece
that never repeats the version number is not blocked from its announcement.

Replaying the measured cosines through it:

- blocks **4 of 4** dangerous negatives, including all three above the worst positive
- blocks **0 of 6** true positives
- best surviving negative falls 0.853 → **0.764**, worst positive stays **0.783**

The set becomes separable. Any threshold in (0.764, 0.783] classifies all
twelve correctly.

## Section is not a constraint on clustering

The first working version only merged articles that shared a section. That
looked obviously right and was obviously wrong, and live data said so within an
hour. Six outlets covered the Nexus Mods/SteamDB acquisition:

| classified as | outlet |
|---|---|
| industry | Tom's Hardware |
| gaming | TechPowerUp |
| consumer | Notebookcheck |
| gaming | Gamasutra / GDC |
| gaming | Rock Paper Shotgun |
| gaming | GamingOnLinux |

All six arrived within 78 seconds. All six became **separate clusters**, three
of them purely because the classifier put the same story in three different
lanes.

The mistake was treating a guess as a key. The section is a rule-based guess
about a *feed*; the cluster is evidence about an *event*, gathered from six
independent outlets. When they disagree, the evidence should win.

So matching ignores the section entirely, and `refreshClusters` re-derives the
cluster's section by majority vote of its members, breaking ties on the
best-scoring member. Clustering now corrects classification instead of
inheriting its errors.

## One outlet never files the same story twice

The first live spot-check of every multi-article cluster split cleanly in two:

| | merges | wrong |
|---|---|---|
| across outlets | 10 | **0** |
| within one outlet | 21 | **~19** |

Every cross-outlet merge was right — MNT Station, SteamOS 3.9.0, GTA 6's
monetisation, Python 3.15.0 rc2, Apple's new CEO. Almost every same-outlet
merge was wrong, and always the same way: a newsroom publishes serial content
under one template, and to an embedding a template is a near-identical
sentence.

```
Hot Chips 2026: Intel's Crescent Island   ┐
Hot Chips 2026: Fujitsu's Monaka CPU      ├─ four different talks, one cluster
Hot Chips 2026: Intel's Diamond Rapids    │
Hot Chips 2026: Intel's Wildcat Lake      ┘

Dev snapshot: Godot 4.8 dev 3   /  dev 4
Doxxing Safety Pt I             /  Part II
CISA Adds Two Known Exploited…  /  Adds Three Known Exploited…
```

The identifier guard cannot catch these — "dev 3" and "dev 4" are single
digits, which are too noisy to treat as identifiers, and "Pt I"/"Part II" carry
no digits at all.

The rule that does catch them needs no cleverness: **an article never joins a
cluster that already contains its own source.** Clustering exists to gather
corroboration *across* outlets; two items from one newsroom are two items by
editorial construction. It removes almost every false merge and costs two true
ones (an Android beta covered twice by 9to5Google, Apple's betas by 9to5Mac) —
which cost a duplicate on the page, the cheap direction.

## What shipped

| constant | value | why |
|---|---|---|
| lexical merge | ≥0.72 + key-token overlap | above every measured different-story pair (max 0.333) by a wide margin |
| `MERGE_THRESHOLD` | **0.83** | set from live pairs, not the synthetic probe: the one clear false merge measured 0.817, the weakest merges worth keeping 0.838 and 0.841. |
| `WINDOW_SECONDS` | 48h | two stories a week apart are not one event even when the words match |
| `TOP_K` | 25 | the index outlives the window, so closed clusters compete for slots |
| `HOT_SECONDS` | 3h | recent clusters are compared in memory, never through the index |
| `HOT_LIMIT` | 400 | ceiling on vectors loaded per pass |

**0.83 rather than 0.78 is a deliberate loss of recall.** Twelve synthetic
pairs cannot justify a 0.019 margin, so the shipped value was re-derived from
the first live run instead: 0.817 for the false merge it produced, 0.838 and
0.841 for the weakest true ones. The recall given up costs a duplicate on the
page; the alternative risks hiding a story. That is the cheap direction to be
wrong in, and it is the direction every threshold here leans.

## Why the index is not enough on its own

Vectorize is eventually consistent: a seed upserted in one pass is not reliably
queryable in the next. That is invisible most of the time and worst exactly
when it matters, because coverage of one event arrives in a burst. Six outlets
filed the Nexus Mods / SteamDB acquisition within 78 seconds and produced five
clusters — each pass opening a cluster the next pass could not yet see.

So clusters opened in the last three hours are held in memory with their seed
vectors (stored in `clusters.seed_vector`, float32 base64, ~2 KB each) and
compared directly. Vectorize serves only the older tail, where a few seconds of
indexing delay no longer changes anything.

## Cost

Only unmatched articles are embedded — the lexical tier removes near-identical
reposts for free first. At roughly 800 new articles a day and ~12 tokens per
title, embedding costs cents per month. The saving it enables in Claude calls
is the entire summarization budget.
