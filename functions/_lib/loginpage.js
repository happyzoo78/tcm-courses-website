// 「請先登入」頁面：受保護的頁面（content/ 與上傳的網頁）共用
export function loginPage(next, reason) {
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

export function loginResponse(next, user) {
  return new Response(loginPage(next, user ? "denied" : "login"), {
    status: user ? 403 : 401,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow"
    }
  });
}
