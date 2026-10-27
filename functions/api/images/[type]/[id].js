// GET /api/images/items/101  或  /api/images/projects/201
// 把資料庫中的圖片轉成真正的圖片檔回傳，讓瀏覽器可以快取
import { Buffer } from "node:buffer";

const TABLES = { items: "items", projects: "projects" };
const DATA_URL_RE = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/;

function notFound() {
  return new Response("Not found", {
    status: 404,
    headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" }
  });
}

export async function onRequestGet({ params, env }) {
  const table = TABLES[params.type];
  const id = Number(params.id);
  if (!table || !Number.isInteger(id) || id < 1 || !env.DB) return notFound();

  let row;
  try {
    row = await env.DB.prepare(`SELECT image FROM ${table} WHERE id = ?`).bind(id).first();
  } catch (error) {
    console.error("Image query failed", error);
    return new Response("Error", { status: 500 });
  }

  const match = DATA_URL_RE.exec(row?.image || "");
  if (!match) return notFound();

  // 使用內建的快速轉換（與密碼功能相同，需要 nodejs_compat，你的專案已啟用）
  const bytes = Buffer.from(match[2], "base64");

  return new Response(bytes, {
    headers: {
      "Content-Type": match[1],
      // 網址帶有版本號（?v=更新時間），內容改變時網址也會變，所以可以長期快取
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'",
      "X-Robots-Tag": "noindex"
    }
  });
}
