import { describe, expect, it } from "vitest";
import { parseOpml } from "../app/lib/feeds/opml";

const OPML = `<?xml version="1.0"?>
<opml version="2.0">
  <head><title>Subscriptions</title></head>
  <body>
    <outline text="Security">
      <outline type="rss" text="Krebs on Security" xmlUrl="https://krebsonsecurity.com/feed/" htmlUrl="https://krebsonsecurity.com"/>
      <outline type="rss" title="Schneier" xmlUrl="https://schneier.com/feed"/>
    </outline>
    <outline text="AI">
      <outline type="rss" text="Import AI" xmlUrl="https://importai.substack.com/feed"/>
      <outline text="Research">
        <outline type="rss" text="BAIR" xmlUrl="https://bair.berkeley.edu/blog/feed.xml"/>
      </outline>
    </outline>
    <outline type="rss" text="Loose feed" xmlUrl="https://example.com/feed"/>
    <outline type="rss" text="Duplicate" xmlUrl="https://krebsonsecurity.com/feed/"/>
  </body>
</opml>`;

describe("parseOpml", () => {
  it("finds every feed, including nested ones", () => {
    const feeds = parseOpml(OPML);
    expect(feeds.map((f) => f.name)).toContain("BAIR");
    expect(feeds.map((f) => f.name)).toContain("Loose feed");
  });

  it("keeps the enclosing folder as a section hint", () => {
    const feeds = parseOpml(OPML);
    expect(feeds.find((f) => f.name === "Krebs on Security")?.folder).toBe("Security");
    // A nested folder wins over its parent.
    expect(feeds.find((f) => f.name === "BAIR")?.folder).toBe("Research");
    expect(feeds.find((f) => f.name === "Loose feed")?.folder).toBeNull();
  });

  it("prefers title over text, and captures homepage", () => {
    const feeds = parseOpml(OPML);
    expect(feeds.find((f) => f.feedUrl === "https://schneier.com/feed")?.name).toBe("Schneier");
    expect(feeds.find((f) => f.name === "Krebs on Security")?.homepage).toBe(
      "https://krebsonsecurity.com",
    );
  });

  it("drops a feed listed twice", () => {
    const urls = parseOpml(OPML).map((f) => f.feedUrl);
    expect(urls.filter((u) => u === "https://krebsonsecurity.com/feed/")).toHaveLength(1);
  });

  it("returns nothing for a non-OPML document", () => {
    expect(parseOpml("<html><body>nope</body></html>")).toEqual([]);
    expect(parseOpml("")).toEqual([]);
  });
});
