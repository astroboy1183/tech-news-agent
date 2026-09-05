import { describe, expect, it } from "vitest";
import { parseFeed } from "../app/lib/feeds/parse";

const RSS = `<?xml version="1.0"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"
     xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Phoronix</title>
    <atom:link rel="hub" href="https://pubsubhubbub.appspot.com/"/>
    <atom:link rel="self" href="https://phoronix.com/rss.php"/>
    <item>
      <title>Linux 6.19 merge window opens</title>
      <link>https://phoronix.com/news/linux-619</link>
      <description>&lt;p&gt;The &lt;b&gt;scheduler&lt;/b&gt; rewrite lands.&lt;/p&gt;</description>
      <pubDate>Sat, 05 Sep 2026 09:12:00 GMT</pubDate>
      <dc:creator>Michael Larabel</dc:creator>
      <media:thumbnail url="https://phoronix.com/img/619.jpg"/>
    </item>
    <item>
      <title>No link here</title>
    </item>
  </channel>
</rss>`;

const ATOM = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <link rel="self" href="https://lwn.net/headlines/newrss"/>
  <link rel="hub" href="https://hub.example/"/>
  <entry>
    <title>The new scheduler merged for 6.19</title>
    <link rel="alternate" href="https://lwn.net/Articles/1/"/>
    <link rel="replies" href="https://lwn.net/Articles/1/comments"/>
    <published>2026-09-05T09:26:00Z</published>
    <author><name>Jonathan Corbet</name></author>
    <summary>A long look at the merge, 412 points of discussion.</summary>
  </entry>
</feed>`;

const JSONFEED = JSON.stringify({
  version: "https://jsonfeed.org/version/1.1",
  feed_url: "https://example.com/feed.json",
  items: [
    {
      title: "Bun ships a native SQL driver",
      url: "https://bun.sh/blog/sql",
      date_published: "2026-09-05T08:00:00Z",
      content_html: "<p>Postgres, natively.</p>",
      author: { name: "Jarred" },
      image: "https://bun.sh/og.png",
    },
  ],
});

describe("parseFeed", () => {
  it("reads RSS 2.0 including media, author and hub", () => {
    const feed = parseFeed(RSS);
    expect(feed.items).toHaveLength(1); // the item without a link is dropped
    const item = feed.items[0]!;
    expect(item.title).toBe("Linux 6.19 merge window opens");
    expect(item.link).toBe("https://phoronix.com/news/linux-619");
    expect(item.excerpt).toBe("The scheduler rewrite lands.");
    expect(item.author).toBe("Michael Larabel");
    expect(item.imageUrl).toBe("https://phoronix.com/img/619.jpg");
    expect(item.publishedAt).toBeGreaterThan(1_700_000_000);
    expect(feed.hub).toBe("https://pubsubhubbub.appspot.com/");
  });

  it("reads Atom and picks the alternate link, not replies", () => {
    const feed = parseFeed(ATOM);
    const item = feed.items[0]!;
    expect(item.link).toBe("https://lwn.net/Articles/1/");
    expect(item.author).toBe("Jonathan Corbet");
    expect(item.engagement).toBe(412);
    expect(feed.hub).toBe("https://hub.example/");
  });

  it("reads JSON Feed", () => {
    const feed = parseFeed(JSONFEED, "application/feed+json");
    const item = feed.items[0]!;
    expect(item.title).toBe("Bun ships a native SQL driver");
    expect(item.excerpt).toBe("Postgres, natively.");
    expect(item.imageUrl).toBe("https://bun.sh/og.png");
  });

  it("rejects an implausible date rather than storing 1970", () => {
    const feed = parseFeed(RSS.replace("Sat, 05 Sep 2026 09:12:00 GMT", "not a date"));
    expect(feed.items[0]!.publishedAt).toBeNull();
  });

  it("returns nothing for junk instead of throwing", () => {
    expect(parseFeed("<html><body>not a feed</body></html>").items).toEqual([]);
    expect(parseFeed("").items).toEqual([]);
  });
});
