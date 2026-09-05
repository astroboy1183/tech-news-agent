/**
 * Section identity and the story shape — everything the browser needs.
 *
 * Deliberately not in compose.server.ts: the cards and the masthead render on
 * the client too, and importing a `.server` module from them drags database
 * code into the browser bundle (React Router refuses the build outright).
 */

import type { Section } from "./classify";

/** Display names. The database stores slugs; the masthead should not. */
export const SECTION_LABELS: Record<Section, string> = {
  ai: "AI & ML",
  software: "Software",
  hardware: "Hardware",
  consumer: "Consumer Tech",
  os: "Operating Systems",
  security: "Security",
  cloud: "Cloud & Infra",
  science: "Science",
  gaming: "Gaming",
  industry: "Industry & Policy",
};

/** What each section covers, for the section index. */
export const SECTION_BLURBS: Record<Section, string> = {
  ai: "research · deep learning · computer vision · language models · robotics",
  software: "languages · frameworks · databases · devtools · open source",
  hardware: "components · silicon · semiconductors · servers · storage",
  consumer: "phones · laptops · wearables · audio · cameras · smart home · EVs",
  os: "Windows · macOS · Linux · Android · iOS · BSD",
  security: "vulnerabilities · breaches · cryptography · privacy · surveillance",
  cloud: "cloud platforms · devops · data centres · networking · observability",
  science: "quantum · space · physics · materials · biotech",
  gaming: "industry · engines · hardware · Linux gaming",
  industry: "big tech · startups · funding · regulation · antitrust",
};

/** One clustered story, as the page renders it. */
export type Story = {
  id: number;
  headline: string;
  url: string;
  excerpt: string | null;
  imageUrl: string | null;
  section: string;
  /** Distinct outlets that filed this story. 1 means nobody corroborated it. */
  sourceCount: number;
  /** Outlet names, best-scoring first — the byline strip under a headline. */
  sources: string[];
  /** Outlets per hour since first sighting; separates breaking from gradual. */
  velocity: number;
  score: number;
  /** Written by the summarizer across every outlet in the cluster, or null. */
  summary: string | null;
  /** Present only when there is a genuine stake beyond the event itself. */
  whyItMatters: string | null;
  topics: string[];
  firstSeenAt: number;
  lastSeenAt: number;
  publishedAt: number | null;
};

export type SectionBlock = { section: Section; label: string; stories: Story[] };

export type FrontPageCounts = {
  articles: number;
  today: number;
  stories: number;
  corroborated: number;
  sources: number;
  summarized: number;
};
