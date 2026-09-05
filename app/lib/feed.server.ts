/**
 * RSS output.
 *
 * A portal that gathers other people's feeds and publishes none of its own
 * would be taking without giving back, and a feed is also the cheapest useful
 * delivery channel there is: no key, no domain, no subscriber list, and it
 * works in whatever reader someone already uses.
 */

import type { Section } from "./classify";
import { SECTION_LABELS, type Story } from "./sections";

/**
 * XML has five characters that cannot appear as text, and headlines contain
 * all of them — ampersands especially. An unescaped one does not degrade the
 * feed, it makes the document unparseable and every reader drops the lot.
 */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Control characters are illegal in XML 1.0 even when escaped, so they are
 * removed rather than encoded. Feed text arrives from a few hundred publishers
 * and some of it carries stray bytes.
 */
export function cleanXml(value: string): string {
  let stripped = "";
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    // Tab, newline and carriage return are the only control characters XML 1.0
    // permits; everything below 0x20 besides those, the C1 block, and the two
    // permanently-unassigned code points have to go.
    const isAllowedWhitespace = code === 0x09 || code === 0x0a || code === 0x0d;
    const isControl = code < 0x20 || (code >= 0x7f && code <= 0x9f);
    const isNoncharacter = code === 0xfffe || code === 0xffff;
    if ((isControl && !isAllowedWhitespace) || isNoncharacter) continue;
    stripped += character;
  }
  return escapeXml(stripped);
}

function rfc822(seconds: number): string {
  return new Date(seconds * 1000).toUTCString();
}

export type FeedOptions = {
  origin: string;
  section?: Section;
  title?: string;
  description?: string;
};

export function renderRss(stories: Story[], options: FeedOptions): string {
  const { origin, section } = options;
  const title =
    options.title ?? (section ? `Tech News Agent — ${SECTION_LABELS[section]}` : "Tech News Agent");
  const description =
    options.description ??
    (section
      ? `${SECTION_LABELS[section]} news, gathered from hundreds of sources and grouped so one story is one story.`
      : "Technology news gathered from hundreds of sources every two minutes, grouped so one story is one story.");
  const self = section ? `${origin}/feed/${section}.xml` : `${origin}/feed.xml`;
  const latest = stories[0]?.lastSeenAt ?? Math.floor(Date.now() / 1000);

  const items = stories
    .map((story) => {
      // The link goes to our story page when there is corroboration or a
      // summary to show, and straight to the outlet otherwise — the same rule
      // the site follows, so a subscriber gets what a reader gets.
      const link =
        story.sourceCount > 1 || story.summary ? `${origin}/story/${story.id}` : story.url;
      const body = story.summary ?? story.excerpt ?? "";
      const credit =
        story.sourceCount > 1
          ? `Reported by ${story.sourceCount} outlets${
              story.sources.length ? `: ${story.sources.slice(0, 6).join(", ")}` : ""
            }.`
          : story.sources[0]
            ? `Reported by ${story.sources[0]}.`
            : "";
      const enclosure = story.imageUrl
        ? `\n      <enclosure url="${cleanXml(story.imageUrl)}" type="image/jpeg" length="0" />`
        : "";

      return `    <item>
      <title>${cleanXml(story.headline)}</title>
      <link>${cleanXml(link)}</link>
      <guid isPermaLink="false">tech-news-agent:story:${story.id}</guid>
      <pubDate>${rfc822(story.publishedAt ?? story.firstSeenAt)}</pubDate>
      <category>${cleanXml(SECTION_LABELS[story.section as Section] ?? story.section)}</category>
      <description>${cleanXml([body, credit].filter(Boolean).join(" "))}</description>${enclosure}
    </item>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${cleanXml(title)}</title>
    <link>${cleanXml(section ? `${origin}/s/${section}` : origin)}</link>
    <description>${cleanXml(description)}</description>
    <language>en</language>
    <lastBuildDate>${rfc822(latest)}</lastBuildDate>
    <generator>Tech News Agent</generator>
    <atom:link href="${cleanXml(self)}" rel="self" type="application/rss+xml" />
${items}
  </channel>
</rss>
`;
}
