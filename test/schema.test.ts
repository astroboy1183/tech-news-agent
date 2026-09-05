import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("schema", () => {
  it("creates every table the pipeline needs", async () => {
    const { results } = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
    ).all<{ name: string }>();
    const names = results.map((r: { name: string }) => r.name);

    for (const table of [
      "sources",
      "articles",
      "clusters",
      "enrichments",
      "digests",
      "digest_items",
      "pins",
      "feedback",
      "preferences",
      "runs",
      "deliveries",
      "subscribers",
    ]) {
      expect(names).toContain(table);
    }
  });

  it("keeps the FTS index in step with articles", async () => {
    await env.DB.prepare(
      `INSERT INTO sources (name, feed_url, section) VALUES ('T', 'https://t.example/f', 'ai')`,
    ).run();
    const src = await env.DB.prepare(
      "SELECT id FROM sources WHERE feed_url='https://t.example/f'",
    ).first<{ id: number }>();

    await env.DB.prepare(
      `INSERT INTO articles (url_canonical, url_hash, source_id, title, excerpt, fetched_at, section)
       VALUES ('https://t.example/a', 'hash-1', ?, 'Scheduler rewrite lands', 'kernel news', 1, 'os')`,
    )
      .bind(src!.id)
      .run();

    const hit = await env.DB.prepare(
      "SELECT rowid FROM articles_fts WHERE articles_fts MATCH 'scheduler'",
    ).first();
    expect(hit).not.toBeNull();
  });

  it("rejects a duplicate url_hash", async () => {
    await env.DB.prepare(
      `INSERT INTO sources (name, feed_url, section) VALUES ('D', 'https://d.example/f', 'ai')`,
    ).run();
    const src = await env.DB.prepare(
      "SELECT id FROM sources WHERE feed_url='https://d.example/f'",
    ).first<{ id: number }>();

    const insert = () =>
      env.DB.prepare(
        `INSERT INTO articles (url_canonical, url_hash, source_id, title, fetched_at, section)
         VALUES ('https://d.example/a', 'dupe', ?, 'One', 1, 'ai')`,
      )
        .bind(src!.id)
        .run();

    await insert();
    await expect(insert()).rejects.toThrow();
  });
});
