import { XMLParser } from "fast-xml-parser";

/**
 * OPML import.
 *
 * This is what makes "unlimited sources" true rather than aspirational: every
 * feed reader exports OPML, and curated topic bundles are published as OPML, so
 * growing from a hundred sources to five hundred is a paste rather than an
 * afternoon of typing.
 */

export type OpmlSource = {
  name: string;
  feedUrl: string;
  homepage: string | null;
  /** OPML folder name, used as a section hint when it matches one of ours. */
  folder: string | null;
};

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  isArray: (name) => name === "outline",
  trimValues: true,
  processEntities: true,
});

type Outline = {
  "@text"?: string;
  "@title"?: string;
  "@xmlUrl"?: string;
  "@htmlUrl"?: string;
  outline?: Outline[];
};

/**
 * Outlines nest: a folder is an outline containing outlines. Walk the tree and
 * keep the nearest enclosing folder name as a section hint.
 */
function walk(nodes: Outline[], folder: string | null, out: OpmlSource[]): void {
  for (const node of nodes) {
    const label = node["@title"] ?? node["@text"] ?? null;
    const feedUrl = node["@xmlUrl"];

    if (typeof feedUrl === "string" && feedUrl.trim()) {
      out.push({
        name: (label ?? feedUrl).trim(),
        feedUrl: feedUrl.trim(),
        homepage: node["@htmlUrl"]?.trim() ?? null,
        folder,
      });
    }

    if (node.outline?.length) walk(node.outline, label ?? folder, out);
  }
}

export function parseOpml(xml: string): OpmlSource[] {
  const doc = parser.parse(xml) as { opml?: { body?: { outline?: Outline[] } } };
  const roots = doc.opml?.body?.outline;
  if (!roots?.length) return [];

  const found: OpmlSource[] = [];
  walk(roots, null, found);

  // The same feed can appear in several folders; keep the first.
  const seen = new Set<string>();
  return found.filter((s) => {
    const key = s.feedUrl.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
