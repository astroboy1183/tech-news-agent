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

  // Per-message try/catch: an uncaught error retries the whole batch and
  // re-polls sources that already succeeded.
  for (const message of batch.messages) {
    try {
      for (const sourceId of message.body.sourceIds) {
        const result = await collectSource(env, sourceId);
        fetched++;
        inserted += result.inserted;
        if (result.unchanged) unchanged++;
      }
      message.ack();
    } catch (error) {
      failed++;
      console.error("collect failed", message.body.sourceIds, error);
      message.retry();
    }
  }

  await recordRun(env, {
    stage: "collect",
    startedAt: started,
    counts: { fetched, unchanged, inserted, failed },
  });
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

async function storeItems(
  env: Env,
  source: SourceRow,
  items: Awaited<ReturnType<typeof parseFeed>>["items"],
  now: number,
  firstRun: boolean,
): Promise<number> {
  const statements: D1PreparedStatement[] = [];

  for (const [index, item] of items.entries()) {
    const seeding = firstRun && index < FIRST_RUN_ITEMS;
    if (!seeding && item.publishedAt && now - item.publishedAt > MAX_ITEM_AGE_SECONDS) continue;

    const canonical = canonicalizeUrl(item.link);
    if (!/^https?:\/\//i.test(canonical)) continue;

    const { title, badge } = normalizeTitle(item.title, source.name);
    if (!title) continue;

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
