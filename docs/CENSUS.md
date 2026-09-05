# Headline Census — v0.2.0

Measured from **2,000 live headlines** across 85 working sources, 5 September 2026.
This is what the front page's type sizes and clamps are set from — the point of
Phase 1 ending in a reality check rather than a mockup.

Reproduce at any time: `GET /census`.

## Length

| | chars |
|---|---|
| min | 7 |
| p25 | 56 |
| **median** | **71** |
| p75 | 85 |
| p95 | 127 |
| max | 204 |
| mean | 72 |

**The placeholder copy in the wireframes was ~79 characters against a real
median of 71** — close enough that the mockups were not lying, which is the
first genuinely reassuring number here.

## What this means for the layout

**The lead slot needs four lines, not three.** At roughly 34 characters per line
at 36px, a three-line clamp truncates **11% of headlines**. p95 is 127 chars ≈
3.7 lines, so four lines covers all but the outliers. The wireframe's
`lead-hl` box was built for three; it has been widened.

**Long tokens are not a threat.** The longest single word across 2,000 headlines
was `HorizontalPodAutoscaler` at 23 characters — about 414px at 36px, well
inside an 850px lead column. No horizontal overflow risk, though
`overflow-wrap` stays as cheap insurance.

**One story in five has no image.** 1,591 of 2,000 carry a thumbnail; **409 do
not**. The "no image → drop the slot and reflow, do not show a grey box" empty
state applies to 20% of the feed, which is often enough that it must look
deliberate rather than broken.

**Every article has a publication date.** 0 of 2,000 were missing one, so the
"no date" fallback is dead code and the recency half-life can be trusted.

## What normalisation actually caught

| | count | of 2,000 |
|---|---|---|
| Outlet name stripped from the end | 122 | 6% |
| Kicker lifted into a badge | 6 | 0.3% |
| Arrived in ALL CAPS | 1 | 0.05% |

**All-caps headlines are essentially a myth** — one in two thousand. The
sentence-case rule stays because it costs nothing, but it was not the problem I
expected. Appended outlet names are the real, common case at 6%.

## What `/raw` exposed that numbers did not

Rendering the composition against live data surfaced three things no census
column would have shown:

1. **Duplicate coverage is visible and ugly.** "AMD Reportedly Prepares New
   Ryzen 5 7500" appeared twice in one view, from TechPowerUp and r/hardware.
   11 titles are already exact duplicates. This is the argument for clustering
   (v0.3.0) landing before summarisation, made concrete.

2. **Reddit self-posts are not news.** "Azure keyvault key deployment error 400
   bad request" earned an `across` slot. Support questions score like articles
   under a purely lexical heuristic. Reddit is now weighted 0.7 and polled twice
   daily; a question-shape penalty is worth adding in v0.5.0.

3. **Reddit flair leaks into headlines** — `[R]`, `[D]` suffixes. Now stripped.

## Classification is fixed at insert time

Articles are classified when stored, so **changing a rule does not reclassify
what is already there**. Two live examples — "Trump slaps up to 100% tariffs on
imported drones" and "Taiwan cracks down on tech businesses with illegal Chinese
ownership" — both sat in `hardware` because Tom's Hardware is a hardware-seeded
source and nothing in the rules recognised trade policy.

Both cases are now covered and locked in by tests, but **the existing rows keep
their old section**. A reclassification backfill is needed, and belongs with the
v0.5.0 editorial engine where section quality starts to matter.
