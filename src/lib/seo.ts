export const SITE_URL = "https://getyourcodes.com";
export const SITE_NAME = "SaveHub";

export const abs = (path: string) =>
  `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;

export const clip = (s: string | null | undefined, n = 160) =>
  (s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
