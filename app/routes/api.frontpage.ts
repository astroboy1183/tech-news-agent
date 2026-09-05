import { cloudflare } from "../context";
import { frontPage } from "../lib/compose.server";
import type { Route } from "./+types/api.frontpage";

/**
 * The composed front page as JSON.
 *
 * The same object the site renders from, so anything built against this —
 * the Slack digest, the email, a future app — shows exactly what the website
 * shows rather than a second ranking that drifts away from it.
 */
export async function loader({ context }: Route.LoaderArgs) {
  const page = await frontPage(context.get(cloudflare).env);
  return Response.json(page, {
    headers: {
      "cache-control": "public, max-age=60",
      "access-control-allow-origin": "*",
    },
  });
}
