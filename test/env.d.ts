import type { D1Migration } from "@cloudflare/vitest-pool-workers";

/**
 * Test-only binding. The vitest pool passes the parsed migrations through
 * miniflare so `test/setup.ts` can apply them to the ephemeral D1 instance.
 * It does not exist in production.
 */
declare global {
  namespace Cloudflare {
    interface Env {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}
