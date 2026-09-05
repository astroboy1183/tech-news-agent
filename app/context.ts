import { createContext } from "react-router";

export type CloudflareContext = { env: Env; ctx: ExecutionContext };

/**
 * React Router 8 replaced the free-form `AppLoadContext` object with typed
 * contexts. The Worker sets this once per request; loaders read it with
 * `context.get(cloudflare)`.
 */
export const cloudflare = createContext<CloudflareContext>();
