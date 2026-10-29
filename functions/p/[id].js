// GET /p/123：顯示上傳的網頁（只限名單內的成員）
import { getCurrentAdmin, hasPermission } from "../_lib/session.js";
import { loginResponse } from "../_lib/loginpage.js";

export async function onRequestGet({ request, env, params }) {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id < 1 || !env.DB) {
    return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  }

  let user = null;
  try {
    user = await getCurrentAdmin(request, env);
  } catch (error) {
    console.error("Page session check failed", error);
    return new Response("Service unavailable", { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  if (!user || !hasPermission(user, "read")) return loginResponse(`/p/${id}`, user);

  const row = await env.DB.prepare("SELECT html FROM pages WHERE id = ?").bind(id).first();
  if (!row) {
    return new Response("找不到這個網頁，可能已被刪除。", {
      status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" }
    });
  }

  return new Response(row.html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex, nofollow",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "same-origin",
      // 把上傳的網頁放進「沙盒」：網頁裡的程式照常執行，
      // 但被當成獨立的來源，無法用一般會員的登入身分呼叫本站後台 API
      "Content-Security-Policy": "sandbox allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads"
    }
  });
}
