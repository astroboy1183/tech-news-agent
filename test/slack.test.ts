import { describe, expect, it } from "vitest";
import type { Digest } from "../app/lib/digest.server";
import type { Story } from "../app/lib/sections";
import { renderDigestBlocks } from "../app/lib/slack.server";

const ORIGIN = "https://news.example";

function story(over: Partial<Story> & { id: number }): Story {
  return {
    headline: "A headline",
    url: "https://outlet.example/a",
    excerpt: null,
    imageUrl: null,
    section: "ai",
    summary: null,
    whyItMatters: null,
    topics: [],
    sourceCount: 1,
    sources: [],
    velocity: 0,
    score: 50,
    firstSeenAt: 1_800_000_000,
    lastSeenAt: 1_800_000_000,
    publishedAt: 1_800_000_000,
    ...over,
  };
}

function digest(over: Partial<Digest> = {}): Digest {
  return {
    date: "2026-09-05",
    lead: story({ id: 1, headline: "The lead story", sourceCount: 4 }),
    sections: [
      { section: "ai", label: "AI & ML", stories: [story({ id: 2 })] },
      { section: "security", label: "Security", stories: [story({ id: 3, sourceCount: 3 })] },
    ],
    counts: { stories: 40, articles: 60, corroborated: 9 },
    ...over,
  };
}

describe("renderDigestBlocks", () => {
  it("opens with the date and what the day held", () => {
    const blocks = renderDigestBlocks(digest(), ORIGIN);
    expect(blocks[0]).toMatchObject({ type: "header" });
    expect(JSON.stringify(blocks[0])).toContain("2026-09-05");
    expect(JSON.stringify(blocks[1])).toContain("40 stories");
    expect(JSON.stringify(blocks[1])).toContain("9 covered by more than one outlet");
  });

  it("escapes the three characters Slack's mrkdwn reserves", () => {
    const blocks = renderDigestBlocks(
      digest({ lead: story({ id: 1, headline: "AT&T sues <Foo> over >2x claims" }) }),
      ORIGIN,
    );
    const text = JSON.stringify(blocks);
    expect(text).toContain("AT&amp;T sues &lt;Foo&gt; over &gt;2x claims");
  });

  it("links a corroborated story to the story page, a lone one to its outlet", () => {
    const blocks = renderDigestBlocks(digest(), ORIGIN);
    const text = JSON.stringify(blocks);
    expect(text).toContain(`${ORIGIN}/story/3`);
    expect(text).toContain("https://outlet.example/a|A headline");
  });

  it("marks how many outlets filed a story", () => {
    const text = JSON.stringify(renderDigestBlocks(digest(), ORIGIN));
    expect(text).toContain("(3 outlets)");
  });

  it("stays inside Slack's block limit however many sections there are", () => {
    const many = digest({
      sections: Array.from({ length: 60 }, (_, i) => ({
        section: "ai" as const,
        label: `Section ${i}`,
        stories: [story({ id: 100 + i })],
      })),
    });
    expect(renderDigestBlocks(many, ORIGIN).length).toBeLessThanOrEqual(50);
  });

  it("renders without a lead rather than throwing", () => {
    const blocks = renderDigestBlocks(digest({ lead: null }), ORIGIN);
    expect(blocks.length).toBeGreaterThan(2);
  });

  it("always ends with a way back to the site", () => {
    const blocks = renderDigestBlocks(digest(), ORIGIN);
    expect(JSON.stringify(blocks[blocks.length - 1])).toContain(ORIGIN);
  });
});
