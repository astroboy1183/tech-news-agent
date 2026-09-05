import { cloudflare } from "../context";
import { loadStory } from "../lib/story.server";
import type { Route } from "./+types/api.stories";

/** At most this many stories per request, so the URL cannot become a scan. */
const MAX_IDS = 50;

/**
 * Stories by id.
 *
 * Exists for the saved list, which lives in the reader's own browser: the
 * page holds the ids and asks for the stories. Keeping the list client-side
 * means saving works with no account, no cookie and nothing about the reader
 * stored on the server.
 */
export async function loader({ context, request }: Route.LoaderArgs) {
  const { env } = context.get(cloudflare);
  const raw = new URL(request.url).searchParams.get("ids") ?? "";
  const ids = raw
    .split(",")
    .map((s) => Number.parseInt(s.trim(), 10))
    .filter((n) => Number.isSafeInteger(n) && n > 0)
    .slice(0, MAX_IDS);

  if (ids.length === 0) return Response.json({ stories: [] });

  const pages = await Promise.all(ids.map((id) => loadStory(env, id)));
  return Response.json(
    { stories: pages.filter((p) => p !== null).map((p) => p.story) },
    { headers: { "cache-control": "private, max-age=30" } },
  );
}
