import http from "node:http";

const logo =
  "data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2280%22 height=%2280%22%3E%3Crect width=%2280%22 height=%2280%22 fill=%22%234f46e5%22/%3E%3Ctext x=%2210%22 y=%2250%22 fill=%22white%22 font-size=%2224%22%3EQA%3C/text%3E%3C/svg%3E";
export const code = "MOBILEQA0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
export const categories = Array.from({ length: 30 }, (_, i) => ({
  id: `category-${i}`,
  slug: i ? `category-${i}` : "fashion",
  name: i ? `Health, Beauty and Personal Care ${i}` : "Fashion and Accessories",
}));
export const stores = Array.from({ length: 60 }, (_, i) => ({
  id: `store-${i}`,
  slug: i ? `store-${i}` : "loragal",
  name:
    i === 0
      ? "Loragal"
      : i === 1
        ? "SuperLongMerchantNameWithoutSpaces"
        : `Fashion and Home Marketplace ${i}`,
  description: "Shop clothing and accessories with verified seasonal offers.",
  logo_url: i % 2 ? null : logo,
  affiliate_url: "https://affiliate.example.test/store",
  category_id: categories[i % 30].id,
  featured: true,
  country: "United States",
  shipping_regions: ["United States", "United Kingdom", "Australia"],
}));
export const coupons = Array.from({ length: 80 }, (_, i) => ({
  id: `qa-offer-${i}`,
  store_id: stores[i % 60].id,
  stores: stores[i % 60],
  coupon_type: i % 2 ? "deal" : "code",
  title:
    i === 2
      ? "Save 30% off selected fashion"
      : "Seasonal savings on new arrivals, clothing and accessories for every occasion",
  description:
    "Discover clothing, shoes and accessories. Eligibility and merchant conditions apply.",
  coupon_code: i % 2 ? null : code,
  affiliate_url: "https://affiliate.example.test/offer",
  landing_page_url: "https://merchant.example.test/collection",
  status: "active",
  created_at: "2026-10-01T00:00:00Z",
  expiry_date: "2035-12-31T00:00:00Z",
  discount_type: i === 2 ? "fixed" : "percentage",
  discount_value: i === 2 ? 999 : 20,
  structured_terms: { minimumPurchase: 100, currency: "USD", scope: "CATEGORY" },
  terms:
    "Offer applies to selected items only. " +
    "Please check eligibility with the merchant before purchase. ".repeat(20),
}));

export function startFixtureServer(port = 4318) {
  const writes = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Expose-Headers", "Content-Range");
    if (req.method === "OPTIONS") {
      res.writeHead(204).end();
      return;
    }
    if (req.method !== "GET") {
      writes.push({ method: req.method, path: url.pathname });
      res.writeHead(201, { "Content-Type": "application/json" }).end("[]");
      return;
    }
    const table = url.pathname.split("/").at(-1);
    let rows =
      table === "stores"
        ? stores
        : table === "categories"
          ? categories
          : table === "coupons"
            ? coupons
            : [];
    for (const field of ["slug", "store_id", "category_id", "coupon_type"]) {
      const filter = url.searchParams.get(field);
      if (filter?.startsWith("eq.")) rows = rows.filter((row) => row[field] === filter.slice(3));
    }
    const total = rows.length;
    const offset = Number(url.searchParams.get("offset") || 0);
    const limit = Number(url.searchParams.get("limit") || total);
    rows = rows.slice(offset, offset + limit);
    res.setHeader("Content-Range", `${offset}-${offset + Math.max(0, rows.length - 1)}/${total}`);
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify(req.headers.accept?.includes("vnd.pgrst.object") ? (rows[0] ?? null) : rows),
    );
  });
  return new Promise((resolve) =>
    server.listen(port, "127.0.0.1", () => resolve({ server, writes })),
  );
}
