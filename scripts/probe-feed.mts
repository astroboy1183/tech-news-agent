/** Diagnostic: fetch real feeds and report what the parser makes of them. */
import { parseFeed } from "../app/lib/feeds/parse.js";

const urls = process.argv.slice(2);
for (const url of urls) {
  const res = await fetch(url, { headers: { "user-agent": "TechNewsAgent/0.2" } });
  const body = await res.text();
  const feed = parseFeed(body, res.headers.get("content-type") ?? "");
  console.log(`\n${url}`);
  console.log(`  http ${res.status}  bytes ${body.length}  parsed items ${feed.items.length}`);
  if (feed.items.length === 0) {
    console.log(`  raw <item>: ${(body.match(/<item[\s>]/g) ?? []).length}`);
    console.log(`  raw <entry>: ${(body.match(/<entry[\s>]/g) ?? []).length}`);
    const first = /<item[\s>][\s\S]{0,320}/.exec(body);
    if (first) console.log("  sample:", first[0].replace(/\s+/g, " ").slice(0, 260));
  } else {
    console.log(`  e.g. "${feed.items[0]!.title.slice(0, 64)}"`);
  }
}
