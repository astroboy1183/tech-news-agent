import { describe, expect, it } from "vitest";
import { toFtsQuery } from "../app/lib/search.server";

describe("toFtsQuery", () => {
  it("quotes each word and requires all of them", () => {
    // The trailing term is always a prefix match — see the next test.
    expect(toFtsQuery("nvidia hugging")).toBe('"nvidia" AND "hugging"*');
  });

  it("prefix-matches the last word so typing finds things early", () => {
    expect(toFtsQuery("postgr")).toBe('"postgr"*');
    expect(toFtsQuery("open postgr")).toBe('"open" AND "postgr"*');
  });

  it("does not prefix-match a very short last word, which matches everything", () => {
    expect(toFtsQuery("go")).toBe('"go"');
  });

  // FTS5 reads punctuation as syntax, so a search box that passed it through
  // would let a reader write queries rather than searches — and a stray quote
  // would simply be a syntax error.
  it.each([
    ['nvidia" OR "1', '"nvidia" AND "or" AND "1"'],
    ["nvidia NEAR/5 amd", '"nvidia" AND "near" AND "5" AND "amd"*'],
    ["nvidia*", '"nvidia"*'],
    ["-nvidia", '"nvidia"*'],
    ["(nvidia)", '"nvidia"*'],
    ["nvidia^2", '"nvidia" AND "2"'],
  ])("neutralises %j", (input, expected) => {
    expect(toFtsQuery(input)).toBe(expected);
  });

  it("keeps the punctuation that belongs inside real terms", () => {
    expect(toFtsQuery("CVE-2026-31847")).toBe('"cve-2026-31847"*');
    expect(toFtsQuery("node.js")).toBe('"node.js"*');
    // Trailing operators are stripped, so "c++" searches for "c" — a known
    // limit of refusing to escape rather than sanitise.
    expect(toFtsQuery("c++")).toBe('"c"');
  });

  it("returns null for nothing to search", () => {
    expect(toFtsQuery("")).toBeNull();
    expect(toFtsQuery("   ")).toBeNull();
    expect(toFtsQuery("!!! ??? ***")).toBeNull();
  });

  it("caps how many terms one query can carry", () => {
    const long = toFtsQuery("a b c d e f g h i j k l m n o p");
    expect(long?.split(" AND ")).toHaveLength(8);
  });

  it("handles non-latin scripts rather than discarding them", () => {
    expect(toFtsQuery("日本語")).toBe('"日本語"*');
  });
});
