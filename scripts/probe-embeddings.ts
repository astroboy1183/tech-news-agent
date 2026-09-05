/**
 * Measures bge-small cosine distance on labelled pairs, so the merge threshold
 * for the embedding tier is chosen from data rather than guessed.
 *
 * The negatives are deliberately adversarial. Embeddings encode *topic*, and
 * the failure that matters here is two different events on one subject —
 * consecutive version numbers, two CVEs in one product, the same quarter's
 * earnings at two companies — reading as one story. A threshold that cannot
 * split those is not usable no matter how well it scores on the positives.
 *
 * Run against real Workers AI:  pnpm probe:embeddings
 */

type Pair = [label: string, verdict: "same" | "different", a: string, b: string];

const PAIRS: Pair[] = [
  // ---- true positives: one event, many newsrooms -------------------------
  [
    "near-identical",
    "same",
    "AMD Reportedly Prepares New Ryzen 5 7500 Six-Core CPU for AM5 Socket",
    "AMD reportedly prepares new Ryzen 5 7500 six-core CPU for AM5 socket",
  ],
  [
    "light reword",
    "same",
    "Linux 6.19 merge window opens with the scheduler rewrite landing",
    "Linux 6.19 merge window opens, scheduler rewrite lands",
  ],
  [
    "heavy reword",
    "same",
    "EU begins enforcing the AI Act against general-purpose models",
    "European Commission opens AI Act enforcement for foundation models",
  ],
  [
    "different angle",
    "same",
    "Signal ships a post-quantum ratchet to every client",
    "Signal rolls out post-quantum encryption across all platforms",
  ],
  [
    "announcement vs analysis",
    "same",
    "OpenAI launches GPT-5.5 with improved reasoning",
    "OpenAI's new model tops every reasoning benchmark we ran",
  ],
  [
    "headline vs consequence",
    "same",
    "Broadcom raises VMware perpetual licence prices again",
    "VMware customers face another Broadcom price increase",
  ],

  // ---- hard negatives: one subject, two events ---------------------------
  [
    "consecutive versions",
    "different",
    "Apple releases iOS 26.2 with security fixes",
    "Apple releases iOS 26.3 with a redesigned Control Centre",
  ],
  [
    "two CVEs, one product",
    "different",
    "CVE-2026-31847: unauthenticated RCE in ScreenConnect",
    "CVE-2026-31999: privilege escalation in ScreenConnect",
  ],
  [
    "adjacent releases",
    "different",
    "Rust 1.94 stabilises async closures",
    "Rust 1.95 stabilises const generics",
  ],
  [
    "same company, two stories",
    "different",
    "Nvidia announces its next datacentre GPU",
    "Nvidia delays its consumer graphics refresh",
  ],
  [
    "same event type, two companies",
    "different",
    "Google lays off 200 staff in its cloud division",
    "Amazon cuts 300 roles at AWS",
  ],
  [
    "same quarter, two companies",
    "different",
    "Microsoft reports a Q3 earnings beat on Azure growth",
    "Alphabet reports a Q3 earnings beat on cloud growth",
  ],
];

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export default {
  async fetch(_request: Request, env: { AI: Ai }): Promise<Response> {
    const texts = PAIRS.flatMap(([, , a, b]) => [a, b]);
    const { data } = (await env.AI.run("@cf/baai/bge-small-en-v1.5", {
      text: texts,
    })) as { data: number[][] };

    const rows = PAIRS.map(([label, verdict], i) => ({
      label,
      verdict,
      score: cosine(data[i * 2] ?? [], data[i * 2 + 1] ?? []),
    })).sort((x, y) => y.score - x.score);

    const positives = rows.filter((r) => r.verdict === "same");
    const negatives = rows.filter((r) => r.verdict === "different");
    const lines = rows.map((r) => `${r.score.toFixed(3)}  ${r.verdict.padEnd(9)}  ${r.label}`);

    // The only threshold worth having sits above every negative. If the worst
    // positive falls below the best negative, no threshold separates them.
    const worstPositive = Math.min(...positives.map((r) => r.score));
    const bestNegative = Math.max(...negatives.map((r) => r.score));
    const separable = worstPositive > bestNegative;

    lines.push(
      "",
      `worst positive : ${worstPositive.toFixed(3)}`,
      `best negative  : ${bestNegative.toFixed(3)}`,
      separable
        ? `SEPARABLE — any threshold in (${bestNegative.toFixed(3)}, ${worstPositive.toFixed(3)}] splits them cleanly`
        : "NOT SEPARABLE — a positive scores below a negative; embeddings alone cannot decide",
    );

    if (!separable) {
      const recoverable = positives.filter((r) => r.score > bestNegative).length;
      lines.push(
        `a threshold just above the best negative still catches ${recoverable}/${positives.length} positives with no false merge`,
      );
    }
    return new Response(`${lines.join("\n")}\n`);
  },
};
