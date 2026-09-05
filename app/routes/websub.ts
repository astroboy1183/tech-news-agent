import { cloudflare } from "../context";
import { collectFromPush } from "../lib/collect.server";
import { parseState, verifySignature } from "../lib/feeds/websub.server";
import type { Route } from "./+types/websub";

/**
 * Hub verification. After a subscribe request the hub calls back with a
 * challenge, and echoing it confirms we really asked. Anything else is
 * refused, so a stranger cannot subscribe us to their feed.
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflare);
  const url = new URL(request.url);

  const mode = url.searchParams.get("hub.mode");
  const topic = url.searchParams.get("hub.topic");
  const challenge = url.searchParams.get("hub.challenge");
  const sourceId = Number(url.searchParams.get("source"));

  if (!mode || !challenge || !Number.isFinite(sourceId)) {
    return new Response("bad request", { status: 400 });
  }

  const row = await env.DB.prepare("SELECT feed_url, websub_state FROM sources WHERE id = ?")
    .bind(sourceId)
    .first<{ feed_url: string; websub_state: string | null }>();

  const state = parseState(row?.websub_state ?? null);
  // Only confirm a subscription we initiated, for the topic we asked about.
  if (!row || !state || (topic && topic !== state.topic)) {
    return new Response("not found", { status: 404 });
  }

  if (mode === "subscribe") {
    const lease = Number(url.searchParams.get("hub.lease_seconds"));
    const expiresAt =
      Number.isFinite(lease) && lease > 0 ? Math.floor(Date.now() / 1000) + lease : state.expiresAt;
    await env.DB.prepare("UPDATE sources SET websub_state = ? WHERE id = ?")
      .bind(JSON.stringify({ ...state, status: "active", expiresAt }), sourceId)
      .run();
  } else if (mode === "unsubscribe") {
    await env.DB.prepare("UPDATE sources SET websub_state = NULL WHERE id = ?")
      .bind(sourceId)
      .run();
  }

  return new Response(challenge, { headers: { "content-type": "text/plain" } });
}

/** Content distribution: the hub POSTs the feed the moment it changes. */
export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.get(cloudflare);
  const sourceId = Number(new URL(request.url).searchParams.get("source"));
  if (!Number.isFinite(sourceId)) return new Response("bad request", { status: 400 });

  const row = await env.DB.prepare("SELECT websub_state FROM sources WHERE id = ?")
    .bind(sourceId)
    .first<{ websub_state: string | null }>();

  const state = parseState(row?.websub_state ?? null);
  if (!state) return new Response("not found", { status: 404 });

  const body = await request.text();
  const signature =
    request.headers.get("x-hub-signature-256") ?? request.headers.get("x-hub-signature");

  if (!(await verifySignature(signature, body, state.secret))) {
    // 202 rather than 403: the spec asks subscribers not to leak whether a
    // signature was wrong, and a hub should not retry a rejected push forever.
    console.warn(`websub: bad signature for source ${sourceId}`);
    return new Response("accepted", { status: 202 });
  }

  const inserted = await collectFromPush(env, sourceId, body, request.headers.get("content-type"));
  return Response.json({ ok: true, inserted }, { status: 202 });
}
