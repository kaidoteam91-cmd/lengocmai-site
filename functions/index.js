// Trang chủ: gắn sẵn dữ liệu ô brand (home.json) vào HTML và tải trước 4 hình đầu,
// để ô brand và hình hiện ngay, không phải chờ thêm một lượt tải dữ liệu.
const HOME = "https://raw.githubusercontent.com/kaidoteam91-cmd/lengocmai-site/data/home.json";
const CDN = "https://cdn.shopify.com/s/files/";
const ex = u => !u ? "" : u[0] == "~" ? CDN + u.slice(1) : u.startsWith("//") ? "https:" + u : u;
const im = u => /^https:\/\/cdn\.shopify\.com\//.test(u) ? u + "?width=800" : u;
const at = s => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

export async function onRequest(ctx) {
  const res = await ctx.env.ASSETS.fetch(new Request(new URL("/", ctx.request.url)));
  if (!res.ok || !(res.headers.get("content-type") || "").includes("text/html")) return ctx.next();
  let h = null;
  try {
    const r = await fetch(HOME, { cf: { cacheTtl: 300, cacheEverything: true } });
    if (r.ok) h = await r.json();
  } catch (e) {}
  if (!h || !h.brands) return res;
  const js = JSON.stringify(h).replace(/</g, "\\u003c");
  const pre = Object.values(h.brands).map(b => b.i && b.i[0]
    ? `<link rel="preload" as="image" href="${at(im(ex(b.i[0])))}" fetchpriority="high">` : "").join("");
  const out = new HTMLRewriter()
    .on('link[href="https://cdn.shopify.com"]', { element(e) { e.after(`<script>window.__HJ=${js}</script>` + pre, { html: true }) } })
    .transform(res);
  const r2 = new Response(out.body, out);
  r2.headers.delete("etag");
  r2.headers.set("cache-control", "public, max-age=0, must-revalidate");
  return r2;
}
