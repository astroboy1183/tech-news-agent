import { cloudflare } from "../context";
import { SECTIONS, type Section } from "../lib/classify";
import { composeSection, frontPage } from "../lib/compose.server";
import { renderRss } from "../lib/feed.server";
import type { Route } from "./+types/feed";

/**
 * The front page as RSS, or one section when the path names one.
 *
 * Cached for five minutes rather than the ninety seconds the site uses:
 * readers poll a feed on their own schedule and none of them benefit from a
 * fresher copy than their reader will fetch.
 */
export async function loader({ context, params, request }: Route.LoaderArgs) {
  const { env } = context.get(cloudflare);
  const origin = new URL(request.url).origin;
  const slug = params.section;

  if (slug && !SECTIONS.includes(slug as Section)) {
    throw new Response("No such section", { status: 404 });
  }

  const stories = slug
    ? await composeSection(env, slug as Section, 40).then(({ lead, stories }) =>
        lead ? [lead, ...stories] : stories,
      )
    : await frontPage(env).then((page) => [
        ...(page.lead ? [page.lead] : []),
        ...page.hero,
        ...page.across,
        ...page.sections.flatMap((s) => s.stories),
      ]);

  return new Response(
    renderRss(stories.slice(0, 50), { origin, section: slug as Section | undefined }),
    {
      headers: {
        "content-type": "application/rss+xml; charset=utf-8",
        "cache-control": "public, max-age=300",
      },
    },
  );
}
