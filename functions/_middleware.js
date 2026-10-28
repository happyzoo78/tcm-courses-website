// 全站中介程式：每個請求都會先經過這裡
// 1. 舊網址轉到新位置（檔案搬家後，之前分享出去的連結仍然有效）
// 2. /content/ 底下的檔案必須是名單上的成員並已登入
//    例外：PUBLIC_PREFIXES 裡的資料夾開放所有人觀看（目前：作業）
import { getCurrentAdmin, hasPermission } from "./_lib/session.js";

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

function loginPage(next, reason) {
  const nextQ = encodeURIComponent(next);
  const msg = reason === "denied"
    ? "你的帳號目前沒有閱讀權限，或已被停用。如有疑問，請聯絡網站管理者。"
    : "此頁面僅限班級成員閱讀，請先登入。";
  return `<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark"><meta name="robots" content="noindex, nofollow">
<title>請先登入｜2026福建中醫台灣班網站</title>
<style>
:root{--bg:#f3ede1;--surface:#fbf7ef;--ink:#2b2f2a;--muted:#5f5a4c;--line:#ddd0b8;--accent:#3d5e50;--red:#973d2f}
@media (prefers-color-scheme:dark){:root{--bg:#1b1f1d;--surface:#232926;--ink:#e6e0d2;--muted:#b4ab98;--line:#3c4540;--accent:#9cbfa8;--red:#e09a8c}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:20px;background:var(--bg);color:var(--ink);
font-family:"PingFang TC","Microsoft JhengHei","Noto Sans TC",sans-serif;font-size:17px;line-height:1.8}
.box{width:100%;max-width:420px;padding:28px;background:var(--surface);border:1px solid var(--line);border-radius:14px}
.seal{display:inline-grid;place-items:center;width:30px;height:30px;margin-right:8px;background:var(--red);color:#fff;border-radius:5px;font-size:15px;vertical-align:middle}
h1{font-size:22px;margin:14px 0 6px}p{margin:6px 0;color:var(--muted)}
.g{display:flex;align-items:center;justify-content:center;gap:10px;margin:20px 0 10px;padding:12px;border-radius:10px;
background:#fff;color:#1f1f1f;border:1px solid #c9c4b8;font-weight:600;text-decoration:none}
.g b{font-family:Arial,sans-serif;color:#4f6b5c;font-size:20px}a.home{color:var(--accent);font-size:15px}
</style></head><body><div class="box">
<div><span class="seal">醫</span><b>2026福建中醫台灣班網站</b></div>
<h1>請先登入</h1><p>${msg}</p>
${reason === "denied" ? "" : `<a class="g" href="/api/auth/google/start?next=${nextQ}"><b>G</b> 使用 Google 帳號登入</a>`}
<p><a class="home" href="/">回到網站首頁</a>（管理員密碼登入請由首頁進入）</p>
</div></body></html>`;
}

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
    return new Response(loginPage(path + url.search, user ? "denied" : "login"), {
      status: user ? 403 : 401,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Robots-Tag": "noindex, nofollow"
      }
    });
  }

  // 4. 已登入：回傳檔案，並禁止任何共用快取保存內容
  const response = await next();
  const res = new Response(response.body, response);
  res.headers.set("Cache-Control", "private, no-store");
  res.headers.set("X-Robots-Tag", "noindex, nofollow");
  return res;
}
