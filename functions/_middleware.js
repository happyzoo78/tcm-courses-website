// 全站中介程式：每個請求都會先經過這裡
// 1. 舊網址轉到新位置（檔案搬家後，之前分享出去的連結仍然有效）
// 2. /content/ 底下的檔案必須是名單上的成員並已登入
//    例外：PUBLIC_PREFIXES 裡的資料夾開放所有人觀看（目前：作業）
import { getCurrentAdmin, hasPermission } from "./_lib/session.js";
import { loginResponse } from "./_lib/loginpage.js";

// 舊網址 → 新網址（之後搬移檔案時，在這裡加一行即可）
const MOVED = {
  "/bio-answers": "/content/homework/2026_y1s1/medical-biology/answer-sheet",
  "/karyotype": "/content/homework/2026_y1s1/medical-biology/karyotype-worksheet"
};

const PROTECTED_PREFIX = "/content/";

// 開放所有人觀看的資料夾（不用登入）
// 之後想改回需要登入，把那一行刪掉即可
const PUBLIC_PREFIXES = [
  "/content/homework/"
];

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);
  const path = url.pathname;

  // 1. 舊網址轉址（同時處理有無 .html 兩種寫法）
  const bare = path.replace(/\.html$/, "");
  if (MOVED[bare]) {
    return Response.redirect(new URL(MOVED[bare] + url.search, url).toString(), 301);
  }

  // 2. 不在保護範圍的請求，照常處理
  //    （先解碼、轉小寫再比對，避免用 /CONTENT/ 或 /%63ontent/ 之類的寫法繞過）
  //    編碼過的斜線（%2F、%5C）一律拒絕，避免用 homework%2F..%2Fcourses 從開放資料夾繞進受保護資料夾
  if (/%2f|%5c/i.test(path)) return new Response("Bad request", { status: 400, headers: { "Cache-Control": "no-store" } });
  let normalized = path;
  try { normalized = decodeURIComponent(path); } catch { normalized = path; }
  normalized = new URL(normalized.replace(/\\/g, "/"), url.origin).pathname;   // 解析掉 ../ 與 ./
  const lower = normalized.toLowerCase();
  if (!lower.startsWith(PROTECTED_PREFIX)) return next();

  // 開放資料夾：不用登入，但仍禁止搜尋引擎收錄
  if (PUBLIC_PREFIXES.some(p => lower.startsWith(p))) {
    const response = await next();
    const res = new Response(response.body, response);
    res.headers.set("X-Robots-Tag", "noindex, nofollow");
    return res;
  }

  // 3. 保護範圍：確認登入與閱讀權限
  let user = null;
  try {
    user = env.DB ? await getCurrentAdmin(request, env) : null;
  } catch (error) {
    console.error("Middleware session check failed", error);
    return new Response("Service unavailable", { status: 503, headers: { "Cache-Control": "no-store" } });
  }

  if (!user || !hasPermission(user, "read")) {
    return loginResponse(path + url.search, user);
  }

  // 4. 已登入：回傳檔案，並禁止任何共用快取保存內容
  //    圖片（圖卡）可以存在自己的瀏覽器 7 天，換張時更不用重新下載；網址帶 ?v= 版本，換圖會改版本
  const response = await next();
  const res = new Response(response.body, response);
  const isImage = /\.(webp|png|jpe?g|gif|avif)$/.test(lower);
  res.headers.set("Cache-Control", isImage && response.ok ? "private, max-age=604800" : "private, no-store");
  res.headers.set("X-Robots-Tag", "noindex, nofollow");
  return res;
}
