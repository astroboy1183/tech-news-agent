import { describe, expect, it } from "vitest";
import { titleKey } from "../app/lib/collect.server";

describe("titleKey", () => {
  it("treats the same headline under different punctuation as one", () => {
    expect(titleKey("Nexus Mods acquires SteamDB!")).toBe(titleKey("Nexus Mods acquires SteamDB"));
    expect(titleKey(".gitignore everything by default")).toBe(
      titleKey("gitignore everything by default"),
    );
  });

  it("ignores case and surrounding whitespace", () => {
    expect(titleKey("  THE SUNDAY PAPERS  ")).toBe(titleKey("the sunday papers"));
  });

  it("collapses runs of separators rather than leaving gaps", () => {
    expect(titleKey("Rust  1.94 —  async   closures")).toBe("rust 1 94 async closures");
  });

  it("keeps genuinely different headlines apart", () => {
    expect(titleKey("Godot 4.8 dev 3")).not.toBe(titleKey("Godot 4.8 dev 4"));
    expect(titleKey("The Sunday Papers")).not.toBe(titleKey("The Monday Papers"));
  });

  // Weekly columns share a title and are told apart by time, not by text —
  // see REPOST_WINDOW_SECONDS. The key deliberately does not try to.
  it("does not attempt to separate repeated column titles", () => {
    expect(titleKey("What are we all playing this weekend?")).toBe(
      titleKey("What are we all playing this weekend?"),
    );
  });

  it("keeps non-latin headlines rather than reducing them to nothing", () => {
    expect(titleKey("日本語のニュース")).toBe("日本語のニュース");
  });

  it("returns an empty key for a headline with no letters or digits", () => {
    expect(titleKey("!!! ---")).toBe("");
  });
});
