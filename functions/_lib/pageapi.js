// 上傳網頁 API 共用的檢查：請求格式、登入、網頁內容
import { jsonResponse } from "./auth.js";
import { getCurrentAdmin } from "./session.js";
import { MAX_PAGE_BYTES, titleFromHtml } from "./pages.js";

const encoder = new TextEncoder();

// 讀取請求並做共同檢查：本站送出、已登入、JSON、大小
export async function pageRequest(request, env) {
  if (!env.DB) return { error: jsonResponse({ error: "Service unavailable" }, 503) };
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) return { error: jsonResponse({ error: "Forbidden" }, 403) };

  let user;
  try { user = await getCurrentAdmin(request, env); }
  catch (error) { console.error(error); return { error: jsonResponse({ error: "Service unavailable" }, 503) }; }
  if (!user) return { error: jsonResponse({ error: "Login required" }, 401) };

  if (request.method === "DELETE") return { user, body: {} };

  if (!(request.headers.get("Content-Type") || "").toLowerCase().startsWith("application/json")) {
    return { error: jsonResponse({ error: "JSON required" }, 415) };
  }
  const text = await request.text();
  if (encoder.encode(text).length > MAX_PAGE_BYTES * 2 + 20000) {
    return { error: jsonResponse({ error: "網頁檔案太大（上限約 1.9 MB）" }, 413) };
  }
  let body;
  try { body = JSON.parse(text); } catch { return { error: jsonResponse({ error: "Invalid JSON" }, 400) }; }
  if (!body || typeof body !== "object" || Array.isArray(body)) return { error: jsonResponse({ error: "Invalid JSON" }, 400) };
  return { user, body };
}

// 檢查網頁內容與欄位
export function cleanPage(body, { requireHtml }) {
  const out = {};
  if ("html" in body || requireHtml) {
    const html = typeof body.html === "string" ? body.html : "";
    if (!html.trim()) throw new Error("請選擇要上傳的網頁檔（.html）");
    if (!/<html[\s>]|<!doctype html/i.test(html)) throw new Error("這不是網頁檔，請上傳 .html 檔案");
    const size = encoder.encode(html).length;
    if (size > MAX_PAGE_BYTES) throw new Error(`網頁檔案太大：${(size / 1048576).toFixed(2)} MB，上限約 1.9 MB`);
    out.html = html; out.size = size;
    // 用網站內編輯器寫的網頁，開頭有這個標記，之後可以再用編輯器修改
    out.editor = html.slice(0, 120).includes("<!--tcm-editor v1-->") ? 1 : 0;
  }
  if ("title" in body || requireHtml) {
    let title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title && out.html) title = titleFromHtml(out.html);
    if (!title) throw new Error("請填寫網頁標題");
    if (title.length > 200) throw new Error("標題不可超過 200 字");
    out.title = title;
  }
  if ("description" in body) {
    const d = typeof body.description === "string" ? body.description.trim() : "";
    if (d.length > 1000) throw new Error("說明不可超過 1000 字");
    out.description = d;
  }
  if ("sortOrder" in body) {
    const n = Number(body.sortOrder);
    if (!Number.isInteger(n) || n < 0 || n > 100000) throw new Error("排序必須是 0 以上的整數");
    out.sort_order = n;
  }
  return out;
}


// 資料庫還沒加上 editor 欄位時（尚未執行 SQL），改用不含這個欄位的寫法，網站不會壞掉
export const missingEditorColumn = e => /editor/i.test(String(e?.message || e)) && /column/i.test(String(e?.message || e));
