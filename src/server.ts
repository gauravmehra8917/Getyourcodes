import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!body.includes('"unhandled":true') || !body.includes('"message":"HTTPError"')) {
    return response;
  }

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

// Long-term caching for static assets. Hashed build assets are immutable;
// other static files get a shorter TTL with SWR. HTML/SSR documents are
// never cached so users always see the latest deploy.
const IMMUTABLE_PATH_PREFIXES = ["/_build/", "/assets/", "/_server/assets/"];
const STATIC_EXTENSIONS = /\.(?:js|mjs|css|woff2?|ttf|otf|eot|png|jpe?g|gif|webp|avif|svg|ico|mp4|webm|ogg|mp3|wav|wasm|map)$/i;

function applyCacheHeaders(request: Request, response: Response): Response {
  if (!response.ok && response.status !== 304) return response;
  const url = new URL(request.url);
  const path = url.pathname;

  let cacheControl: string | undefined;
  if (IMMUTABLE_PATH_PREFIXES.some((p) => path.startsWith(p))) {
    cacheControl = "public, max-age=31536000, immutable";
  } else if (STATIC_EXTENSIONS.test(path)) {
    cacheControl = "public, max-age=86400, stale-while-revalidate=604800";
  }

  if (!cacheControl) return response;
  if (response.headers.get("cache-control")) return response;

  const headers = new Headers(response.headers);
  headers.set("Cache-Control", cacheControl);
  // Cloudflare negotiates br/gzip automatically; ensure caches vary correctly.
  const vary = headers.get("Vary");
  if (!vary || !/accept-encoding/i.test(vary)) {
    headers.set("Vary", vary ? `${vary}, Accept-Encoding` : "Accept-Encoding");
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      const normalized = await normalizeCatastrophicSsrResponse(response);
      return applyCacheHeaders(request, normalized);
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
