import { cloudflare } from "../context";
import type { Route } from "./+types/census";

type Row = {
  title: string;
  title_raw: string | null;
  badge: string | null;
  image_url: string | null;
  published_at: number | null;
};

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))]!;
}

/**
 * The headline census.
 *
 * Placeholder copy is always a tidy 70 characters. Real headlines are not, and
 * the numbers here are what the front page's clamps and type sizes get set
 * from — measured, not guessed.
 */
export async function loader({ context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflare);

  const { results } = await env.DB.prepare(
    `SELECT title, title_raw, badge, image_url, published_at FROM articles
      ORDER BY fetched_at DESC LIMIT 2000`,
  ).all<Row>();

  const rows = results ?? [];
  const lengths = rows.map((r) => r.title.length).sort((a, b) => a - b);

  const longestToken = rows.reduce((max, r) => {
    const token = r.title.split(/\s+/).reduce((a, b) => (b.length > a.length ? b : a), "");
    return token.length > max.length ? token : max;
  }, "");

  const wasAllCaps = rows.filter((r) => {
    const raw = r.title_raw ?? "";
    const letters = raw.replace(/[^a-z]/gi, "");
    return letters.length > 8 && letters === letters.toUpperCase();
  }).length;

  const outletStripped = rows.filter(
    (r) => r.title_raw && r.title_raw.length > r.title.length + 3,
  ).length;

  // How many lines the lead slot needs at ~34 characters per line.
  const LEAD_CHARS_PER_LINE = 34;
  const overThree = lengths.filter((n) => n > LEAD_CHARS_PER_LINE * 3).length;

  return Response.json(
    {
      sample: rows.length,
      length: {
        min: lengths[0] ?? 0,
        p25: percentile(lengths, 0.25),
        median: percentile(lengths, 0.5),
        p75: percentile(lengths, 0.75),
        p95: percentile(lengths, 0.95),
        max: lengths.at(-1) ?? 0,
        mean: Math.round(lengths.reduce((a, b) => a + b, 0) / (lengths.length || 1)),
      },
      longestToken: { text: longestToken, length: longestToken.length },
      normalisation: {
        arrivedAllCaps: wasAllCaps,
        outletNameStripped: outletStripped,
        kickerLifted: rows.filter((r) => r.badge).length,
      },
      coverage: {
        withImage: rows.filter((r) => r.image_url).length,
        withoutImage: rows.filter((r) => !r.image_url).length,
        withoutDate: rows.filter((r) => !r.published_at).length,
      },
      leadSlot: {
        charsPerLineAt36px: LEAD_CHARS_PER_LINE,
        wouldExceedThreeLines: overThree,
        percentExceeding: Math.round((overThree / (rows.length || 1)) * 100),
      },
    },
    { headers: { "cache-control": "no-store" } },
  );
}
