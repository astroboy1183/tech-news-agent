import { describe, expect, it } from "vitest";
import { canonicalizeUrl, urlHash } from "../app/lib/feeds/canonicalize";

describe("canonicalizeUrl", () => {
  it("strips tracking parameters but keeps meaningful ones", () => {
    expect(canonicalizeUrl("https://example.com/post?id=42&utm_source=rss&fbclid=xyz&ref=hn")).toBe(
      "https://example.com/post?id=42",
    );
  });

  it("normalises scheme, www, port, trailing slash and fragment", () => {
    expect(canonicalizeUrl("http://WWW.Example.com:80/post/#section")).toBe(
      "https://example.com/post",
    );
  });

  it("orders query parameters so argument order cannot fork identity", () => {
    expect(canonicalizeUrl("https://e.com/a?b=2&a=1")).toBe(
      canonicalizeUrl("https://e.com/a?a=1&b=2"),
    );
  });

  it("unwraps AMP paths and ampproject mirrors", () => {
    expect(canonicalizeUrl("https://example.com/story/amp/")).toBe("https://example.com/story");
    expect(canonicalizeUrl("https://cdn.ampproject.org/c/s/example.com/story")).toBe(
      "https://example.com/story",
    );
  });

  it("follows a redirector to the real destination", () => {
    expect(canonicalizeUrl("https://news.google.com/rss/articles?url=https://ars.com/x")).toBe(
      "https://ars.com/x",
    );
  });

  it("leaves an unparseable string alone rather than throwing", () => {
    expect(canonicalizeUrl("not a url")).toBe("not a url");
  });

  it("hashes stably, and differently for different URLs", async () => {
    const a = await urlHash(canonicalizeUrl("https://e.com/a?utm_source=x"));
    const b = await urlHash(canonicalizeUrl("https://e.com/a"));
    const c = await urlHash(canonicalizeUrl("https://e.com/b"));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toHaveLength(64);
  });
});
