/**
 * Seeds `sources` from sources.seed.json.
 *
 * Idempotent: feed_url is unique, so re-running updates the editorial fields
 * (section, tier, weight) while leaving polling state alone — you can retune a
 * source without losing its etag or failure history.
 *
 *   npm run seed:local
 *   npm run seed:remote
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

type Source = {
  name: string;
  feed_url: string;
  homepage: string;
  section: string;
  kind: string;
  tier: string;
  poll_interval: number;
  weight: number;
  active?: boolean;
};

const remote = process.argv.includes("--remote");
const sources: Source[] = JSON.parse(readFileSync("sources.seed.json", "utf8"));
const q = (v: string) => `'${v.replace(/'/g, "''")}'`;

const statements = sources.map(
  (s) => `INSERT INTO sources
  (name, homepage, feed_url, kind, section, weight, tier, poll_interval, next_poll_at, active)
VALUES (${q(s.name)}, ${q(s.homepage)}, ${q(s.feed_url)}, ${q(s.kind)}, ${q(s.section)},
        ${s.weight}, ${q(s.tier)}, ${s.poll_interval}, 0, ${s.active === false ? 0 : 1})
ON CONFLICT (feed_url) DO UPDATE SET
  name = excluded.name,
  section = excluded.section,
  weight = excluded.weight,
  tier = excluded.tier,
  poll_interval = excluded.poll_interval,
  active = excluded.active;`,
);

const file = ".wrangler/seed.generated.sql";
writeFileSync(file, `${statements.join("\n")}\n`);

execFileSync(
  "npx",
  ["wrangler", "d1", "execute", "tech-news", remote ? "--remote" : "--local", "--file", file],
  { stdio: "inherit" },
);

console.log(`seeded ${sources.length} sources (${remote ? "remote" : "local"})`);
