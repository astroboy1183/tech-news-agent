import { createRequestHandler, RouterContextProvider } from "react-router";
import { cloudflare } from "../app/context";
import { type CollectMessage, runCollectBatch } from "../app/lib/collect.server";
import { type EnrichMessage, runEnrichBatch } from "../app/lib/enrich.server";
import { runScheduled } from "../app/lib/scheduler.server";

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

/**
 * One Worker, three entrypoints.
 *
 * `fetch`     — React Router serves every page and API route.
 * `scheduled` — cron fans work out to queues; it never does the work itself,
 *               so a slow feed can never stall the scheduler.
 * `queue`     — the consumers that actually fetch, parse and enrich.
 *
 * Proving these three coexist in a single Worker is the point of v0.1.0.
 */
export default {
  async fetch(request, env, ctx) {
    const context = new RouterContextProvider();
    context.set(cloudflare, { env, ctx });
    return requestHandler(request, context);
  },

  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runScheduled(controller.cron, env));
  },

  async queue(batch, env, _ctx) {
    switch (batch.queue) {
      case "tech-news-collect":
        await runCollectBatch(batch as MessageBatch<CollectMessage>, env);
        break;
      case "tech-news-enrich":
        await runEnrichBatch(env, batch as MessageBatch<EnrichMessage>);
        break;
      default:
        for (const m of batch.messages) m.retry();
    }
  },
} satisfies ExportedHandler<Env>;
