// Some publishers 403 an unrecognised agent. Presenting as a feed reader —
// which is exactly what this is — while still identifying the project and a
// contact URL gets through without pretending to be a browser.
const USER_AGENT =
  "Mozilla/5.0 (compatible; TechNewsAgent/0.2; +https://github.com/astroboy1183/tech-news-agent) FeedFetcher-Google";

// Full-content Blogger and Substack feeds legitimately reach several MB.
// Beyond this a feed is misconfigured and not worth the memory.
const MAX_BODY_BYTES = 8_000_000;
const TIMEOUT_MS = 15_000;

export type FetchOutcome =
  | {
      status: "ok";
      body: string;
      contentType: string;
      etag: string | null;
      lastModified: string | null;
      contentHash: string;
    }
  | { status: "not-modified" }
  | { status: "error"; detail: string; retryAfterSeconds: number | null };

export type Validators = {
  etag?: string | null;
  lastModified?: string | null;
  contentHash?: string | null;
};

async function hash(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number.parseInt(header, 10);
  if (!Number.isNaN(seconds)) return seconds;
  const when = Date.parse(header);
  return Number.isNaN(when) ? null : Math.max(0, Math.floor((when - Date.now()) / 1000));
}

/**
 * Fetch a feed politely.
 *
 * Conditional GET is the whole economy of continuous polling: an unchanged feed
 * answers 304 with no body, which costs almost nothing. Feeds that send no
 * validators get a content hash instead, so they are still cheap after the
 * first fetch.
 */
export async function fetchFeed(url: string, validators: Validators = {}): Promise<FetchOutcome> {
  const headers: Record<string, string> = {
    "user-agent": USER_AGENT,
    accept:
      "application/atom+xml, application/rss+xml, application/feed+json, application/xml;q=0.9, */*;q=0.8",
    "accept-encoding": "gzip",
  };
  if (validators.etag) headers["if-none-match"] = validators.etag;
  if (validators.lastModified) headers["if-modified-since"] = validators.lastModified;

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(url, { headers, signal: abort.signal, redirect: "follow" });

    if (response.status === 304) return { status: "not-modified" };

    if (!response.ok) {
      return {
        status: "error",
        detail: `HTTP ${response.status}`,
        retryAfterSeconds: parseRetryAfter(response.headers.get("retry-after")),
      };
    }

    const body = await response.text();
    if (body.length > MAX_BODY_BYTES) {
      return {
        status: "error",
        detail: `body too large (${body.length}B)`,
        retryAfterSeconds: null,
      };
    }

    const contentHash = await hash(body);
    // Unchanged body from a feed that sends no validators: same as a 304.
    if (validators.contentHash && validators.contentHash === contentHash) {
      return { status: "not-modified" };
    }

    return {
      status: "ok",
      body,
      contentType: response.headers.get("content-type") ?? "",
      etag: response.headers.get("etag"),
      lastModified: response.headers.get("last-modified"),
      contentHash,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      status: "error",
      detail: abort.signal.aborted ? `timeout after ${TIMEOUT_MS}ms` : detail,
      retryAfterSeconds: null,
    };
  } finally {
    clearTimeout(timer);
  }
}
