// Đồng bộ sản phẩm BEST SELLER từ 3 web brand (Shopify) -> public/data/products.json
// Chạy: node scripts/sync.mjs   (Node 18+). GitHub Actions chạy tự động mỗi tiếng.
import { writeFile, readFile, mkdir } from "node:fs/promises";

const OUT = new URL("../public/data/products.json", import.meta.url);
const CFG = {
  markup: 1.07, fee: 550000, roundTo: 50000,
  maxPrice: 8000000,                                     // chỉ lấy mẫu có giá hiển thị <= 8 triệu
  brandSale: { "Lioness": 50, "I.AM.GIA": 75, "Alo Yoga": 30 }, // % sale ở ô brand (sửa tay khi brand đổi đợt sale)
  fallbackRates: { AUD: 17403.88, USD: 25970, VND: 1 },
  rateBounds: { AUD: [12000, 24000] },                    // tỉ giá ngoài khoảng này = coi là lỗi
  maxJump: 0.06,                                          // tỉ giá mới lệch > 6% so với lần trước = coi là lỗi
  maxRateAgeH: 72,                                        // tỉ giá cũ quá 72 giờ thì KHÔNG hiện giá AUD
  overridesCsv: process.env.OVERRIDES_CSV || "",
  feedbackCsv: process.env.FEEDBACK_CSV || "https://docs.google.com/spreadsheets/d/e/2PACX-1vSSms356KKRux1jaDpxKgoK3EvOZ-gcD-uZ5xT1L2RfNz3wtbYuzAxzuUz55vvM3ENF5kDKR-UlpZAr/pub?gid=1105504292&single=true&output=csv",            // CSV feedback (Google Sheet tab "web" đã xuất bản): anh | link_mau | ghi_chu         // (tuỳ chọn) CSV: handle | thao_tac (an / ghim)
};

// Giá hiển thị: Lioness, I.AM.GIA = giá AUD × tỉ giá bán VCB × 1.07 + 550.000, làm tròn lên 50.000.
// Alo Yoga = giá web VND + 550.000 (giữ nguyên, không làm tròn).
const BRANDS = [
  { name: "Lioness", base: "https://lionessfashion.com", cur: "AUD", best: "best-sellers",
    cats: ["Tops", "Dresses", "Pants", "Outerwear", "Shorts", "Skirts", "Jackets", "Denim", "Sets", "Swim"],
    cat: p => { const t = (p.product_type || "").replace(/^women'?s\s*/i, "").trim();
      if (/denim|jean/i.test(t)) return "Denim"; if (/swim|bikini/i.test(t)) return "Swim"; return t || "Tops"; } },
  { name: "I.AM.GIA", base: "https://au.iamgia.com", cur: "AUD", best: "most-wanted",
    cats: ["Dresses", "Tops", "Pants", "Shorts", "Skirts", "Sets", "Tracksuits", "Jackets", "Jumpsuits", "Bikinis", "Bottoms", "Lingerie", "Accessories", "Footwear"],
    cat: p => { const t = (p.product_type || "").split(":")[0].trim();
      if (!t || /^axx$/i.test(t) || /access/i.test(t)) return "Accessories"; return t; } },
  { name: "Alo Yoga", base: "https://www.aloyoga.com/en-vn", cur: "VND", best: "bestsellers", exact: true,
    cg: p => (p.tags || []).includes("ColorwayType:Limited") ? "Limited" : "Core",
    skipSoldOut: p => (p.tags || []).includes("clearance"),
    cats: ["Leggings", "Bras", "Tanks", "Short Sleeves", "Long Sleeves", "Pants", "Sweatpants", "Shorts", "Skirts", "Dresses", "Jackets", "Hoodies", "Pullovers", "Accessories"],
    keep: p => /^women/i.test(p.product_type || ""),
    group: p => (p.tags || []).map(t => (t.match(/^StyleId:(.+)$/) || [])[1]).find(Boolean),
    cat: p => { const s = (p.product_type || "").split(":").map(x => x.trim()).filter(Boolean);
      if (s.includes("Accessories")) return "Accessories"; return s[s.length - 1] || "Tops"; } },
];
const UA = { "user-agent": "Mozilla/5.0 (compatible; lengocmai-sync/2.0)", accept: "application/json" };
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
async function allPages(path) {
  const out = [];
  for (let page = 1; page < 60; page++) {
    const j = await getJSON(`${path}${path.includes("?") ? "&" : "?"}limit=250&page=${page}`);
    const ps = j?.products || []; if (!ps.length) break;
    out.push(...ps); await sleep(350);
  }
  return out;
}

async function vcbRates() {
  try {
    const r = await fetch("https://portal.vietcombank.com.vn/Usercontrols/TVPortal.TyGia/pXML.aspx", { headers: { "user-agent": UA["user-agent"] } });
    const x = await r.text(); const out = { VND: 1 };
    for (const m of x.matchAll(/CurrencyCode="(\w+)"[^>]*?Sell="([\d,.]+)"/g)) out[m[1]] = parseFloat(m[2].replace(/,/g, ""));
    if (out.AUD > 1000) { out._at = (x.match(/<DateTime>([^<]+)/) || [])[1] || ""; return out; }
  } catch (e) { console.warn("VCB lỗi:", e.message); }
  return null;
}

const priceOf = (v, b, rates) => b.exact
  ? Math.round(v + CFG.fee)
  : Math.ceil((v * (rates[b.cur] ?? 1) * CFG.markup + CFG.fee) / CFG.roundTo) * CFG.roundTo;
// rút gọn link ảnh Shopify cho file nhẹ hơn ("~" = https://cdn.shopify.com/s/files/)
const img = s => { if (!s) return ""; s = s.split("?")[0].replace(/^https?:/, ""); return s.replace(/^\/\/cdn\.shopify\.com\/s\/files\//, "~"); };
const baseTitle = t => t.includes(" - ") ? t.slice(0, t.lastIndexOf(" - ")).trim() : t.trim();
const colorTitle = t => t.includes(" - ") ? t.slice(t.lastIndexOf(" - ") + 3).trim() : "";
const groupKey = (p, b) => b.name.slice(0, 3).toLowerCase() + ":" + ((b.group && b.group(p)) || baseTitle(p.title).toUpperCase());

async function overrides() {
  if (!CFG.overridesCsv) return { hide: new Set(), pin: new Set() };
  const t = await (await fetch(CFG.overridesCsv)).text(); const hide = new Set(), pin = new Set();
  for (const line of t.split(/\r?\n/).slice(1)) {
    const [h, a] = line.split(",").map(s => (s || "").trim().toLowerCase());
    if (!h) continue; if (/an|ẩn|hide/.test(a)) hide.add(h); if (/ghim|pin/.test(a)) pin.add(h);
  }
  return { hide, pin };
}

// Feedback: ảnh Google Drive / link ảnh bất kỳ + link mẫu trên lengocmai.com
function csvRows(t) { const rows = []; let row = [], f = "", q = false;
  for (let i = 0; i < t.length; i++) { const c = t[i];
    if (q) { if (c == '"' && t[i + 1] == '"') { f += '"'; i++ } else if (c == '"') q = false; else f += c }
    else if (c == '"') q = true; else if (c == ",") { row.push(f); f = "" } else if (c == "\n") { row.push(f); rows.push(row); row = []; f = "" } else if (c != "\r") f += c }
  if (f || row.length) { row.push(f); rows.push(row) } return rows; }
const driveImg = u => { const m = String(u).match(/(?:\/d\/|[?&]id=)([\w-]{20,})/); return m ? `https://lh3.googleusercontent.com/d/${m[1]}=w1200` : String(u).trim(); };
const spId = u => { const m = String(u).match(/(?:\/sp\/|#sp-)([^?#\s]+)/); return m ? decodeURIComponent(m[1]) : ""; };
async function feedback() {
  if (!CFG.feedbackCsv) return null;
  const r = await fetch(CFG.feedbackCsv); if (!r.ok) throw new Error("HTTP " + r.status);
  return csvRows(await r.text()).slice(1).filter(x => (x[0] || "").trim())
    .map(x => ({ img: driveImg(x[0]), id: spId(x[1] || ""), note: (x[2] || "").trim().slice(0, 200) })).reverse();
}

// Tách 1 sản phẩm Shopify thành các mẫu theo màu (đa số brand đã để mỗi màu là 1 sản phẩm riêng)
function colorItems(p, b, rates) {
  const opt = n => (p.options || []).findIndex(o => n.test(o.name));
  const si = opt(/size/i), ci = opt(/colou?r/i);
  const colors = ci >= 0 ? [...new Set(p.variants.map(v => v["option" + (ci + 1)]))] : [null];
  const g = groupKey(p, b);
  return colors.map(col => {
    const vs = col == null ? p.variants : p.variants.filter(v => v["option" + (ci + 1)] === col);
    const av = vs.filter(v => v.available), so = !av.length;
    if (so && b.skipSoldOut && b.skipSoldOut(p)) return null;
    const sizes = si >= 0 ? p.options[si].values.filter(s => vs.some(v => v["option" + (si + 1)] === s))
      .map(s => [s, vs.some(v => v.available && v["option" + (si + 1)] === s) ? 1 : 0]) : [];
    const pool = so ? vs : av;
    const v = pool.reduce((a, c) => (+c.price < +a.price ? c : a), pool[0]);
    const now = priceOf(+v.price, b, rates);
    const was = +v.compare_at_price > +v.price ? priceOf(+v.compare_at_price, b, rates) : now;
    let ims = p.images || [];
    if (colors.length > 1) {
      const ids = new Set(vs.map(x => x.id));
      const f = ims.filter(im => (im.variant_ids || []).some(id => ids.has(id)));
      if (f.length) ims = f;
    }
    if (!ims.length) return null;
    const multi = colors.length > 1;
    return {
      id: multi ? `${p.handle}-${String(col).toLowerCase().replace(/[^a-z0-9]+/g, "-")}` : p.handle,
      g, n: baseTitle(p.title), col: (multi ? col : (col || colorTitle(p.title))) || "", b: b.name, c: b.cat(p),
      ...(b.cg ? { cg: b.cg(p) } : {}), ...(so ? { so: 1 } : {}),
      p: now, w: was, s: sizes, i: ims.slice(0, so ? 2 : 4).map(im => img(im.src)),
      t: Date.parse(p.published_at || p.created_at) || 0,
    };
  }).filter(Boolean);
}

async function main() {
  let prev = null; try { prev = JSON.parse(await readFile(OUT, "utf8")); } catch {}
  // Tỉ giá: chỉ dùng khi hợp lệ. Lỗi/bất thường -> dùng tỉ giá tốt lần trước (nếu chưa quá cũ), không thì tắt giá AUD.
  const inB = r => r && r.AUD >= CFG.rateBounds.AUD[0] && r.AUD <= CFG.rateBounds.AUD[1];
  const prevOk = prev?.rateOk !== false && inB(prev?.rates) ? prev.rates : null;
  let live = await vcbRates(), rateNote = live ? "VCB mới" : "VCB lỗi";
  if (live && !inB(live)) { console.warn("Tỉ giá VCB ngoài khoảng hợp lệ:", live.AUD); live = null; rateNote = "VCB bất thường"; }
  if (live && prevOk && Math.abs(live.AUD / prevOk.AUD - 1) > CFG.maxJump) { console.warn("Tỉ giá nhảy quá mạnh:", prevOk.AUD, "->", live.AUD); live = null; rateNote = "VCB nhảy bất thường"; }
  const goodAt = live ? new Date().toISOString() : (prev?.rateGoodAt || null);
  const fresh = goodAt && (Date.now() - Date.parse(goodAt)) / 36e5 <= CFG.maxRateAgeH;
  const rates = live || prevOk || CFG.fallbackRates;
  const rateOk = !!(live || (prevOk && fresh));
  if (!live) rateNote += prevOk ? (fresh ? " -> dùng tỉ giá lần trước" : " -> tỉ giá cũ quá hạn, ẨN giá AUD") : " -> không có tỉ giá tốt, ẨN giá AUD";
  const ov = await overrides().catch(() => ({ hide: new Set(), pin: new Set() }));
  const out = [], status = {}, cats = {};
  for (const b of BRANDS) {
    try {
      const best = await allPages(`${b.base}/collections/${b.best}/products.json`);
      const all = await allPages(`${b.base}/products.json`);
      const keep = p => (!b.keep || b.keep(p)) && !ov.hide.has(p.handle);
      // hạng best seller theo kiểu dáng; mọi màu còn hàng của kiểu best seller đều được lấy
      const rank = new Map();
      best.filter(keep).forEach((p, i) => { const g = groupKey(p, b), r = ov.pin.has(p.handle) ? -1 : i;
        if (!rank.has(g) || r < rank.get(g)) rank.set(g, r); });
      const seen = new Set(), items = [];
      for (const p of [...best, ...all]) {
        if (seen.has(p.handle) || !keep(p)) continue; seen.add(p.handle);
        if (!rank.has(groupKey(p, b))) continue;
        for (const it of colorItems(p, b, rates)) {
          if (it.p > CFG.maxPrice) continue;
          it.r = rank.get(it.g); items.push(it);
        }
      }
      // chỉ hiện kiểu còn ít nhất 1 màu còn hàng (giống danh sách best seller của web gốc); màu đã hết vẫn giữ để gạch ngang
      const live = new Set(items.filter(i => !i.so).map(i => i.g));
      for (let k = items.length - 1; k >= 0; k--) if (!live.has(items[k].g)) items.splice(k, 1);
      const used = new Set(items.map(i => i.c));
      cats[b.name] = [...b.cats.filter(c => used.has(c)), ...[...used].filter(c => !b.cats.includes(c)).sort()];
      out.push(...items); status[b.name] = items.length;
      console.log(b.name, rank.size, "kiểu best seller,", items.length, "mẫu màu còn hàng <= 8tr");
    } catch (e) {
      console.warn(b.name, "lỗi:", e.message, "-> giữ dữ liệu cũ");
      const old = prev?.v === 2 ? (prev.items || []).filter(x => x.b === b.name) : [];
      out.push(...old); status[b.name] = "cũ:" + old.length; if (prev?.cats?.[b.name]) cats[b.name] = prev.cats[b.name];
    }
  }
  let fb = null; try { fb = await feedback(); } catch (e) { console.warn("Feedback lỗi:", e.message); }
  if (fb == null) fb = prev?.feedback || [];
  const data = { v: 2, feedback: fb, updated: new Date().toISOString(), rates: { AUD: rates.AUD, USD: rates.USD, VND: 1, _at: rates._at || "" },
    rateOk, rateGoodAt: goodAt, rateNote,
    brandSale: CFG.brandSale, cats, status, items: out };
  await mkdir(new URL("../public/data/", import.meta.url), { recursive: true });
  await writeFile(OUT, JSON.stringify(data));
  console.log("Tổng:", out.length, "mẫu. Tỉ giá AUD:", rates.AUD, "(" + rateNote + ")", rateOk ? "" : "-> GIÁ AUD BỊ ẨN");
}
main().catch(e => { console.error(e); process.exit(1); });
