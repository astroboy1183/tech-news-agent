/**
 * Finding new sources without being told about them.
 *
 * The candidates come from work the pipeline already does. Aggregator feeds —
 * Hacker News, Lobsters — link *out*, to whatever a technical audience thought
 * worth reading, so their article URLs point at domains we may not follow. A
 * domain that shows up there repeatedly has been vouched for by people, which
 * is a better filter than any list I could write.
 *
 * Three things keep this from turning into a firehose of blogs:
 *
 *  1. **A sighting threshold.** One link is somebody's weekend project; several
 *     independent links is a publication.
 *  2. **A denylist of platforms.** github.com is not a publisher, it is where
 *     publishers keep their code. Same for package registries, social sites and
 *     the aggregators themselves.
 *  3. **A weekly cap.** Growth should be gradual enough to notice, and every
 *     new source costs a poll every two minutes forever.
 *
 * New sources start at low weight and have to earn their place: the weekly
 * agent promotes what gets corroborated and retires what stops answering.
 */

import { SECTIONS, type Section } from "./classify";
import { parseFeed } from "./feeds/parse";
import { recordRun } from "./runs.server";

/** Times a domain must appear before it is worth probing. */
const MIN_SIGHTINGS = 2;

/** Sources added per run. Growth should be visible, not overwhelming. */
const MAX_NEW_PER_RUN = 10;

/** Domains probed per run, whether or not they yield a feed. */
const MAX_PROBES_PER_RUN = 40;

/** How far back sightings are counted. */
const WINDOW_DAYS = 30;

/** A feed must carry at least this many usable items to be worth adding. */
const MIN_ITEMS = 3;

/**
 * Hosts that will never be a source.
 *
 * Code forges, package registries, social platforms and the aggregators
 * themselves. They are linked constantly and publish nothing of their own that
 * belongs in a news portal.
 */
const DENY_HOSTS = new Set([
  "github.com",
  "gist.github.com",
  "gitlab.com",
  "codeberg.org",
  "sourceforge.net",
  "bitbucket.org",
  "npmjs.com",
  "pypi.org",
  "crates.io",
  "hub.docker.com",
  "stackoverflow.com",
  "serverfault.com",
  "superuser.com",
  "news.ycombinator.com",
  "lobste.rs",
  "reddit.com",
  "old.reddit.com",
  "redd.it",
  "i.redd.it",
  "preview.redd.it",
  "v.redd.it",
  "twitter.com",
  "x.com",
  "mastodon.social",
  "bsky.app",
  "linkedin.com",
  "facebook.com",
  "youtube.com",
  "youtu.be",
  "vimeo.com",
  "imgur.com",
  "wikipedia.org",
  "en.wikipedia.org",
  "archive.org",
  "web.archive.org",
  "arxiv.org",
  "doi.org",
  "docs.google.com",
  "drive.google.com",
  "paypal.com",
  "patreon.com",
  "amazon.com",
  "apple.com",
  "play.google.com",
]);

/** Suffixes that mark a host as infrastructure rather than a publication. */
const DENY_SUFFIXES = [".github.io", ".gitlab.io", ".readthedocs.io", ".pages.dev", ".workers.dev"];

/** Paths tried when a homepage declares no feed of its own. */
const COMMON_FEED_PATHS = [
  "/feed",
  "/feed/",
  "/rss",
  "/rss.xml",
  "/feed.xml",
  "/atom.xml",
  "/index.xml",
  "/blog/feed",
  "/blog/rss",
];

/** Remembers probed domains so a dead end is not retried every week. */
const MEMO_PREFIX = "discover:tried:";
const MEMO_TTL_SECONDS = 45 * 86400;

export type Candidate = { host: string; sightings: number; section: Section };

export type DiscoveryReport = {
  scanned: number;
  candidates: number;
  probed: number;
  added: { host: string; feedUrl: string; section: string; items: number }[];
  rejected: { host: string; reason: string }[];
};

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function isDenied(host: string): boolean {
  if (DENY_HOSTS.has(host)) return true;
  if (DENY_SUFFIXES.some((s) => host.endsWith(s))) return true;
  // A bare platform subdomain is not a publication, but foo.substack.com is.
  return host === "substack.com" || host === "wordpress.com" || host === "blogspot.com";
}

/** Aggregators link out; everything else publishes its own domain. */
const AGGREGATOR_KINDS = new Set(["hn", "reddit"]);

/**
 * Domains our articles link to that we do not already follow.
 *
 * Coverage is judged on **who produced the article, not on the feed's
 * address**. Comparing hostnames looked right and was wrong within one run: a
 * publisher's feed usually lives somewhere else entirely — Ars Technica
 * publishes at arstechnica.com but its feed is on feeds.arstechnica.com, and
 * The Hacker News' feed is on feedburner.com — so a hostname check re-proposed
 * five publishers we already had, under a second feed URL each.
 *
 * The reliable signal is already in the database: if any *non-aggregator*
 * source has ever produced an article on a host, we are receiving that
 * publisher's content and the host is covered, whatever its feed looks like.
 * A host that reaches us only through Hacker News or Reddit is genuinely new.
 */
export async function harvestCandidates(env: Env): Promise<Candidate[]> {
  const since = Math.floor(Date.now() / 1000) - WINDOW_DAYS * 86400;

  const known = await env.DB.prepare(`SELECT feed_url, homepage FROM sources`).all<{
    feed_url: string;
    homepage: string | null;
  }>();
  const covered = new Set<string>();
  for (const row of known.results ?? []) {
    const a = hostOf(row.feed_url);
    const b = row.homepage ? hostOf(row.homepage) : null;
    if (a) covered.add(a);
    if (b) covered.add(b);
  }

  const rows = await env.DB.prepare(
    `SELECT a.url_canonical, a.section, s.kind
       FROM articles a JOIN sources s ON s.id = a.source_id
      WHERE a.fetched_at >= ?
      LIMIT 20000`,
  )
    .bind(since)
    .all<{ url_canonical: string; section: string; kind: string }>();

  // First pass: any host a real publisher feed has produced is already ours.
  for (const row of rows.results ?? []) {
    if (AGGREGATOR_KINDS.has(row.kind)) continue;
    const host = hostOf(row.url_canonical);
    if (host) covered.add(host);
  }

  const tally = new Map<string, { n: number; sections: Map<string, number> }>();
  for (const row of rows.results ?? []) {
    const host = hostOf(row.url_canonical);
    if (!host || covered.has(host) || isDenied(host)) continue;
    const entry = tally.get(host) ?? { n: 0, sections: new Map() };
    entry.n++;
    entry.sections.set(row.section, (entry.sections.get(row.section) ?? 0) + 1);
    tally.set(host, entry);
  }

  const candidates: Candidate[] = [];
  for (const [host, entry] of tally) {
    if (entry.n < MIN_SIGHTINGS) continue;
    // The section its articles were classified into is a better first guess
    // than any default.
    const section = [...entry.sections.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "software";
    candidates.push({
      host,
      sightings: entry.n,
      section: (SECTIONS.includes(section as Section) ? section : "software") as Section,
    });
  }
  return candidates.sort((a, b) => b.sightings - a.sightings);
}

/** A feed URL declared by the page itself, if there is one. */
function declaredFeed(html: string, base: string): string | null {
  const links = html.matchAll(/<link\b[^>]*>/gi);
  for (const [tag] of links) {
    if (!/rel\s*=\s*["']?alternate/i.test(tag)) continue;
    if (!/type\s*=\s*["']?application\/(rss|atom)\+xml/i.test(tag)) continue;
    const href = /href\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    if (!href) continue;
    try {
      return new URL(href, base).toString();
    } catch {
      /* a malformed href is not worth failing the probe over */
    }
  }
  return null;
}

async function get(url: string, timeoutMs = 12_000): Promise<Response | null> {
  try {
    return await fetch(url, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (compatible; TechNewsAgent/1.0; +https://github.com/astroboy1183/tech-news-agent) FeedFetcher-Google",
        accept: "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/html;q=0.8",
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return null;
  }
}

/** Confirms a URL really is a feed with items, rather than a page that 200s. */
async function verifyFeed(url: string): Promise<{ ok: boolean; items: number }> {
  const response = await get(url);
  if (!response?.ok) return { ok: false, items: 0 };
  const body = await response.text();
  if (body.length > 5_000_000) return { ok: false, items: 0 };
  try {
    const feed = parseFeed(body, response.headers.get("content-type") ?? "");
    const usable = feed.items.filter((i) => i.title && i.link).length;
    return { ok: usable >= MIN_ITEMS, items: usable };
  } catch {
    return { ok: false, items: 0 };
  }
}

/** Ask the homepage first; fall back to the paths most publishers use. */
export async function findFeed(host: string): Promise<{ url: string; items: number } | null> {
  const home = `https://${host}/`;
  const page = await get(home);
  if (page?.ok) {
    const declared = declaredFeed(await page.text(), home);
    if (declared) {
      const check = await verifyFeed(declared);
      if (check.ok) return { url: declared, items: check.items };
    }
  }
  for (const path of COMMON_FEED_PATHS) {
    const check = await verifyFeed(`https://${host}${path}`);
    if (check.ok) return { url: `https://${host}${path}`, items: check.items };
  }
  return null;
}

export async function discoverSources(env: Env): Promise<DiscoveryReport> {
  const startedAt = Date.now();
  const candidates = await harvestCandidates(env);

  const report: DiscoveryReport = {
    scanned: candidates.length,
    candidates: candidates.length,
    probed: 0,
    added: [],
    rejected: [],
  };

  for (const candidate of candidates) {
    if (report.added.length >= MAX_NEW_PER_RUN) break;
    if (report.probed >= MAX_PROBES_PER_RUN) break;

    const memoKey = `${MEMO_PREFIX}${candidate.host}`;
    if (await env.CACHE.get(memoKey)) continue;

    report.probed++;
    const found = await findFeed(candidate.host);

    // Remembered either way: a domain with no feed should not be re-probed
    // every week, and one that was added is covered from now on anyway.
    await env.CACHE.put(memoKey, found ? "added" : "none", {
      expirationTtl: MEMO_TTL_SECONDS,
    });

    if (!found) {
      report.rejected.push({ host: candidate.host, reason: "no usable feed" });
      continue;
    }

    // Low weight and tier C: it has to earn its place. The weekly agent
    // promotes what gets corroborated and retires what stops answering.
    await env.DB.prepare(
      `INSERT INTO sources
         (name, homepage, feed_url, kind, section, weight, tier, poll_interval, next_poll_at)
       VALUES (?, ?, ?, 'rss', ?, 0.6, 'C', 120, 0)
       ON CONFLICT (feed_url) DO NOTHING`,
    )
      .bind(candidate.host, `https://${candidate.host}/`, found.url, candidate.section)
      .run();

    report.added.push({
      host: candidate.host,
      feedUrl: found.url,
      section: candidate.section,
      items: found.items,
    });
  }

  await recordRun(env, {
    stage: "discover",
    startedAt,
    counts: {
      candidates: report.candidates,
      probed: report.probed,
      added: report.added.length,
      rejected: report.rejected.length,
    },
  });

  return report;
}
