import { recordRun } from "../runs.server";

/**
 * WebSub (formerly PubSubHubbub).
 *
 * Polling every fifteen minutes is a compromise; a hub push arrives in seconds.
 * Roughly a fifth of feeds advertise a hub, and for those this replaces polling
 * almost entirely — the source keeps its interval as a safety net in case a
 * subscription silently lapses.
 */

export type WebsubState = {
  status: "pending" | "active" | "failed";
  secret: string;
  /** Unix seconds; hubs cap leases, so subscriptions must be renewed. */
  expiresAt: number;
  topic: string;
};

const LEASE_SECONDS = 864_000; // 10 days — most hubs cap around this

export function parseState(raw: string | null): WebsubState | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as WebsubState;
  } catch {
    return null;
  }
}

function randomSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Ask a hub to start sending us this feed. The hub answers asynchronously by
 * calling back to `GET /websub`, which is where the subscription is confirmed.
 */
export async function subscribe(
  env: Env,
  source: { id: number; feed_url: string; websub_hub: string },
  callbackBase: string,
): Promise<boolean> {
  const secret = randomSecret();
  const topic = source.feed_url;

  const state: WebsubState = {
    status: "pending",
    secret,
    topic,
    expiresAt: Math.floor(Date.now() / 1000) + LEASE_SECONDS,
  };
  await env.DB.prepare("UPDATE sources SET websub_state = ? WHERE id = ?")
    .bind(JSON.stringify(state), source.id)
    .run();

  const body = new URLSearchParams({
    "hub.mode": "subscribe",
    "hub.topic": topic,
    "hub.callback": `${callbackBase}/websub?source=${source.id}`,
    "hub.secret": secret,
    "hub.lease_seconds": String(LEASE_SECONDS),
  });

  try {
    const response = await fetch(source.websub_hub, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    // 202 Accepted is the normal answer: verification happens out of band.
    return response.status === 202 || response.ok;
  } catch (error) {
    console.error(`websub subscribe failed for source ${source.id}`, error);
    return false;
  }
}

/** Constant-time comparison; a fast-exit compare leaks the signature. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Verify `X-Hub-Signature: sha1=…` (the spec's baseline) or sha256.
 * An unsigned push is not trusted: anyone can POST to a public callback.
 */
export async function verifySignature(
  header: string | null,
  body: string,
  secret: string,
): Promise<boolean> {
  if (!header) return false;
  const [algorithm, signature] = header.split("=", 2);
  if (!algorithm || !signature) return false;

  const hash = algorithm.toLowerCase() === "sha1" ? "SHA-1" : "SHA-256";
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  const expected = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return timingSafeEqual(expected, signature.toLowerCase());
}

/**
 * Subscribe to hubs we have discovered but not yet asked, and renew leases
 * approaching expiry. Runs on the ten-minute cron, a few at a time.
 */
export async function reconcileSubscriptions(env: Env, callbackBase: string): Promise<void> {
  const started = Date.now();
  const now = Math.floor(Date.now() / 1000);

  const { results } = await env.DB.prepare(
    `SELECT id, feed_url, websub_hub, websub_state FROM sources
      WHERE active = 1 AND websub_hub IS NOT NULL
      LIMIT 50`,
  ).all<{ id: number; feed_url: string; websub_hub: string; websub_state: string | null }>();

  let subscribed = 0;
  for (const source of results ?? []) {
    const state = parseState(source.websub_state);
    const needsWork =
      !state ||
      state.status === "failed" ||
      // Renew a day before the lease runs out.
      state.expiresAt - now < 86_400;
    if (!needsWork) continue;

    if (await subscribe(env, source, callbackBase)) subscribed++;
    if (subscribed >= 5) break; // spread the work across ticks
  }

  if (subscribed > 0) {
    await recordRun(env, { stage: "websub", startedAt: started, counts: { subscribed } });
  }
}
