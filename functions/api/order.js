// Lưu đơn từ giỏ hàng. Máy chủ tự tính lại giá theo dữ liệu trên web (bỏ qua giá trình duyệt gửi lên),
// kiểm tra "không phải robot" (Cloudflare Turnstile) và giới hạn số đơn mỗi SĐT / mỗi máy.
// Biến môi trường (Cloudflare Pages > Settings > Variables and Secrets):
//   TURNSTILE_SECRET  khóa bí mật Turnstile (có thì bắt buộc kiểm robot)
//   ORDER_HOOK        link Apps Script ghi đơn vào Sheet (có thì dùng thay Google Form)
//   ORDER_KEY         mật khẩu chung giữa web và Apps Script
const DATA = "https://raw.githubusercontent.com/kaidoteam91-cmd/lengocmai-site/data/products.json";
const FORM = "https://docs.google.com/forms/d/e/1FAIpQLSfAfGn4vHZKsZOwogajsOYvVKclEGxpwtPPSlak7bR-mrjrtw/formResponse";
const SITE = "https://lengocmai.com/";
const WEB_OFF = 50000, AUDB = new Set(["Lioness", "I.AM.GIA", "CSB"]);
const LIMIT_IP = 20, LIMIT_PHONE = 4; // số đơn tối đa mỗi giờ
const vnd = n => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ".") + "₫";
const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const clean = (v, n) => String(v ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n);

function vnPhone(v) {
  let d = String(v || "").replace(/[\s.\-()]/g, "");
  if (/^\+?84\d{9}$/.test(d)) d = "0" + d.replace(/^\+?84/, "");
  if (!/^\d+$/.test(d)) return null;
  if (d.length == 9 && d[0] != "0") d = "0" + d; else if (!(d.length == 10 && d[0] == "0")) return null;
  return /^0(3[2-9]|5[25689]|7[06-9]|8[1-9]|9\d)\d{7}$/.test(d) ? d : null;
}

// đếm số lần trong 1 giờ (theo từng trung tâm dữ liệu Cloudflare, đủ để chặn gửi dồn dập)
async function hit(kind, id, max) {
  const c = caches.default, k = new Request(`https://rl.lengocmai.invalid/${kind}/${encodeURIComponent(id)}`);
  const old = await c.match(k);
  let n = 0, exp = Date.now() + 36e5;
  if (old) { try { const o = await old.json(); n = o.n; exp = o.exp; } catch (e) {} }
  if (n >= max) return false;
  const ttl = Math.max(1, Math.round((exp - Date.now()) / 1000));
  await c.put(k, new Response(JSON.stringify({ n: n + 1, exp }), { headers: { "cache-control": `max-age=${ttl}` } }));
  return true;
}

export async function onRequestPost({ request, env }) {
  let b;
  try { b = await request.json(); } catch (e) { return J({ ok: false, error: "bad" }, 400); }
  const phone = vnPhone(b.phone);
  const ch = ["Zalo", "Messenger"].includes(b.ch) ? b.ch : "Khác";
  const list = Array.isArray(b.items) ? b.items.slice(0, 30) : [];
  if (!phone || !list.length) return J({ ok: false, error: "bad" }, 400);
  const ip = request.headers.get("cf-connecting-ip") || "?";

  if (env.TURNSTILE_SECRET) {
    const f = new FormData();
    f.append("secret", env.TURNSTILE_SECRET); f.append("response", String(b.token || "")); f.append("remoteip", ip);
    let ok = false;
    try { ok = (await (await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: f })).json()).success; } catch (e) {}
    if (!ok) return J({ ok: false, error: "robot" }, 403);
  }
  if (!(await hit("ip", ip, LIMIT_IP)) || !(await hit("ph", phone, LIMIT_PHONE))) return J({ ok: false, error: "limit" }, 429);

  const d = await (await fetch(DATA, { cf: { cacheTtl: 600, cacheEverything: true } })).json();
  const rateOk = d.rateOk !== false && !(d.rateGoodAt && Date.now() - Date.parse(d.rateGoodAt) > 72 * 36e5);
  const by = new Map(d.items.map(i => [i.id, i]));
  let t = 0, r = 0, ask = 0, bad = 0;
  const lines = list.map((it, k) => {
    const q = Math.max(1, Math.min(20, parseInt(it && it.q) || 1));
    const s = clean(it && it.s, 20) || "?";
    const x = by.get(String(it && it.id || ""));
    if (!x) { bad++; return `${k + 1}. ⚠ KHÔNG TÌM THẤY MẪU (mã "${clean(it && it.id, 80)}") · Size ${s} · SL ${q}`; }
    const warn = [];
    if (x.so) warn.push("màu này đã hết hàng");
    const sz = (x.s || []).map(z => Array.isArray(z) ? { l: String(z[0]), a: !!z[1] } : { l: String(z), a: true });
    if (sz.length) { const m = sz.find(z => z.l == s); if (!m) warn.push("size không có"); else if (!m.a) warn.push("size đã hết"); }
    if (warn.length) bad++;
    let price;
    if (!rateOk && AUDB.has(x.b)) { ask += q; price = "chờ báo giá"; }
    else { r += x.p * q; t += Math.max(0, x.p - WEB_OFF) * q; price = `${vnd(Math.max(0, x.p - WEB_OFF) * q)} (giá web, giá thường ${vnd(x.p * q)})`; }
    return `${k + 1}. ${x.n} (${x.b})${x.col ? " · Màu " + x.col : ""} · Size ${s} · SL ${q} · ${price} · ${SITE}sp/${encodeURIComponent(x.id)}${warn.length ? " · ⚠ " + warn.join(", ") : ""}`;
  });
  const items = lines.join("\n");
  const total = `${vnd(t)} (giá thường ${vnd(r)}, tiết kiệm ${vnd(r - t)})${ask ? ` (+${ask} chờ báo giá)` : ""}${bad ? " · ⚠ có mẫu cần kiểm lại" : ""}`;
  const ph = phone.replace(/^(\d{4})(\d{3})(\d{3})$/, "$1 $2 $3");

  let sent = false;
  try {
    if (env.ORDER_HOOK) {
      const res = await fetch(env.ORDER_HOOK, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key: env.ORDER_KEY || "", phone: ph, items, total, ch }), redirect: "follow" });
      sent = res.ok && (await res.text()).includes("ok");
    } else {
      const f = new URLSearchParams({ "entry.659917545": ph, "entry.1613144625": items, "entry.12831059": total, "entry.1748751918": ch });
      const res = await fetch(FORM, { method: "POST", body: f, headers: { "content-type": "application/x-www-form-urlencoded" } });
      sent = res.ok;
    }
  } catch (e) {}
  return J({ ok: sent, total: t, bad }, sent ? 200 : 502);
}

export const onRequest = () => J({ ok: false }, 405);
