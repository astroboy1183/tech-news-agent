import { parseFeed } from "../app/lib/feeds/parse.js";

const now = Math.floor(Date.now() / 1000);
for (const url of process.argv.slice(2)) {
  const res = await fetch(url, { headers: { "user-agent": "TechNewsAgent/0.2" } });
  const feed = parseFeed(await res.text(), res.headers.get("content-type") ?? "");
  const fresh = feed.items.filter((i) => i.publishedAt && now - i.publishedAt <= 14 * 86400).length;
  const ages = feed.items
    .slice(0, 5)
    .map((i) => (i.publishedAt ? `${Math.round((now - i.publishedAt) / 86400)}d` : "no date"));
  console.log(
    `${url}\n  items ${feed.items.length} · within 14d: ${fresh} · newest: ${ages.join(", ")}`,
  );
}
