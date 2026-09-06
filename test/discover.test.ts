import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { harvestCandidates } from "../app/lib/discover.server";

async function seed() {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM articles"),
    env.DB.prepare("DELETE FROM sources"),
  ]);
  await env.DB.prepare(
    `INSERT INTO sources (id, name, homepage, feed_url, kind, section)
     VALUES (1, 'HN', 'https://news.ycombinator.com', 'https://news.ycombinator.com/rss', 'hn', 'software')`,
  ).run();
}

async function addArticle(id: number, url: string, section = "software") {
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `INSERT INTO articles (id, url_canonical, url_hash, source_id, title, fetched_at, section)
     VALUES (?, ?, ?, 1, ?, ?, ?)`,
  )
    .bind(id, url, `h${id}`, `Title ${id}`, now, section)
    .run();
}

describe("harvestCandidates", () => {
  it("proposes a domain seen more than once, and ignores a one-off", async () => {
    await seed();
    await addArticle(1, "https://goodblog.example/post-a");
    await addArticle(2, "https://goodblog.example/post-b");
    await addArticle(3, "https://seenonce.example/post");

    const found = await harvestCandidates(env);
    const hosts = found.map((c) => c.host);
    expect(hosts).toContain("goodblog.example");
    expect(hosts).not.toContain("seenonce.example");
  });

  it("never proposes a code forge, registry or aggregator", async () => {
    await seed();
    for (const [i, host] of [
      "github.com",
      "gitlab.com",
      "pypi.org",
      "reddit.com",
      "news.ycombinator.com",
      "youtube.com",
      "en.wikipedia.org",
      "arxiv.org",
    ].entries()) {
      await addArticle(100 + i * 2, `https://${host}/a`);
      await addArticle(101 + i * 2, `https://${host}/b`);
    }
    expect(await harvestCandidates(env)).toHaveLength(0);
  });

  it("ignores project-hosting subdomains, which are not publications", async () => {
    await seed();
    await addArticle(200, "https://someone.github.io/a");
    await addArticle(201, "https://someone.github.io/b");
    await addArticle(202, "https://docs.readthedocs.io/a");
    await addArticle(203, "https://docs.readthedocs.io/b");
    expect(await harvestCandidates(env)).toHaveLength(0);
  });

  it("does not propose a publisher we already receive, however its feed is addressed", async () => {
    // The case that broke the first version: Ars Technica publishes at
    // arstechnica.com but its feed lives on feeds.arstechnica.com, so a
    // hostname comparison re-proposed a publisher we already had.
    await seed();
    await env.DB.prepare(
      `INSERT INTO sources (id, name, homepage, feed_url, kind, section)
       VALUES (3, 'Ars', '', 'https://feeds.arstechnica.com/arstechnica/index', 'rss', 'industry')`,
    ).run();
    const now = Math.floor(Date.now() / 1000);
    for (const [i, u] of ["https://arstechnica.com/a", "https://arstechnica.com/b"].entries()) {
      await env.DB.prepare(
        `INSERT INTO articles (id, url_canonical, url_hash, source_id, title, fetched_at, section)
         VALUES (?, ?, ?, 3, 'T', ?, 'industry')`,
      )
        .bind(700 + i, u, `x${i}`, now)
        .run();
    }
    expect((await harvestCandidates(env)).map((c) => c.host)).not.toContain("arstechnica.com");
  });

  it("does not propose a publisher already followed, under either address", async () => {
    await seed();
    await env.DB.prepare(
      `INSERT INTO sources (id, name, homepage, feed_url, kind, section)
       VALUES (2, 'Known', 'https://known.example', 'https://feeds.known.example/rss', 'rss', 'ai')`,
    ).run();
    await addArticle(300, "https://known.example/a");
    await addArticle(301, "https://known.example/b");
    await addArticle(302, "https://feeds.known.example/c");
    await addArticle(303, "https://feeds.known.example/d");
    expect(await harvestCandidates(env)).toHaveLength(0);
  });

  it("treats www and bare hosts as the same publisher", async () => {
    await seed();
    await addArticle(400, "https://www.samesite.example/a");
    await addArticle(401, "https://samesite.example/b");
    const found = await harvestCandidates(env);
    expect(found.filter((c) => c.host === "samesite.example")).toHaveLength(1);
    expect(found[0]?.sightings).toBe(2);
  });

  it("guesses the section from where its articles were classified", async () => {
    await seed();
    await addArticle(500, "https://secblog.example/a", "security");
    await addArticle(501, "https://secblog.example/b", "security");
    await addArticle(502, "https://secblog.example/c", "ai");
    const found = await harvestCandidates(env);
    expect(found.find((c) => c.host === "secblog.example")?.section).toBe("security");
  });

  it("ranks the most-linked domain first", async () => {
    await seed();
    await addArticle(600, "https://often.example/a");
    await addArticle(601, "https://often.example/b");
    await addArticle(602, "https://often.example/c");
    await addArticle(603, "https://rarely.example/a");
    await addArticle(604, "https://rarely.example/b");
    const found = await harvestCandidates(env);
    expect(found[0]?.host).toBe("often.example");
  });
});
