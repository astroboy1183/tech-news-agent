import { isbot } from "isbot";
import { renderToReadableStream } from "react-dom/server";
import type { EntryContext, RouterContextProvider } from "react-router";
import { ServerRouter } from "react-router";

/**
 * Workers has no Node streams, so rendering goes through the web-streams API.
 * Crawlers and the initial shell get the fully-buffered document; browsers get
 * it streamed, which is what keeps first paint fast on a long front page.
 */
export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
  _loadContext: RouterContextProvider,
) {
  let shellRendered = false;
  let status = responseStatusCode;

  const body = await renderToReadableStream(
    <ServerRouter context={routerContext} url={request.url} />,
    {
      onError(error: unknown) {
        status = 500;
        // Errors after the shell has flushed cannot change the status, so they
        // are logged instead of swallowed.
        if (shellRendered) console.error(error);
      },
    },
  );
  shellRendered = true;

  const userAgent = request.headers.get("user-agent");
  if (userAgent && isbot(userAgent)) {
    await body.allReady;
  }

  responseHeaders.set("Content-Type", "text/html");
  return new Response(body, { headers: responseHeaders, status });
}
