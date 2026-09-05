import { cloudflare } from "../context";
import { formatMicros, readSpend } from "../lib/budget.server";
import type { Route } from "./+types/health";

type Check = { ok: boolean; detail?: string };

async function check(fn: () => Promise<unknown>): Promise<Check> {
  try {
    await fn();
    return { ok: true };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Every binding is probed independently so a single broken one is visible
 * rather than failing the whole endpoint.
 */
export async function loader({ context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflare);

  // MEDIA is absent until R2 is enabled on the account; report it as pending
  // rather than failing the whole check for a binding nothing uses yet.
  const media = (env as { MEDIA?: R2Bucket }).MEDIA;

  const [db, kv, vectors, r2] = await Promise.all([
    check(() => env.DB.prepare("SELECT 1").first()),
    check(() => env.CACHE.get("__health")),
    check(() => env.VECTORS.describe()),
    media
      ? check(() => media.head("__health"))
      : Promise.resolve({ ok: true, detail: "not configured" }),
  ]);

  const lastRuns = await env.DB.prepare(
    `SELECT stage, MAX(ended_at) AS last_run FROM runs GROUP BY stage`,
  )
    .all<{ stage: string; last_run: number }>()
    .catch(() => ({ results: [] as { stage: string; last_run: number }[] }));

  // Whether the summarizer can run at all, and what today has cost so far.
  const spend = await readSpend(env).catch(() => null);
  const summarizer = (env as { ANTHROPIC_API_KEY?: string }).ANTHROPIC_API_KEY
    ? "enabled"
    : "disabled — ANTHROPIC_API_KEY not set";

  const checks = { db, kv, r2, vectors };
  const healthy = Object.values(checks).every((c) => c.ok);

  return Response.json(
    {
      status: healthy ? "ok" : "degraded",
      version: "0.7.0",
      checks,
      summarizer,
      budget: spend
        ? {
            day: spend.day,
            spent: formatMicros(spend.spentMicros),
            cap: formatMicros(spend.capMicros),
            remaining: formatMicros(spend.remainingMicros),
            summariesToday: spend.summaries,
          }
        : null,
      lastRuns: lastRuns.results ?? [],
      time: new Date().toISOString(),
    },
    { status: healthy ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}
