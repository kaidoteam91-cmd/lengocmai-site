// Đồng bộ sản phẩm từ 3 web brand (Shopify) -> public/data/products.json
// Chạy: node scripts/sync.mjs   (Node 18+). GitHub Actions chạy tự động mỗi ngày.
import { writeFile, readFile, mkdir } from "node:fs/promises";

const OUT = new URL("../public/data/products.json", import.meta.url);
const CFG = {
  markup: 1.07, fee: 550000, roundTo: 50000,
  brandMarkup: { "Alo Yoga": 1 },                 // Alo: giá web VND + 550.000
  brandSale: { "Lioness": 50, "I.AM.GIA": 75, "Alo Yoga": 30 }, // % sale gốc hiện ở ô brand (sửa tay khi brand đổi đợt sale)
  fallbackRates: { AUD: 17403.88, USD: 25970, VND: 1 },
  // (tuỳ chọn) Google Sheet đã "Xuất bản lên web" dạng CSV, cột: handle | thao_tac (an / ghim)
  overridesCsv: process.env.OVERRIDES_CSV || "",
};
const BRANDS = [
  { name: "Lioness", base: "https://lionessfashion.com", cur: "AUD", best: "/collections/best-sellers/products.json?limit=250" },
  { name: "I.AM.GIA", base: "https://au.iamgia.com", cur: "AUD", best: null },
  { name: "Alo Yoga", base: "https://www.aloyoga.com/en-vn", cur: "VND", best: "/collections/bestsellers/products.json?limit=250",
    keep: p => /^(w|u)\d/i.test(p.handle) || /women/i.test(p.product_type) },
];
const UA = { "user-agent": "Mozilla/5.0 (compatible; lengocmai-sync/1.0)", accept: "application/json" };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getJSON(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: UA });
      if (r.ok) return await r.json();
      if (r.status === 404) return null;
      console.warn("HTTP", r.status, url);
    } catch (e) { console.warn("ERR", e.message, url); }
    await sleep(1500 * (i + 1));
  }
  throw new Error("Không lấy được " + url);
}

async function vcbRates() {
  try {
    const r = await fetch("https://portal.vietcombank.com.vn/Usercontrols/TVPortal.TyGia/pXML.aspx", { headers: { "user-agent": UA["user-agent"] } });
    const x = await r.text();
    const out = { VND: 1 };
    for (const m of x.matchAll(/CurrencyCode="(\w+)"[^>]*?Sell="([\d,.]+)"/g)) out[m[1]] = parseFloat(m[2].replace(/,/g, ""));
    if (out.AUD > 1000) { out._at = (x.match(/<DateTime>([^<]+)/) || [])[1] || ""; return out; }
  } catch (e) { console.warn("VCB lỗi:", e.message); }
  return null;
}

const CAT_RULES = [
  ["Accessories", /gift ?card|e-?voucher|bag|tote|hat|cap\b|beanie|sock|jewel|necklace|earring|belt|bottle|mat\b|scrunch|headband|sunglass|accessor|towel|candle/],
  ["Shoes", /shoe|sneaker|heel|boot|sandal|slide|loafer|mule|trainer/],
  ["Swim", /swim|bikini|one ?piece swim/],
  ["Dress", /dress|gown/],
  ["Jumpsuit", /jumpsuit|playsuit|romper|unitard|onesie|catsuit/],
  ["Skirts", /skirt|skort/],
  ["Shorts", /short(?!\s*-?\s*sleeve)/],
  ["Pants", /pant|legging|jean|trouser|jogger|capri|flare|bottom|tight/],
  ["Jacket", /jacket|blazer|bomber|hoodie|zip/],
  ["Outerwear", /coat|trench|puffer|vest|gilet|outerwear|cover ?up|coverup|pullover|sweater|sweatshirt|cardigan|knit|crew/],
  ["Top", /top|tee|t-shirt|tank|bra\b|bralette|cami|bodysuit|shirt|blouse|corset|sleeve|polo|halter|tube/],
];
function category(p) {
  const t = (p.product_type || "").toLowerCase(), n = (p.title || "").toLowerCase();
  for (const src of [t, n]) for (const [c, re] of CAT_RULES) if (re.test(src)) return c;
  return "Top";
}
const price = (v, cur, brand, rates) => {
  const r = rates[cur] ?? 1, m = CFG.brandMarkup[brand] ?? CFG.markup;
  return Math.ceil((v * r * m + CFG.fee) / CFG.roundTo) * CFG.roundTo;
};
const img = s => s ? s.split("?")[0] + "?width=600" : "";

async function overrides() {
  if (!CFG.overridesCsv) return { hide: new Set(), pin: new Set() };
  const t = await (await fetch(CFG.overridesCsv)).text();
  const hide = new Set(), pin = new Set();
  for (const line of t.split(/\r?\n/).slice(1)) {
    const [h, a] = line.split(",").map(s => (s || "").trim().toLowerCase());
    if (!h) continue; if (/an|ẩn|hide/.test(a)) hide.add(h); if (/ghim|pin/.test(a)) pin.add(h);
  }
  return { hide, pin };
}

async function main() {
  let prev = null; try { prev = JSON.parse(await readFile(OUT, "utf8")); } catch {}
  const live = await vcbRates();
  const rates = live || prev?.rates || CFG.fallbackRates;
  const ov = await overrides().catch(() => ({ hide: new Set(), pin: new Set() }));
  const out = [], status = {};
  for (const b of BRANDS) {
    try {
      const rank = new Map();
      if (b.best) { const j = await getJSON(b.base + b.best); (j?.products || []).forEach((p, i) => rank.set(p.handle, i)); }
      let n = 0;
      for (let page = 1; page < 60; page++) {
        const j = await getJSON(`${b.base}/products.json?limit=250&page=${page}`);
        const ps = j?.products || []; if (!ps.length) break;
        for (const p of ps) {
          if (b.keep && !b.keep(p)) continue;
          if (ov.hide.has(p.handle)) continue;
          const av = p.variants.filter(v => v.available); if (!av.length || !p.images?.length) continue;
          const cat = category(p); if (cat === "Accessories" && /gift|voucher/i.test(p.title + p.product_type)) continue;
          const si = (p.options || []).findIndex(o => /size/i.test(o.name));
          const sizes = [...new Set(av.map(v => si >= 0 ? v["option" + (si + 1)] : v.option1))].filter(Boolean);
          const v = av.reduce((a, c) => (+c.price < +a.price ? c : a), av[0]);
          const now = price(+v.price, b.cur, b.name, rates);
          const was = +v.compare_at_price > +v.price ? price(+v.compare_at_price, b.cur, b.name, rates) : now;
          out.push({
            id: p.handle, n: p.title, b: b.name, c: cat, p: now, w: was,
            s: sizes, i: [img(p.images[0]?.src), img(p.images[1]?.src || p.images[0]?.src)],
            r: ov.pin.has(p.handle) ? -1 : (rank.has(p.handle) ? rank.get(p.handle) : 9999),
            t: Date.parse(p.published_at || p.created_at) || 0,
          });
          n++;
        }
        await sleep(400);
      }
      status[b.name] = n;
      console.log(b.name, n, "mẫu còn hàng");
    } catch (e) {
      console.warn(b.name, "lỗi:", e.message, "-> giữ dữ liệu cũ");
      const old = (prev?.items || []).filter(x => x.b === b.name);
      out.push(...old); status[b.name] = "cũ:" + old.length;
    }
  }
  const data = { updated: new Date().toISOString(), rates: { AUD: rates.AUD, USD: rates.USD, VND: 1, _at: rates._at || "" },
    brandSale: CFG.brandSale, status, items: out };
  await mkdir(new URL("../public/data/", import.meta.url), { recursive: true });
  await writeFile(OUT, JSON.stringify(data));
  console.log("Tổng:", out.length, "mẫu. Tỉ giá AUD:", rates.AUD, live ? "(VCB mới)" : "(dùng tỉ giá cũ)");
}
main().catch(e => { console.error(e); process.exit(1); });
