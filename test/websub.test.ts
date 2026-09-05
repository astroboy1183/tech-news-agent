import { describe, expect, it } from "vitest";
import { parseState, verifySignature } from "../app/lib/feeds/websub.server";

async function sign(body: string, secret: string, hash: "SHA-1" | "SHA-256"): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

describe("websub", () => {
  const body = '<rss><channel><item><title>hi</title></item></channel></rss>';
  const secret = "s3cret";

  it("accepts a correct sha1 signature", async () => {
    const sig = await sign(body, secret, "SHA-1");
    expect(await verifySignature(`sha1=${sig}`, body, secret)).toBe(true);
  });

  it("accepts a correct sha256 signature", async () => {
    const sig = await sign(body, secret, "SHA-256");
    expect(await verifySignature(`sha256=${sig}`, body, secret)).toBe(true);
  });

  it("rejects a tampered body", async () => {
    const sig = await sign(body, secret, "SHA-256");
    expect(await verifySignature(`sha256=${sig}`, `${body}<!--evil-->`, secret)).toBe(false);
  });

  it("rejects the wrong secret", async () => {
    const sig = await sign(body, "other", "SHA-256");
    expect(await verifySignature(`sha256=${sig}`, body, secret)).toBe(false);
  });

  it("rejects a missing or malformed header", async () => {
    expect(await verifySignature(null, body, secret)).toBe(false);
    expect(await verifySignature("garbage", body, secret)).toBe(false);
  });

  it("survives a corrupt state blob", () => {
    expect(parseState("not json")).toBeNull();
    expect(parseState(null)).toBeNull();
  });
});
