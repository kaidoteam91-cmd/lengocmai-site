// Xem thử web trên máy: node scripts/preview.mjs rồi mở http://localhost:8080
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
const root = new URL("../public/", import.meta.url).pathname.replace(/^\/(\w:)/, "$1");
const T = { ".html": "text/html; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".png": "image/png", ".js": "text/javascript", ".css": "text/css" };
createServer(async (q, r) => {
  let p = decodeURIComponent(q.url.split("?")[0]); if (p.endsWith("/")) p += "index.html";
  try { const f = join(root, normalize(p).replace(/^(\.\.[\/\\])+/, "")); r.writeHead(200, { "content-type": T[extname(f)] || "application/octet-stream" }); r.end(await readFile(f)); }
  catch { r.writeHead(404); r.end("Not found"); }
}).listen(8080, () => console.log("Mở http://localhost:8080 (Ctrl+C để tắt)"));
