// Link xem trước (Facebook, Messenger, Zalo): gắn ảnh, tên và giá của mẫu vào trang /sp/<id>.
const DATA = "https://raw.githubusercontent.com/kaidoteam91-cmd/lengocmai-site/data/products.json";
const CDN = "https://cdn.shopify.com/s/files/";
const vnd = n => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ".") + "₫";
const ex = u => !u ? "" : u[0] == "~" ? CDN + u.slice(1) : u.startsWith("//") ? "https:" + u : u;

export async function onRequest(ctx) {
  const res = await ctx.next();
  if (!(res.headers.get("content-type") || "").includes("text/html")) return res;
  let meta = null;
  try {
    const key = decodeURIComponent(ctx.params.id || "");
    const d = await (await fetch(DATA, { cf: { cacheTtl: 600, cacheEverything: true } })).json();
    const x = d.items.find(i => i.id == key) || d.items.find(i => i.id.startsWith(key));
    if (x) {
      const rateOk = d.rateOk !== false && !(d.rateGoodAt && Date.now() - Date.parse(d.rateGoodAt) > 72 * 36e5);
      const showP = rateOk || x.b == "Alo Yoga";
      const pct = x.w > x.p ? Math.round((1 - x.p / x.w) * 100) : 0;
      let img = ex((x.i || [])[0]);
      if (/^https:\/\/cdn\.shopify\.com\//.test(img)) img += "?width=1200";
      meta = {
        title: `${x.n}${x.col ? " · " + x.col : ""}${showP ? " · " + vnd(x.p) : ""}`,
        desc: showP
          ? `${x.b}${pct ? " giảm " + pct + "%" : ""}, giá ${vnd(x.p)} tại LE NGOC MAI. Hàng chính hãng, bấm để xem size và liên hệ đặt.`
          : `Hàng chính hãng ${x.b} tại LE NGOC MAI. Bấm để xem size và liên hệ báo giá.`,
        img
      };
    }
  } catch (e) {}
  return meta ? rewrite(res, meta, ctx.request.url) : res;
}

function rewrite(res, m, url) {
  const set = v => ({ element(e) { e.setAttribute("content", v) } });
  const out = new HTMLRewriter()
    .on("title", { element(e) { e.setInnerContent(m.title + " | LE NGOC MAI") } })
    .on('meta[name="description"]', set(m.desc))
    .on('meta[property="og:title"]', set(m.title))
    .on('meta[name="twitter:title"]', set(m.title))
    .on('meta[property="og:description"]', set(m.desc))
    .on('meta[name="twitter:description"]', set(m.desc))
    .on('meta[property="og:url"]', set(url.split("?")[0]))
    .on('meta[property="og:type"]', set("product"));
  if (m.img) out
    .on('meta[property="og:image"]', set(m.img))
    .on('meta[name="twitter:image"]', set(m.img))
    .on('meta[property="og:image:width"]', { element(e) { e.remove() } })
    .on('meta[property="og:image:height"]', { element(e) { e.remove() } });
  const r = out.transform(res);
  const h = new Headers(r.headers); h.set("cache-control", "public, max-age=300");
  return new Response(r.body, { status: r.status, headers: h });
}
