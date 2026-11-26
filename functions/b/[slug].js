// Link xem trước cho trang thương hiệu /b/<brand>.
const DATA = "https://raw.githubusercontent.com/kaidoteam91-cmd/lengocmai-site/data/products.json";
const slug = s => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/gi, "d").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export async function onRequest(ctx) {
  const res = await ctx.next();
  if (!(res.headers.get("content-type") || "").includes("text/html")) return res;
  let t = null, desc = "";
  try {
    const key = String(ctx.params.slug || "").toLowerCase();
    const d = await (await fetch(DATA, { cf: { cacheTtl: 600, cacheEverything: true } })).json();
    const b = Object.keys(d.brandSale || {}).find(x => slug(x) == key);
    if (b) {
      const pct = d.brandSale[b];
      const n = new Set(d.items.filter(i => i.b == b).map(i => i.g || i.id)).size;
      t = `${b} sale đến -${pct}% | Săn Sale cuối năm`;
      desc = `${n} mẫu ${b} chính hãng đang sale tại LE NGOC MAI. Bấm để xem và liên hệ đặt.`;
    }
  } catch (e) {}
  if (!t) return res;
  const set = v => ({ element(e) { e.setAttribute("content", v) } });
  return new HTMLRewriter()
    .on("title", { element(e) { e.setInnerContent(t + " | LE NGOC MAI") } })
    .on('meta[name="description"]', set(desc))
    .on('meta[property="og:title"]', set(t))
    .on('meta[name="twitter:title"]', set(t))
    .on('meta[property="og:description"]', set(desc))
    .on('meta[name="twitter:description"]', set(desc))
    .on('meta[property="og:url"]', set(ctx.request.url.split("?")[0]))
    .transform(res);
}
