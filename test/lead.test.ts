import { describe, expect, it } from "vitest";
import { chooseLead } from "../app/lib/lead.server";
import type { Story } from "../app/lib/sections";

const NOW = 1_800_000_000;

function story(over: Partial<Story> & { id: number }): Story {
  return {
    headline: "A sufficiently long and declarative headline about something",
    url: "https://example.com/a",
    excerpt: null,
    imageUrl: null,
    section: "ai",
    summary: null,
    whyItMatters: null,
    topics: [],
    sourceCount: 3,
    sources: ["A", "B", "C"],
    velocity: 1,
    score: 70,
    firstSeenAt: NOW - 3600,
    lastSeenAt: NOW - 600,
    publishedAt: NOW - 3600,
    ...over,
  };
}

describe("chooseLead", () => {
  it("takes the first story that clears every gate", () => {
    const good = story({ id: 2 });
    const { lead, pinned } = chooseLead(
      [story({ id: 1, sourceCount: 1, score: 10 }), good],
      [],
      null,
      NOW,
    );
    expect(lead?.id).toBe(2);
    expect(pinned).toBe(false);
  });

  it("will not lead on a single outlet unless the story is strong alone", () => {
    const { lead, rejected } = chooseLead(
      [story({ id: 1, sourceCount: 1, score: 40 }), story({ id: 2 })],
      [],
      null,
      NOW,
    );
    expect(lead?.id).toBe(2);
    expect(rejected[0]).toMatchObject({ storyId: 1, gate: "corroborated" });
  });

  it("lets a lone outlet lead when the story is strong enough on its own", () => {
    const { lead } = chooseLead([story({ id: 1, sourceCount: 1, score: 80 })], [], null, NOW);
    expect(lead?.id).toBe(1);
  });

  it("refuses a stale story however well it scores", () => {
    const stale = story({ id: 1, score: 999, publishedAt: NOW - 40 * 3600 });
    const { lead, rejected } = chooseLead([stale, story({ id: 2 })], [], null, NOW);
    expect(lead?.id).toBe(2);
    expect(rejected[0]?.gate).toBe("fresh");
  });

  it("refuses a stub headline and a question", () => {
    const { rejected } = chooseLead(
      [
        story({ id: 1, headline: "Short" }),
        story({ id: 2, headline: "Is this the future of computing in the enterprise?" }),
        story({ id: 3 }),
      ],
      [],
      null,
      NOW,
    );
    expect(rejected.map((r) => r.gate)).toEqual(["substantial", "substantial"]);
  });

  it("does not let one story hold the lead all day", () => {
    const history = [{ id: 1, at: NOW - 3600 }];
    const { lead, rejected } = chooseLead([story({ id: 1 }), story({ id: 2 })], history, null, NOW);
    expect(lead?.id).toBe(2);
    expect(rejected[0]?.gate).toBe("not-recently-led");
  });

  it("lets a story lead again once the cooldown has passed", () => {
    const history = [{ id: 1, at: NOW - 20 * 3600 }];
    const { lead } = chooseLead([story({ id: 1 })], history, null, NOW);
    expect(lead?.id).toBe(1);
  });

  it("honours a pin over every gate, because that is what a pin is for", () => {
    const pinnedStory = story({ id: 9, sourceCount: 1, score: 1, headline: "Tiny" });
    const { lead, pinned } = chooseLead([story({ id: 1 }), pinnedStory], [], 9, NOW);
    expect(lead?.id).toBe(9);
    expect(pinned).toBe(true);
  });

  it("ignores a pin for a story no longer on the page", () => {
    const { lead, pinned } = chooseLead([story({ id: 1 })], [], 404, NOW);
    expect(lead?.id).toBe(1);
    expect(pinned).toBe(false);
  });

  it("falls back to the best story rather than leaving the page headless", () => {
    // Everything fails a gate; an empty front page is worse than a weak lead,
    // and the rejections say why it happened.
    const { lead, rejected } = chooseLead(
      [story({ id: 1, sourceCount: 1, score: 5 }), story({ id: 2, sourceCount: 1, score: 4 })],
      [],
      null,
      NOW,
    );
    expect(lead?.id).toBe(1);
    expect(rejected).toHaveLength(2);
  });

  it("returns nothing when there is nothing", () => {
    expect(chooseLead([], [], null, NOW).lead).toBeNull();
  });
});
