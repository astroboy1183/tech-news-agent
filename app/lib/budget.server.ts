/**
 * The spend ledger.
 *
 * This is the piece that makes "a comprehensive news portal for $20 a month"
 * a fact rather than a hope. Everything else in the summarizer asks this
 * module for permission first, and a refusal is a normal answer — the portal
 * is fully readable with no summaries at all, so running out of budget
 * degrades the product rather than breaking it.
 *
 * Two ideas do the work:
 *
 *  1. **Clustering already did most of the saving.** One call covers every
 *     outlet that filed a story, so eight articles cost one summary. Nothing
 *     here would be affordable without that.
 *  2. **A hard daily cap, checked before every call.** Not a monthly budget
 *     watched nervously — a number that stops the spending today.
 */

/**
 * Micro-dollars available per day.
 *
 * Workers Paid is $5/month of the $20, leaving $15 for everything else. At
 * $0.45/day that is $13.50/month with headroom for Workers AI embeddings,
 * Vectorize and the odd overage — deliberately under the true limit, because
 * the ledger is a read-modify-write on KV and can undercount slightly when two
 * ticks overlap.
 */
const DEFAULT_DAILY_CAP_MICROS = 450_000;

/** Claude Haiku 4.5, micro-dollars per million tokens. */
export const PRICE = {
  input: 1_000_000 / 1_000_000, // $1.00 per Mtok  -> 1 micro-dollar per token
  output: 5_000_000 / 1_000_000, // $5.00 per Mtok -> 5 micro-dollars per token
  /** A cache read is a tenth of the input price; a cache write is 1.25×. */
  cacheRead: 0.1,
  cacheWrite: 1.25,
};

export type Spend = {
  day: string;
  spentMicros: number;
  capMicros: number;
  remainingMicros: number;
  summaries: number;
};

function today(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function capFor(env: Env): number {
  const raw = (env as unknown as { DAILY_CAP_MICROS?: string }).DAILY_CAP_MICROS;
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_DAILY_CAP_MICROS;
}

const key = (day: string) => `spend:${day}`;

export async function readSpend(env: Env, now = new Date()): Promise<Spend> {
  const day = today(now);
  const raw = await env.CACHE.get(key(day));
  let spentMicros = 0;
  let summaries = 0;
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as { micros?: number; summaries?: number };
      spentMicros = parsed.micros ?? 0;
      summaries = parsed.summaries ?? 0;
    } catch {
      /* a corrupt ledger entry must not read as unlimited budget */
      spentMicros = capFor(env);
    }
  }
  const capMicros = capFor(env);
  return {
    day,
    spentMicros,
    capMicros,
    remainingMicros: Math.max(0, capMicros - spentMicros),
    summaries,
  };
}

/**
 * Book spend against today's budget.
 *
 * Recorded after the call, from the token counts the API actually reported,
 * rather than estimated in advance — an estimate that drifts low would spend
 * past the cap without ever admitting it.
 */
export async function recordSpend(
  env: Env,
  micros: number,
  summaries = 1,
  now = new Date(),
): Promise<Spend> {
  const day = today(now);
  const current = await readSpend(env, now);
  const next = {
    micros: current.spentMicros + Math.max(0, Math.round(micros)),
    summaries: current.summaries + summaries,
  };
  // Kept for eight days so the operations page can show a week of history.
  await env.CACHE.put(key(day), JSON.stringify(next), { expirationTtl: 8 * 86400 });
  return {
    day,
    spentMicros: next.micros,
    capMicros: current.capMicros,
    remainingMicros: Math.max(0, current.capMicros - next.micros),
    summaries: next.summaries,
  };
}

/** Cost of one call in micro-dollars, from the usage the API reported. */
export function costOf(usage: {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}): number {
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  return (
    usage.input_tokens * PRICE.input +
    usage.output_tokens * PRICE.output +
    cacheWrite * PRICE.input * PRICE.cacheWrite +
    cacheRead * PRICE.input * PRICE.cacheRead
  );
}

/** Micro-dollars as "$0.1234", for the ledger and the ops page. */
export function formatMicros(micros: number): string {
  return `$${(micros / 1_000_000).toFixed(4)}`;
}

/**
 * What one summary is expected to cost, used to decide how many to attempt
 * before the cap is reached. Measured against the real prompt: roughly 800
 * tokens in — mostly cached — and 130 out.
 */
export const ESTIMATED_SUMMARY_MICROS = 1_500;
