/**
 * Two articles are the same article if their canonical URLs match. Everything
 * downstream — dedupe, clustering, the unique index — rests on this, so it errs
 * toward stripping: a false match is far worse than a missed one, but tracking
 * junk is never meaningful.
 */

const TRACKING_PARAMS = [
  /^utm_/i,
  /^ga_/i,
  /^mc_/i,
  /^pk_/i,
  /^hsa_/i,
  /^vero_/i,
  /^at_(medium|campaign|custom\d?|link_\w+)$/i,
  /^(fbclid|gclid|dclid|msclkid|igshid|mkt_tok|twclid|ttclid|yclid|wbraid|gbraid)$/i,
  /^(ref|referrer|source|src|cmpid|CMP|ncid|sh|si|feature|guccounter|__twitter_impression)$/i,
  /^(amp|outputType|_amp)$/i,
  /^(sponsored|partner|campaign_id|ito)$/i,
];

const AMP_SUFFIX = /\/amp\/?$|\.amp$|\/amp\.html$/i;

function isTracking(key: string): boolean {
  return TRACKING_PARAMS.some((pattern) => pattern.test(key));
}

/** Unwrap the redirector wrappers feeds habitually use. */
function unwrap(url: URL): URL {
  // Google News and similar carry the real destination in a query parameter.
  for (const key of ["url", "u", "target", "redirect", "q"]) {
    const inner = url.searchParams.get(key);
    if (inner && /^https?:\/\//i.test(inner)) {
      try {
        return new URL(inner);
      } catch {
        /* fall through and keep the outer URL */
      }
    }
  }

  // cdn.ampproject.org/c/s/example.com/path → https://example.com/path
  if (url.hostname.endsWith("cdn.ampproject.org")) {
    const match = /\/c\/(?:s\/)?(.+)$/.exec(url.pathname);
    if (match?.[1]) {
      try {
        return new URL(`https://${match[1]}${url.search}`);
      } catch {
        /* fall through */
      }
    }
  }

  return url;
}

export function canonicalizeUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return raw.trim();
  }

  url = unwrap(url);

  if (url.protocol !== "http:" && url.protocol !== "https:") return url.toString();

  // Publishers are inconsistent about http/https for the same article.
  url.protocol = "https:";
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  url.port = "";
  url.hash = "";

  for (const key of [...url.searchParams.keys()]) {
    if (isTracking(key)) url.searchParams.delete(key);
  }
  // Stable ordering so ?a=1&b=2 and ?b=2&a=1 hash identically.
  url.searchParams.sort();

  url.pathname = url.pathname.replace(AMP_SUFFIX, "") || "/";
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");

  return url.toString();
}

/** Stable identity for the unique index on `articles.url_hash`. */
export async function urlHash(canonical: string): Promise<string> {
  const bytes = new TextEncoder().encode(canonical);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
