/**
 * Choosing the lead.
 *
 * The top of a front page is a claim: *this is the most important thing that
 * happened*. Ranking alone is not enough to make that claim safely, because
 * the highest-scoring story is often merely the loudest — a single blog with a
 * strong headline, a rumour, or the same story that already led four hours
 * ago and has not moved since.
 *
 * So the lead has to pass gates, not just win a sort. Each one encodes a
 * mistake the page would otherwise make, and every rejection is recorded so
 * the choice can be audited rather than guessed at.
 */

import type { Story } from "./sections";

export type GateName = "pinned" | "corroborated" | "fresh" | "substantial" | "not-recently-led";

export type Rejection = { storyId: number; headline: string; gate: GateName };

export type LeadChoice = {
  lead: Story | null;
  pinned: boolean;
  rejected: Rejection[];
};

/** A lone outlet can lead only if the story is genuinely strong on its own. */
const SOLO_SOURCE_MIN_SCORE = 62;

/**
 * Nothing older than this leads, however high it scores.
 *
 * A backstop, not the primary filter. Ranking now decays with age, so fresh
 * stories reach the top on their own; at 18 hours this gate was instead
 * rejecting every good story on the page and handing the lead to whatever
 * mediocre thing happened to be recent.
 */
const MAX_LEAD_AGE_SECONDS = 36 * 3600;

/** A headline shorter than this is a stub, not a lead. */
const MIN_HEADLINE_CHARS = 28;

/** How long a story stays out of the lead slot after holding it. */
const LEAD_COOLDOWN_SECONDS = 10 * 3600;

const HISTORY_KEY = "lead:history";

type LeadHistory = { id: number; at: number }[];

export async function readLeadHistory(env: Env): Promise<LeadHistory> {
  const raw = await env.CACHE.get(HISTORY_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as LeadHistory) : [];
  } catch {
    return [];
  }
}

export async function recordLead(env: Env, storyId: number, now: number): Promise<void> {
  const history = await readLeadHistory(env);
  if (history[0]?.id === storyId) return; // already the standing lead
  const next = [{ id: storyId, at: now }, ...history].slice(0, 24);
  await env.CACHE.put(HISTORY_KEY, JSON.stringify(next), { expirationTtl: 3 * 86400 });
}

/**
 * A question headline is usually commentary, and commentary does not lead a
 * news page. "Is X the future of Y?" tells the reader nothing happened.
 */
function isQuestion(headline: string): boolean {
  return /\?\s*$/.test(headline.trim());
}

export function chooseLead(
  candidates: Story[],
  history: LeadHistory,
  pinnedId: number | null,
  now: number,
): LeadChoice {
  const rejected: Rejection[] = [];

  // A pin is an editor overriding the machine, so it skips every gate. That is
  // the point of having one.
  if (pinnedId !== null) {
    const pinned = candidates.find((s) => s.id === pinnedId);
    if (pinned) return { lead: pinned, pinned: true, rejected };
  }

  const recentlyLed = new Set(
    history.filter((h) => now - h.at < LEAD_COOLDOWN_SECONDS).map((h) => h.id),
  );

  for (const story of candidates) {
    const reject = (gate: GateName) => {
      rejected.push({ storyId: story.id, headline: story.headline, gate });
    };

    // One outlet reporting something is a report; several reporting it is
    // news. A single source can still lead, but only on real strength.
    if (story.sourceCount < 2 && story.score < SOLO_SOURCE_MIN_SCORE) {
      reject("corroborated");
      continue;
    }

    const age = now - (story.publishedAt ?? story.firstSeenAt);
    if (age > MAX_LEAD_AGE_SECONDS) {
      reject("fresh");
      continue;
    }

    if (story.headline.trim().length < MIN_HEADLINE_CHARS || isQuestion(story.headline)) {
      reject("substantial");
      continue;
    }

    // Without this the same story leads all day, and the page stops looking
    // like it is paying attention.
    if (recentlyLed.has(story.id)) {
      reject("not-recently-led");
      continue;
    }

    return { lead: story, pinned: false, rejected };
  }

  // Every gate rejected everything — better the best available story than an
  // empty page, but the rejections are returned so it is visible why.
  return { lead: candidates[0] ?? null, pinned: false, rejected };
}

/** The cluster an editor pinned, if the pin has not expired. */
export async function currentPin(env: Env, now: number): Promise<number | null> {
  const row = await env.DB.prepare(
    `SELECT cluster_id FROM pins WHERE expires_at > ? ORDER BY created_at DESC LIMIT 1`,
  )
    .bind(now)
    .first<{ cluster_id: number }>();
  return row?.cluster_id ?? null;
}
