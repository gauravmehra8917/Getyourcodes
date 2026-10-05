const SENSITIVE_ROUTES = new Set([
  "/auth",
  "/login",
  "/account",
  "/forgot-password",
  "/reset-password",
  "/analytics",
]);
const REFERRER_POLICIES = new Set([
  "no-referrer",
  "no-referrer-when-downgrade",
  "same-origin",
  "origin",
  "strict-origin",
  "origin-when-cross-origin",
  "strict-origin-when-cross-origin",
  "unsafe-url",
]);
const STRICT_REFERRER_POLICIES = new Set([
  "no-referrer",
  "same-origin",
  "strict-origin",
  "strict-origin-when-cross-origin",
]);

export function applySecurityHeaders(request: Request, response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");

  const effectiveReferrerPolicy = (headers.get("Referrer-Policy") ?? "")
    .toLowerCase()
    .split(",")
    .map((value) => value.trim())
    .filter((value) => REFERRER_POLICIES.has(value))
    .at(-1);
  if (!effectiveReferrerPolicy || !STRICT_REFERRER_POLICIES.has(effectiveReferrerPolicy)) {
    headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  }

  const otherPermissions = (headers.get("Permissions-Policy") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value && !/^(camera|microphone|geolocation)\s*=/i.test(value));
  headers.set(
    "Permissions-Policy",
    [...otherPermissions, "camera=()", "microphone=()", "geolocation=()"].join(", "),
  );

  const pathname = new URL(request.url).pathname.replace(/\/+$/, "");
  if (
    pathname === "/admin" ||
    pathname.startsWith("/admin/") ||
    pathname === "/api" ||
    pathname.startsWith("/api/") ||
    SENSITIVE_ROUTES.has(pathname)
  ) {
    const robots = headers.get("X-Robots-Tag");
    headers.set("X-Robots-Tag", robots ? `${robots}, noindex, nofollow` : "noindex, nofollow");
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
