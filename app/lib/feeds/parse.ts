import { XMLParser } from "fast-xml-parser";
import { decodeEntities } from "./normalize";

export type FeedItem = {
  title: string;
  link: string;
  publishedAt: number | null; // unix seconds
  excerpt: string | null;
  author: string | null;
  imageUrl: string | null;
  engagement: number; // HN points, Reddit score — 0 when the feed carries none
};

export type ParsedFeed = {
  items: FeedItem[];
  /** WebSub hub, when the feed advertises one. */
  hub: string | null;
  self: string | null;
};

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  // Feeds are wildly inconsistent about whether a single item is an array.
  isArray: (name) => ["item", "entry", "link", "category", "enclosure"].includes(name),
  trimValues: true,
  parseTagValue: false,
  processEntities: true,
});

/** fast-xml-parser hands back a string, an object with #text, or an array. */
function text(node: unknown): string | null {
  if (node == null) return null;
  if (typeof node === "string") return node.trim() || null;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return text(node[0]);
  if (typeof node === "object") {
    const record = node as Record<string, unknown>;
    return text(record["#text"] ?? record["@href"] ?? null);
  }
  return null;
}

function toEpochSeconds(value: string | null): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return null;
  const seconds = Math.floor(ms / 1000);
  // Guard against feeds dated in 1970 or far in the future.
  const now = Math.floor(Date.now() / 1000);
  if (seconds < 946_684_800 || seconds > now + 86_400) return null;
  return seconds;
}

function stripHtml(html: string | null): string | null {
  if (!html) return null;
  const plain = decodeEntities(html.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
  return plain || null;
}

function firstImage(node: Record<string, unknown>, body: string | null): string | null {
  const media = node["media:thumbnail"] ?? node["media:content"];
  const fromMedia = Array.isArray(media)
    ? (media[0] as Record<string, unknown> | undefined)?.["@url"]
    : (media as Record<string, unknown> | undefined)?.["@url"];
  if (typeof fromMedia === "string") return fromMedia;

  const enclosures = node.enclosure;
  if (Array.isArray(enclosures)) {
    for (const raw of enclosures) {
      const enc = raw as Record<string, unknown>;
      const type = String(enc["@type"] ?? "");
      const url = enc["@url"];
      if (typeof url === "string" && type.startsWith("image/")) return url;
    }
  }

  if (body) {
    const match = /<img[^>]+src=["']([^"']+)["']/i.exec(body);
    if (match?.[1]) return match[1];
  }
  return null;
}

/** Atom uses <link rel="alternate">; RSS uses a plain <link> string. */
function atomLink(entry: Record<string, unknown>): string | null {
  const links = entry.link;
  if (!Array.isArray(links)) return text(links);
  const alternate = links.find((l) => {
    const rel = (l as Record<string, unknown>)["@rel"];
    return rel === undefined || rel === "alternate";
  });
  const chosen = (alternate ?? links[0]) as Record<string, unknown> | undefined;
  const href = chosen?.["@href"];
  return typeof href === "string" ? href : text(links);
}

function discoverHub(links: unknown): { hub: string | null; self: string | null } {
  const out = { hub: null as string | null, self: null as string | null };
  if (!Array.isArray(links)) return out;
  for (const raw of links) {
    const link = raw as Record<string, unknown>;
    const rel = link["@rel"];
    const href = link["@href"];
    if (typeof href !== "string") continue;
    if (rel === "hub") out.hub = href;
    if (rel === "self") out.self = href;
  }
  return out;
}

function parseJsonFeed(body: string): ParsedFeed | null {
  let doc: Record<string, unknown>;
  try {
    doc = JSON.parse(body) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!Array.isArray(doc.items)) return null;

  const items: FeedItem[] = [];
  for (const raw of doc.items) {
    const item = raw as Record<string, unknown>;
    const link = typeof item.url === "string" ? item.url : null;
    const title = typeof item.title === "string" ? item.title : null;
    if (!link || !title) continue;

    const author = item.author as Record<string, unknown> | undefined;
    items.push({
      title,
      link,
      publishedAt: toEpochSeconds(
        typeof item.date_published === "string" ? item.date_published : null,
      ),
      excerpt:
        stripHtml(typeof item.content_html === "string" ? item.content_html : null) ??
        (typeof item.content_text === "string" ? item.content_text : null) ??
        (typeof item.summary === "string" ? item.summary : null),
      author: typeof author?.name === "string" ? author.name : null,
      imageUrl: typeof item.image === "string" ? item.image : null,
      engagement: 0,
    });
  }

  const hubs = doc.hubs as { url?: string }[] | undefined;
  return {
    items,
    hub: Array.isArray(hubs) && typeof hubs[0]?.url === "string" ? hubs[0].url : null,
    self: typeof doc.feed_url === "string" ? doc.feed_url : null,
  };
}

/** Reddit and HN put the score in the body; pull it out as an engagement hint. */
function engagementFrom(body: string | null): number {
  if (!body) return 0;
  const match = /\b(\d+)\s*(?:points?|upvotes?)\b/i.exec(body);
  return match?.[1] ? Number.parseInt(match[1], 10) : 0;
}

export function parseFeed(body: string, contentType = ""): ParsedFeed {
  if (contentType.includes("json") || body.trimStart().startsWith("{")) {
    const json = parseJsonFeed(body);
    if (json) return json;
  }

  const doc = parser.parse(body) as Record<string, unknown>;

  // ── RSS 2.0 ──
  const rss = doc.rss as Record<string, unknown> | undefined;
  const channel = rss?.channel as Record<string, unknown> | undefined;
  if (channel) {
    const raw = (channel.item ?? []) as Record<string, unknown>[];
    const { hub, self } = discoverHub(channel["atom:link"] ?? channel.link);
    return {
      hub,
      self,
      items: raw.flatMap((item) => {
        const link = text(item.link) ?? text(item.guid);
        const title = text(item.title);
        if (!link || !title) return [];
        const body = text(item["content:encoded"]) ?? text(item.description);
        return [
          {
            title,
            link,
            publishedAt: toEpochSeconds(text(item.pubDate) ?? text(item["dc:date"])),
            excerpt: stripHtml(body),
            author: text(item["dc:creator"]) ?? text(item.author),
            imageUrl: firstImage(item, body),
            engagement: engagementFrom(body),
          },
        ];
      }),
    };
  }

  // ── Atom ──
  const feed = doc.feed as Record<string, unknown> | undefined;
  if (feed) {
    const raw = (feed.entry ?? []) as Record<string, unknown>[];
    const { hub, self } = discoverHub(feed.link);
    return {
      hub,
      self,
      items: raw.flatMap((entry) => {
        const link = atomLink(entry);
        const title = text(entry.title);
        if (!link || !title) return [];
        const body = text(entry.content) ?? text(entry.summary);
        const author = entry.author as Record<string, unknown> | undefined;
        return [
          {
            title,
            link,
            publishedAt: toEpochSeconds(text(entry.published) ?? text(entry.updated)),
            excerpt: stripHtml(body),
            author: text(author?.name),
            imageUrl: firstImage(entry, body),
            engagement: engagementFrom(body),
          },
        ];
      }),
    };
  }

  return { items: [], hub: null, self: null };
}
