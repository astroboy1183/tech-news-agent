import { describe, expect, it } from "vitest";
import { isBoilerplate } from "../app/lib/cluster/boilerplate";

describe("isBoilerplate", () => {
  it.each([
    "[D] Self-Promotion Thread",
    "Weekly Self Promotion Thread",
    "The Sunday Papers",
    "Monthly Discussion Thread",
    "Ask HN: Who is hiring? (September 2026)",
    "What are you working on this week?",
    "Simple Questions - September 2026",
    "Daily General Discussion megathread",
  ])("excludes %s", (title) => {
    expect(isBoilerplate(title)).toBe(true);
  });

  it.each([
    "Nexus Mods acquires the popular community site SteamDB",
    "CISA Adds Seven Known Exploited Vulnerabilities to Catalog",
    "A deep discussion of Rust's borrow checker",
    "Python 3.15.0 candidate 2 is here!",
    "Threads app adds a new feed",
  ])("keeps %s", (title) => {
    expect(isBoilerplate(title)).toBe(false);
  });
});
