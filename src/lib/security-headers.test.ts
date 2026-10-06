import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { applySecurityHeaders } from "./security-headers.ts";

const request = (path: string) => new Request(`https://example.test${path}`);

function assertHeaders(response: Response): void {
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(response.headers.get("Referrer-Policy"), "strict-origin-when-cross-origin");
  assert.equal(response.headers.get("X-Frame-Options"), "DENY");
  assert.equal(
    response.headers.get("Permissions-Policy"),
    "camera=(), microphone=(), geolocation=()",
  );
  for (const forbidden of [
    "Content-Security-Policy",
    "Strict-Transport-Security",
    "Cross-Origin-Opener-Policy",
    "Cross-Origin-Embedder-Policy",
    "Cross-Origin-Resource-Policy",
  ]) {
    assert.equal(response.headers.has(forbidden), false);
  }
}

test("ordinary responses receive the four headers without changing body, status or cache headers", async () => {
  const response = applySecurityHeaders(
    request("/nike-coupons"),
    new Response("catalog", {
      status: 203,
      statusText: "Non-Authoritative Information",
      headers: { "Cache-Control": "private, no-store", Vary: "Cookie", ETag: '"catalog"' },
    }),
  );
  assertHeaders(response);
  assert.equal(response.headers.has("X-Robots-Tag"), false);
  assert.equal(response.status, 203);
  assert.equal(response.statusText, "Non-Authoritative Information");
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.equal(response.headers.get("Vary"), "Cookie");
  assert.equal(response.headers.get("ETag"), '"catalog"');
  assert.equal(await response.text(), "catalog");
});

test("all sensitive paths receive noindex,nofollow including admin and API children", () => {
  for (const path of [
    "/admin",
    "/admin/",
    "/admin/stores",
    "/auth",
    "/login",
    "/account",
    "/forgot-password",
    "/reset-password",
    "/analytics",
    "/api",
    "/api/chat",
    "/api/chat?other=1",
  ]) {
    assert.equal(
      applySecurityHeaders(request(path), new Response()).headers.get("X-Robots-Tag"),
      "noindex, nofollow",
      path,
    );
  }
  for (const path of ["/", "/search", "/nike-coupons", "/administrator", "/apiary"]) {
    assert.equal(
      applySecurityHeaders(request(path), new Response()).headers.has("X-Robots-Tag"),
      false,
      path,
    );
  }
});

test("stronger referrer policies and unrelated permissions and indexing directives are preserved", () => {
  for (const policy of ["no-referrer", "same-origin", "strict-origin", "unsafe-url, no-referrer"]) {
    const response = applySecurityHeaders(
      request("/admin"),
      new Response(null, {
        headers: {
          "Referrer-Policy": policy,
          "Permissions-Policy":
            'payment=(), camera=(self "https://example.test"), microphone=(), geolocation=(self)',
          "X-Robots-Tag": "noarchive",
        },
      }),
    );
    assert.equal(response.headers.get("Referrer-Policy"), policy);
    assert.equal(
      response.headers.get("Permissions-Policy"),
      "payment=(), camera=(), microphone=(), geolocation=()",
    );
    assert.equal(response.headers.get("X-Robots-Tag"), "noarchive, noindex, nofollow");
  }
  const weaker = applySecurityHeaders(
    request("/"),
    new Response(null, {
      headers: { "Referrer-Policy": "no-referrer, unsafe-url", "X-Frame-Options": "SAMEORIGIN" },
    }),
  );
  assert.equal(weaker.headers.get("Referrer-Policy"), "strict-origin-when-cross-origin");
  assert.equal(weaker.headers.get("X-Frame-Options"), "DENY");
});

// Exercise the actual server wrapper without booting TanStack or making requests.
function serverHarness(fetch: (request: Request) => Response | Promise<Response>) {
  const exports: Record<string, unknown> = {};
  const source = readFileSync(new URL("../server.ts", import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  runInNewContext(outputText, {
    exports,
    Response,
    Headers,
    URL,
    console: { error() {} },
    require(id: string) {
      if (id === "./lib/error-capture") return { consumeLastCapturedError: () => undefined };
      if (id === "./lib/error-page") return { renderErrorPage: () => "<html>error</html>" };
      if (id === "./lib/request-abort") return { isRequestAbort: () => false };
      if (id === "./lib/security-headers") return { applySecurityHeaders };
      if (id === "@tanstack/react-start/server-entry") return { default: { fetch } };
      throw new Error(`Unexpected import ${id}`);
    },
  });
  return exports.default as {
    fetch(request: Request, env: unknown, ctx: unknown): Promise<Response>;
  };
}

test("server keeps immutable, static and explicit cache behavior while adding security headers", async () => {
  const server = serverHarness(() => new Response("asset"));
  for (const [path, cache] of [
    ["/assets/app.js", "public, max-age=31536000, immutable"],
    ["/logo.png", "public, max-age=86400, stale-while-revalidate=604800"],
    ["/nike-coupons", null],
  ]) {
    const response = await server.fetch(request(path!), {}, {});
    assertHeaders(response);
    assert.equal(response.headers.get("Cache-Control"), cache);
    assert.equal(response.headers.has("X-Robots-Tag"), false);
  }
  const explicit = serverHarness(
    () =>
      new Response("asset", { headers: { "Cache-Control": "private, max-age=5", Vary: "Cookie" } }),
  );
  const response = await explicit.fetch(request("/assets/app.js"), {}, {});
  assert.equal(response.headers.get("Cache-Control"), "private, max-age=5");
  assert.equal(response.headers.get("Vary"), "Cookie");
});

test("server adds security and indexing headers to normalized and thrown rendered errors", async () => {
  for (const handler of [
    () =>
      new Response('{"unhandled":true,"message":"HTTPError"}', {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }),
    () => {
      throw new Error("SSR fixture failure");
    },
  ]) {
    const response = await serverHarness(handler).fetch(request("/admin"), {}, {});
    assertHeaders(response);
    assert.equal(response.status, 500);
    assert.equal(response.headers.get("X-Robots-Tag"), "noindex, nofollow");
    assert.equal(await response.text(), "<html>error</html>");
  }
});
