/**
 * Cluster-level summarization.
 *
 * One call per *story*, not per article. A cluster arrives holding every
 * version six newsrooms filed, and the model reads all of them at once — which
 * is both why this is affordable and why the summary is better than any single
 * outlet's lede. Disagreements between outlets are visible to the model in a
 * way they never are to a per-article summarizer.
 *
 * Deliberately synchronous rather than the Batch API. Batch halves the price
 * but can take hours, and a news portal whose whole premise is "as fresh as
 * possible" cannot wait: a story summarized tomorrow morning is not a
 * summarized story. Prompt caching recovers most of the difference, and the
 * budget still lands inside $20/month — see docs/BUDGET.md.
 */

import Anthropic from "@anthropic-ai/sdk";
import { costOf, readSpend, recordSpend } from "./budget.server";
import { SECTIONS, type Section } from "./classify";
import { SECTION_BLURBS, SECTION_LABELS } from "./sections";

const MODEL = "claude-haiku-4-5-20251001";

/** Enough for two tight sentences and a short "why it matters", nothing more. */
const MAX_TOKENS = 320;

/**
 * The system prompt is stable across every call in a run, so it is marked for
 * caching: subsequent calls pay a tenth of the input price for it. That only
 * applies above ~1024 tokens, which the taxonomy below comfortably clears —
 * and the taxonomy earns its place anyway, since section assignment is one of
 * the things the model is asked to correct.
 */
function systemPrompt(): string {
  const taxonomy = SECTIONS.map((s) => `- ${s} (${SECTION_LABELS[s]}): ${SECTION_BLURBS[s]}`).join(
    "\n",
  );

  return `You write the summaries for a technology news portal. Readers come to it to find out what happened in technology today without reading forty sites, and they trust it to be accurate and to waste none of their time.

You are given ONE news story as it was filed by one or more outlets. When several outlets covered it you see all of their headlines and openings together. Your job is to write the single account a well-informed reader would want.

WHAT TO WRITE

summary: Two sentences, at most 55 words total. The first states what actually happened — the concrete event, with the specific detail that makes it real (a number, a version, a name, a date). The second gives the fact a reader needs to understand it: scale, mechanism, who is affected, or what changed from before.

why_it_matters: One sentence, at most 25 words, only when there is a genuine reason this is consequential beyond the event itself. Return null when there is not. Most stories do not need one, and a manufactured stake is worse than none.

topics: Two to five lowercase tags naming the specific entities and technologies involved — companies, products, standards, languages. Prefer "vectorize" and "postgres" over "databases". No generic tags like "tech" or "news".

section: The single best fit from this taxonomy. The feed's own guess is given to you and is often wrong, because it describes a publication rather than a story — a gaming site covering an acquisition is filing industry news.

${taxonomy}

HOW TO WRITE IT

Lead with the event, never with context. "Nexus Mods has acquired SteamDB" — not "In a move that highlights consolidation...".

Use the specific over the vague every time. "96 cores" beats "many cores". "Version 6.19" beats "a new version". If outlets disagree on a number, use the one most of them report.

Write plainly. No "in a significant development", no "the tech giant", no "it remains to be seen". Do not open with a participial phrase. Do not editorialise, speculate about consequences, or tell the reader how to feel.

Never state anything the sources do not. If the sources only report a rumour or a leak, say so in the summary itself ("reportedly", "according to a leak"). If they attribute a claim to a company, keep the attribution — a company's claim about its own product is not a fact.

When outlets conflict on a material point, prefer what most report and do not mention the disagreement unless it is the story.

Return ONLY a JSON object, no markdown fence, no preamble:
{"summary": string, "why_it_matters": string|null, "topics": string[], "section": string}`;
}

export type ClusterInput = {
  clusterId: number;
  section: string;
  sourceCount: number;
  articles: { title: string; excerpt: string | null; sourceName: string }[];
};

export type SummaryResult = {
  summary: string;
  whyItMatters: string | null;
  topics: string[];
  section: string;
};

/** Every outlet's version, so the model can weigh them against each other. */
function userPrompt(input: ClusterInput): string {
  const filed = input.articles
    .map((a, i) => {
      const excerpt = a.excerpt?.replace(/\s+/g, " ").trim().slice(0, 500);
      return `${i + 1}. ${a.sourceName}\n   HEADLINE: ${a.title}${excerpt ? `\n   OPENING: ${excerpt}` : ""}`;
    })
    .join("\n\n");

  return `The feed classified this as "${input.section}". ${
    input.articles.length > 1
      ? `${input.articles.length} outlets filed it.`
      : "One outlet filed it."
  }

${filed}`;
}

/** Tolerates a stray fence or preamble rather than losing a paid call to it. */
function parse(text: string, fallbackSection: string): SummaryResult | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const raw = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    const summary = typeof raw.summary === "string" ? raw.summary.trim() : "";
    if (!summary) return null;
    const why = typeof raw.why_it_matters === "string" ? raw.why_it_matters.trim() : "";
    const section =
      typeof raw.section === "string" && SECTIONS.includes(raw.section as Section)
        ? raw.section
        : fallbackSection;
    const topics = Array.isArray(raw.topics)
      ? raw.topics.filter((t): t is string => typeof t === "string").slice(0, 5)
      : [];
    return { summary, whyItMatters: why || null, topics, section };
  } catch {
    return null;
  }
}

export class BudgetExhausted extends Error {}
export class NoApiKey extends Error {}

/**
 * Summarize one cluster and record what it cost.
 *
 * The budget is checked before the call and booked from the usage the API
 * actually reported afterwards, never from an estimate — an estimate that
 * drifts low would quietly spend past the cap.
 */
export async function summarizeCluster(env: Env, input: ClusterInput): Promise<SummaryResult> {
  const apiKey = (env as unknown as { ANTHROPIC_API_KEY?: string }).ANTHROPIC_API_KEY;
  if (!apiKey) throw new NoApiKey("ANTHROPIC_API_KEY is not set");

  const spend = await readSpend(env);
  if (spend.remainingMicros <= 0) {
    throw new BudgetExhausted(`daily cap reached (${spend.spentMicros}/${spend.capMicros})`);
  }

  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: [
      {
        type: "text",
        text: systemPrompt(),
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: userPrompt(input) }],
  });

  const micros = costOf(response.usage);
  await recordSpend(env, micros);

  const text = response.content
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("")
    .trim();

  const parsed = parse(text, input.section);
  if (!parsed) throw new Error(`unparseable summary for cluster ${input.clusterId}`);

  await env.DB.prepare(
    `INSERT INTO enrichments
       (cluster_id, summary, why_it_matters, topics_json, section, excerpt_used,
        model, tokens_in, tokens_out, cost_micros, batch)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
     ON CONFLICT (cluster_id) DO UPDATE SET
       summary = excluded.summary,
       why_it_matters = excluded.why_it_matters,
       topics_json = excluded.topics_json,
       section = excluded.section,
       model = excluded.model,
       tokens_in = excluded.tokens_in,
       tokens_out = excluded.tokens_out,
       cost_micros = excluded.cost_micros`,
  )
    .bind(
      input.clusterId,
      parsed.summary,
      parsed.whyItMatters,
      JSON.stringify(parsed.topics),
      parsed.section,
      userPrompt(input).slice(0, 4000),
      MODEL,
      response.usage.input_tokens,
      response.usage.output_tokens,
      Math.round(micros),
    )
    .run();

  // The model sees the whole story where the classifier saw one feed, so its
  // section call replaces the rule-based guess.
  if (parsed.section !== input.section) {
    await env.DB.prepare(`UPDATE clusters SET section = ? WHERE id = ?`)
      .bind(parsed.section, input.clusterId)
      .run();
  }

  return parsed;
}
