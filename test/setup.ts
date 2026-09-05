import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll } from "vitest";

// The test D1 starts empty; apply the same migrations production runs.
beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
