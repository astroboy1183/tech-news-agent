import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { costOf, formatMicros, readSpend, recordSpend } from "../app/lib/budget.server";

describe("costOf", () => {
  it("prices input and output at their separate rates", () => {
    // 1000 in at $1/Mtok = 1000 micros; 100 out at $5/Mtok = 500 micros.
    expect(costOf({ input_tokens: 1000, output_tokens: 100 })).toBe(1500);
  });

  it("charges a tenth for cached input, which is the point of caching", () => {
    const uncached = costOf({ input_tokens: 2000, output_tokens: 0 });
    const cached = costOf({
      input_tokens: 0,
      output_tokens: 0,
      cache_read_input_tokens: 2000,
    });
    expect(cached).toBeCloseTo(uncached / 10, 5);
  });

  it("charges a premium to write the cache, so one-shot caching is a loss", () => {
    const write = costOf({
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 1000,
    });
    expect(write).toBeGreaterThan(costOf({ input_tokens: 1000, output_tokens: 0 }));
  });

  it("treats absent cache fields as zero rather than NaN", () => {
    expect(
      costOf({
        input_tokens: 10,
        output_tokens: 0,
        cache_read_input_tokens: null,
        cache_creation_input_tokens: null,
      }),
    ).toBe(10);
  });
});

describe("formatMicros", () => {
  it("renders micro-dollars as dollars", () => {
    expect(formatMicros(450_000)).toBe("$0.4500");
    expect(formatMicros(1_500)).toBe("$0.0015");
  });
});

describe("the ledger", () => {
  beforeEach(async () => {
    const day = new Date().toISOString().slice(0, 10);
    await env.CACHE.delete(`spend:${day}`);
  });

  it("starts the day with the whole cap available", async () => {
    const spend = await readSpend(env);
    expect(spend.spentMicros).toBe(0);
    expect(spend.remainingMicros).toBe(spend.capMicros);
  });

  it("accumulates spend across calls", async () => {
    await recordSpend(env, 1000);
    await recordSpend(env, 500);
    const spend = await readSpend(env);
    expect(spend.spentMicros).toBe(1500);
    expect(spend.summaries).toBe(2);
    expect(spend.remainingMicros).toBe(spend.capMicros - 1500);
  });

  it("never reports negative headroom once the cap is passed", async () => {
    const { capMicros } = await readSpend(env);
    await recordSpend(env, capMicros * 2);
    expect((await readSpend(env)).remainingMicros).toBe(0);
  });

  it("treats a corrupt ledger entry as spent, not as unlimited", async () => {
    // Failing closed matters: the alternative reads a broken key as $0 spent
    // and spends the whole budget again.
    const day = new Date().toISOString().slice(0, 10);
    await env.CACHE.put(`spend:${day}`, "{not json");
    expect((await readSpend(env)).remainingMicros).toBe(0);
  });
});
