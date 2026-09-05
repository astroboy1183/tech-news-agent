/**
 * Import feeds from an OPML file.
 *
 *   pnpm opml:import subscriptions.opml --section=ai --tier=C
 *   pnpm opml:import subscriptions.opml --remote
 *
 * Existing feeds are left untouched: only genuinely new xmlUrls are inserted,
 * so re-importing an updated export is safe.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { parseOpml } from "../app/lib/feeds/opml";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
if (!file) {
  console.error("usage: pnpm opml:import <file.opml> [--section=x] [--tier=A|B|C|D] [--remote]");
  process.exit(1);
}

const flag = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const remote = args.includes("--remote");

const SECTIONS = [
  "ai",
  "software",
  "hardware",
  "consumer",
  "os",
  "security",
  "cloud",
  "science",
  "gaming",
  "industry",
];
// Every source polls on the same two-minute cadence: conditional GET makes a
// quiet feed nearly free, and a failing one backs itself off. Tier now affects
// only trust weight, not how often we look.
const POLL_INTERVAL = 120;

const fallbackSection = flag("section") ?? "software";
const tier = (flag("tier") ?? "C").toUpperCase();
const interval = POLL_INTERVAL;

const sources = parseOpml(readFileSync(file, "utf8"));
if (sources.length === 0) {
  console.error("no <outline xmlUrl=...> entries found — is this an OPML file?");
  process.exit(1);
}

const q = (v: string) => `'${v.replace(/'/g, "''")}'`;
const statements = sources.map((s) => {
  // An OPML folder called "Security" is a better hint than any default.
  const folder = s.folder?.toLowerCase().trim() ?? "";
  const section = SECTIONS.includes(folder) ? folder : fallbackSection;
  return `INSERT INTO sources (name, homepage, feed_url, kind, section, weight, tier, poll_interval, next_poll_at)
VALUES (${q(s.name.slice(0, 120))}, ${q(s.homepage ?? "")}, ${q(s.feedUrl)}, 'rss', ${q(section)}, 0.9, ${q(tier)}, ${interval}, 0)
ON CONFLICT (feed_url) DO NOTHING;`;
});

const out = ".wrangler/opml.generated.sql";
writeFileSync(out, `${statements.join("\n")}\n`);
execFileSync(
  "npx",
  ["wrangler", "d1", "execute", "tech-news", remote ? "--remote" : "--local", "--file", out],
  { stdio: "inherit" },
);

const byFolder = new Map<string, number>();
for (const s of sources)
  byFolder.set(s.folder ?? "(root)", (byFolder.get(s.folder ?? "(root)") ?? 0) + 1);
console.log(`\nimported ${sources.length} feeds (${remote ? "remote" : "local"})`);
for (const [folder, n] of [...byFolder].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
  console.log(`  ${String(n).padStart(4)}  ${folder}`);
}
