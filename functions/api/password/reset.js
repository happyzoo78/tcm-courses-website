// POST /api/password/reset  { token, newPassword }
// 用信裡的連結設定新密碼：連結只能用一次；成功後該帳號所有裝置都要重新登入
import { jsonResponse } from "../../_lib/auth.js";
import { readJson } from "../../_lib/content.js";
import { hashPassword } from "../../_lib/password.js";
import { checkPassword } from "../../_lib/members.js";
import { sha256Hex } from "../../_lib/pwtoken.js";

export async function onRequestPost({ request, env }) {
  if (!env.DB) return jsonResponse({ error: "Service unavailable" }, 503);
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) return jsonResponse({ error: "Forbidden" }, 403);

  const parsed = await readJson(request);
  if (parsed.error) return parsed.error;
  const token = String(parsed.body.token || "");
  const bad = checkPassword(parsed.body.newPassword);
  if (bad) return jsonResponse({ error: bad }, 400);
  if (!/^[A-Za-z0-9_-]{30,60}$/.test(token)) return jsonResponse({ error: "連結不正確，請重新申請。" }, 400);

  try {
    const row = await env.DB.prepare(`
      SELECT t.id, t.user_id, u.email, u.status FROM password_tokens t JOIN admin_users u ON u.id = t.user_id
      WHERE t.token_hash = ? AND t.used_at IS NULL AND t.expires_at > CURRENT_TIMESTAMP
    `).bind(await sha256Hex(token)).first();
    if (!row || row.status !== "active") return jsonResponse({ error: "連結已失效或已經用過，請重新申請。" }, 400);

    await env.DB.batch([
      env.DB.prepare("UPDATE admin_users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(await hashPassword(parsed.body.newPassword), row.user_id),
      env.DB.prepare("UPDATE password_tokens SET used_at = CURRENT_TIMESTAMP WHERE user_id = ? AND used_at IS NULL").bind(row.user_id),
      env.DB.prepare("UPDATE admin_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE user_id = ? AND revoked_at IS NULL").bind(row.user_id)
    ]);
    try {
      await env.DB.prepare("INSERT INTO admin_audit_logs (actor_user_id, action, resource_type, resource_id) VALUES (?, 'update', 'password-reset', ?)").bind(row.user_id, String(row.user_id)).run();
    } catch (error) { console.error("Audit log failed", error); }
    return jsonResponse({ success: true, email: row.email });
  } catch (error) {
    console.error("Password reset failed", error);
    return jsonResponse({ error: "設定失敗，請稍後再試。" }, 500);
  }
}
