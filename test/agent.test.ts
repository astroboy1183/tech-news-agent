import { describe, expect, it } from "vitest";
import { weigh } from "../app/lib/agent.server";

function stats(over: Partial<Parameters<typeof weigh>[0]> = {}) {
  return {
    id: 1,
    name: "Example",
    weight: 1.0,
    articles: 100,
    corroborated: 20,
    broke: 5,
    ...over,
  };
}

describe("weigh", () => {
  it("leaves a source alone until there is enough evidence to judge it", () => {
    expect(weigh(stats({ articles: 3, weight: 1.4, corroborated: 0 }))).toBe(1.4);
  });

  it("pushes a source nobody ever corroborates downward", () => {
    const w = weigh(stats({ corroborated: 0, broke: 0, weight: 1.0 }));
    expect(w).toBeLessThan(1.0);
  });

  it("rewards a source whose stories others also file", () => {
    const quiet = weigh(stats({ corroborated: 2, broke: 0 }));
    const covered = weigh(stats({ corroborated: 80, broke: 0 }));
    expect(covered).toBeGreaterThan(quiet);
  });

  it("rewards getting there first above merely being corroborated", () => {
    const follower = weigh(stats({ corroborated: 50, broke: 0 }));
    const breaker = weigh(stats({ corroborated: 50, broke: 45 }));
    expect(breaker).toBeGreaterThan(follower);
  });

  it("moves gradually, so one odd fortnight cannot bury a source", () => {
    const before = 1.8;
    const after = weigh(stats({ weight: before, corroborated: 0, broke: 0 }));
    // The floor is 0.3; a single pass must not take it anywhere near there.
    expect(after).toBeGreaterThan(1.2);
    expect(after).toBeLessThan(before);
  });

  it("converges rather than oscillating when applied repeatedly", () => {
    let w = 1.0;
    for (let i = 0; i < 40; i++) w = weigh(stats({ weight: w, corroborated: 60, broke: 30 }));
    const next = weigh(stats({ weight: w, corroborated: 60, broke: 30 }));
    expect(Math.abs(next - w)).toBeLessThan(0.02);
  });

  it("never leaves the bounds, so no source vanishes or dominates", () => {
    const floor = weigh(stats({ weight: 0.3, corroborated: 0, broke: 0 }));
    const ceiling = weigh(stats({ weight: 2.0, corroborated: 100, broke: 100 }));
    expect(floor).toBeGreaterThanOrEqual(0.3);
    expect(ceiling).toBeLessThanOrEqual(2.0);
  });
});
