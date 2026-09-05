import { classify } from "./classify";
import { canonicalizeUrl, urlHash } from "./feeds/canonicalize";
import { fetchFeed } from "./feeds/fetch";
import { normalizeTitle } from "./feeds/normalize";
import { parseFeed } from "./feeds/parse";
import { recordRun } from "./runs.server";

export type CollectMessage = { sourceIds: number[] };

type SourceRow = {
  id: number;
  name: string;
  feed_url: string;
  section: string;
  weight: number;
  poll_interval: number;
  etag: string | null;
  last_modified: string | null;
  last_fetched_at: number | null;
  content_hash: string | null;
  consecutive_failures: number;
};

/** Steady-state window: anything older than this is history, not news. */
const MAX_ITEM_AGE_SECONDS = 14 * 24 * 3600;

/**
 * On a source's very first collection the window is ignored for the newest few
 * items. A blog that posts monthly has nothing inside 14 days, and without this
 * it would look permanently silent.
 */
const FIRST_RUN_ITEMS = 8;

export async function runCollectBatch(
  batch: MessageBatch<CollectMessage>,
  env: Env,
): Promise<void> {
  const started = Date.now();
  let fetched = 0;
  let unchanged = 0;
  let inserted = 0;
  let failed = 0;

  // One message can carry several sources, so the guard is per *source*: an
  // unexpected throw from one must not force a retry that re-polls the
  // neighbours that already succeeded. Ordinary fetch failures never reach
  // here — collectSource records them and backs the source off itself — so
  // anything caught below is genuinely unexpected.
  for (const message of batch.messages) {
    // The sources in a message are fetched together, not one after another.
    // Sequentially, a message carrying four sources took as long as their
    // timeouts summed — up to 100 seconds at a 25s timeout — and the sweep
    // fell behind its two-minute target the moment messages started carrying
    // more than one. They are independent HTTP calls, so there is no reason
    // for the second to wait on the first.
    const outcomes = await Promise.allSettled(
      message.body.sourceIds.map((sourceId) => collectSource(env, sourceId)),
    );
    for (const [i, outcome] of outcomes.entries()) {
      if (outcome.status === "fulfilled") {
        fetched++;
        inserted += outcome.value.inserted;
        if (outcome.value.unchanged) unchanged++;
      } else {
        failed++;
        console.error("collect failed", message.body.sourceIds[i], outcome.reason);
      }
    }
    // Acked either way: a source that threw has had its failure recorded and
    // comes round again on its own schedule, and retrying the message would
    // re-fetch everything else in it for nothing.
    message.ack();
  }

  await recordRun(env, {
    stage: "collect",
    startedAt: started,
    counts: { fetched, unchanged, inserted, failed },
  });
}

/**
 * Handle a WebSub push. Same parse-and-store path as a poll, minus the fetch —
 * the hub already handed us the body.
 */
export async function collectFromPush(
  env: Env,
  sourceId: number,
  body: string,
  contentType: string | null,
): Promise<number> {
  const source = await env.DB.prepare(
    `SELECT id, name, feed_url, section, weight, poll_interval,
            etag, last_modified, content_hash, consecutive_failures, last_fetched_at
       FROM sources WHERE id = ?`,
  )
    .bind(sourceId)
    .first<SourceRow>();
  if (!source) return 0;

  const now = Math.floor(Date.now() / 1000);
  const feed = parseFeed(body, contentType ?? "");
  const inserted = await storeItems(env, source, feed.items, now, source.last_fetched_at === null);

  await env.DB.prepare(
    `UPDATE sources SET last_fetched_at = ?, last_status = 'push', consecutive_failures = 0
      WHERE id = ?`,
  )
    .bind(now, sourceId)
    .run();

  await recordRun(env, { stage: "websub-push", startedAt: Date.now(), counts: { inserted } });
  return inserted;
}

async function collectSource(
  env: Env,
  sourceId: number,
): Promise<{ inserted: number; unchanged: boolean }> {
  const source = await env.DB.prepare(
    `SELECT id, name, feed_url, section, weight, poll_interval,
            etag, last_modified, content_hash, consecutive_failures, last_fetched_at
       FROM sources WHERE id = ?`,
  )
    .bind(sourceId)
    .first<SourceRow>();

  if (!source) throw new Error(`no such source: ${sourceId}`);

  const now = Math.floor(Date.now() / 1000);
  const outcome = await fetchFeed(source.feed_url, {
    etag: source.etag,
    lastModified: source.last_modified,
    contentHash: source.content_hash,
  });

  if (outcome.status === "not-modified") {
    await env.DB.prepare(
      `UPDATE sources SET last_fetched_at = ?, last_status = '304', consecutive_failures = 0
        WHERE id = ?`,
    )
      .bind(now, sourceId)
      .run();
    return { inserted: 0, unchanged: true };
  }

  if (outcome.status === "error") {
    await markFailure(env, source, outcome.detail, outcome.retryAfterSeconds, now);
    return { inserted: 0, unchanged: false };
  }

  const feed = parseFeed(outcome.body, outcome.contentType);
  const firstRun = source.last_fetched_at === null;
  const inserted = await storeItems(env, source, feed.items, now, firstRun);

  await env.DB.prepare(
    `UPDATE sources
        SET last_fetched_at = ?, last_status = 'ok', consecutive_failures = 0,
            etag = ?, last_modified = ?, content_hash = ?,
            websub_hub = COALESCE(?, websub_hub),
            items_per_day = (items_per_day * 0.8) + (? * 0.2)
      WHERE id = ?`,
  )
    .bind(
      now,
      outcome.etag,
      outcome.lastModified,
      outcome.contentHash,
      feed.hub,
      inserted,
      sourceId,
    )
    .run();

  return { inserted, unchanged: false };
}

/**
 * How far back a repeated headline from one source counts as a repost.
 *
 * Measured, not guessed. Across the live corpus the only genuine same-source
 * duplicate — a link posted twice to r/devops — was 0.3 hours apart, while the
 * legitimate repeats were Rock Paper Shotgun's weekly columns ("The Sunday
 * Papers", "What are we all playing this weekend?") at exactly 168 and 169
 * hours. Anything between those two works; 48 hours sits well clear of both
 * and matches the clustering window, which is the same idea applied to one
 * publisher instead of many.
 */
const REPOST_WINDOW_SECONDS = 48 * 3600;

/** A headline reduced to the parts that decide whether it is the same story. */
export function titleKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

async function storeItems(
  env: Env,
  source: SourceRow,
  items: Awaited<ReturnType<typeof parseFeed>>["items"],
  now: number,
  firstRun: boolean,
): Promise<number> {
  const statements: D1PreparedStatement[] = [];

  // The URL hash catches an item republished at the same address. It does not
  // catch the same story posted twice at different addresses, which is what a
  // Reddit repost or a re-published article looks like — so recent headlines
  // from this source are checked too.
  const recent = await env.DB.prepare(
    `SELECT title FROM articles WHERE source_id = ? AND fetched_at >= ?`,
  )
    .bind(source.id, now - REPOST_WINDOW_SECONDS)
    .all<{ title: string }>();
  const seenTitles = new Set((recent.results ?? []).map((r) => titleKey(r.title)));

  for (const [index, item] of items.entries()) {
    const seeding = firstRun && index < FIRST_RUN_ITEMS;
    if (!seeding && item.publishedAt && now - item.publishedAt > MAX_ITEM_AGE_SECONDS) continue;

    const canonical = canonicalizeUrl(item.link);
    if (!/^https?:\/\//i.test(canonical)) continue;

    const { title, badge } = normalizeTitle(item.title, source.name);
    if (!title) continue;

    // Also guards against one feed carrying the same item twice in a single
    // fetch, which some aggregators do.
    const key = titleKey(title);
    if (key.length > 0) {
      if (seenTitles.has(key)) continue;
      seenTitles.add(key);
    }

    const { section, topics, score } = classify({
      title,
      excerpt: item.excerpt,
      sourceSection: source.section,
      sourceWeight: source.weight,
      publishedAt: item.publishedAt,
      engagement: item.engagement,
      now,
    });

    statements.push(
      env.DB.prepare(
        `INSERT INTO articles
           (url_canonical, url_hash, source_id, title, title_raw, badge, author, excerpt,
            image_url, published_at, fetched_at, section, topics_json,
            heuristic_score, engagement_score, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'live')
         ON CONFLICT (url_hash) DO NOTHING`,
      ).bind(
        canonical,
        await urlHash(canonical),
        source.id,
        title,
        item.title,
        badge,
        item.author,
        item.excerpt?.slice(0, 1200) ?? null,
        item.imageUrl,
        item.publishedAt,
        now,
        section,
        JSON.stringify(topics),
        score,
        item.engagement,
      ),
    );
  }

  if (statements.length === 0) return 0;

  const results = await env.DB.batch(statements);
  return results.reduce((total, r) => total + (r.meta.changed_db ? 1 : 0), 0);
}

async function markFailure(
  env: Env,
  source: SourceRow,
  detail: string,
  retryAfterSeconds: number | null,
  now: number,
): Promise<void> {
  const failures = source.consecutive_failures + 1;

  // Exponential backoff on top of the source's own interval, capped at 6 hours,
  // and always at least what a Retry-After header asked for.
  const backoff = Math.min(source.poll_interval * 2 ** Math.min(failures, 5), 21_600);
  const delay = Math.max(backoff, retryAfterSeconds ?? 0);

  await env.DB.prepare(
    `UPDATE sources
        SET last_fetched_at = ?, last_status = ?, consecutive_failures = ?, next_poll_at = ?
      WHERE id = ?`,
  )
    .bind(now, detail.slice(0, 120), failures, now + delay, source.id)
    .run();
}
