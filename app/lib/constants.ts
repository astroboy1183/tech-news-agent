/**
 * Values both the server and the browser need.
 *
 * Kept out of any `.server.ts` module: React Router refuses the build when a
 * client component imports one, because doing so would drag database code into
 * the browser bundle. This is the same reason `sections.ts` exists.
 */

/** The interval every source is polled on. */
export const POLL_INTERVAL_SECONDS = 120;

/** How long a composed front page is served from KV. */
export const FRONT_PAGE_TTL_SECONDS = 90;
