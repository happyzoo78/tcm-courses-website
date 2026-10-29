// POST /api/password/forgot  { email }
// 忘記密碼：寄「設定新密碼」的連結到名單上的信箱。不透露這個信箱在不在名單裡。
import { jsonResponse } from "../../_lib/auth.js";
import { readJson } from "../../_lib/content.js";
import { mailConfigured } from "../../_lib/mail.js";
import { createAndSend, sha256Hex } from "../../_lib/pwtoken.js";

const DONE = { success: true, message: "如果這個 Email 在名單裡，幾分鐘內會收到設定新密碼的信。沒收到的話，請檢查垃圾郵件，或聯絡網站管理者。" };

export async function onRequestPost({ request, env }) {
  if (!env.DB) return jsonResponse({ error: "Service unavailable" }, 503);
  const origin = request.headers.get("Origin");
  const self = new URL(request.url).origin;
  if (origin && origin !== self) return jsonResponse({ error: "Forbidden" }, 403);
  if (!mailConfigured(env)) return jsonResponse({ error: "網站目前還不能寄信，請聯絡網站管理者幫你重設密碼。" }, 503);

  const parsed = await readJson(request);
  if (parsed.error) return parsed.error;
  const email = String(parsed.body.email || "").trim().toLowerCase();
  if (!email || email.length > 254) return jsonResponse({ error: "請輸入 Email" }, 400);

  const ip = request.headers.get("CF-Connecting-IP") || "";
  const ipHash = ip ? await sha256Hex(`ip:${ip}`) : null;

  try {
    // 防止被拿來亂寄信：同一個網路位置 1 小時最多 10 次
    if (ipHash) {
      const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM password_tokens WHERE ip_hash = ? AND created_at > datetime('now', '-1 hour')").bind(ipHash).first();
      if ((n?.n || 0) >= 10) return jsonResponse({ error: "申請次數太多，請 1 小時後再試。" }, 429);
    }
    const user = await env.DB.prepare("SELECT id, email, display_name, status FROM admin_users WHERE email = ?").bind(email).first();
    if (!user || user.status !== "active") return jsonResponse(DONE);
    // 同一個帳號 1 小時最多寄 3 封
    const m = await env.DB.prepare("SELECT COUNT(*) AS n FROM password_tokens WHERE user_id = ? AND created_at > datetime('now', '-1 hour')").bind(user.id).first();
    if ((m?.n || 0) >= 3) return jsonResponse(DONE);
    await createAndSend(env, self, user, "reset", ipHash);
    return jsonResponse(DONE);
  } catch (error) {
    console.error("Forgot password failed", error);
    if (/no such table/i.test(String(error))) return jsonResponse({ error: "網站還沒開啟寄信功能，請聯絡網站管理者幫你重設密碼。" }, 503);
    return jsonResponse({ error: "寄信失敗，請稍後再試，或聯絡網站管理者。" }, 500);
  }
}
