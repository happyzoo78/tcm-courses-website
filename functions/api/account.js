// PUT /api/account：修改自己的暱稱（所有登入的成員都可以使用）
// 內容：{ "displayName": "小明" }
import { jsonResponse } from "../_lib/auth.js";
import { requireAdmin, readJson, audit } from "../_lib/content.js";
import { hashPassword, verifyPassword } from "../_lib/password.js";
import { NO_PASSWORD, checkPassword } from "../_lib/members.js";

export const MAX_NAME = 30;

export async function onRequestPut({ request, env }) {
  const auth = await requireAdmin(request, env, "read");
  if (auth.error) return auth.error;

  const parsed = await readJson(request);
  if (parsed.error) return parsed.error;

  if ("newPassword" in parsed.body) return changePassword(env, auth.admin, parsed.body);
  if (parsed.body.acceptTerms === true) {
    try {
      await env.DB.prepare("UPDATE admin_users SET terms_accepted_at = CURRENT_TIMESTAMP WHERE id = ?").bind(auth.admin.id).run();
      await audit(env, auth.admin, "update", "account", auth.admin.id, { terms: "accepted" });
      return jsonResponse({ success: true });
    } catch (error) {
      console.error("Accept terms failed", error);
      return jsonResponse({ success: true, note: "terms column missing" });
    }
  }

  // 去掉換行等看不見的控制字元，前後空白也去掉
  const name = String(parsed.body.displayName ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (!name) return jsonResponse({ error: "請輸入暱稱" }, 400);
  if ([...name].length > MAX_NAME) return jsonResponse({ error: `暱稱不可超過 ${MAX_NAME} 字` }, 400);

  try {
    await env.DB.prepare("UPDATE admin_users SET display_name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(name, auth.admin.id).run();
    await audit(env, auth.admin, "update", "account", auth.admin.id, { from: auth.admin.display_name, to: name });
    return jsonResponse({ success: true, displayName: name });
  } catch (error) {
    console.error("Account update failed", error);
    return jsonResponse({ error: "儲存失敗，請稍後再試" }, 500);
  }
}

// 修改自己的登入密碼：已有密碼要先輸入目前密碼；只用 Google 登入的人可以直接設定新密碼
// 成功後讓這個帳號「其他裝置」的登入失效，目前這台保持登入
async function changePassword(env, me, body) {
  const bad = checkPassword(body.newPassword);
  if (bad) return jsonResponse({ error: bad }, 400);

  const row = await env.DB.prepare("SELECT password_hash FROM admin_users WHERE id = ?").bind(me.id).first();
  const hasPassword = row && row.password_hash && row.password_hash !== NO_PASSWORD;
  if (hasPassword) {
    let ok = false;
    try { ok = await verifyPassword(String(body.currentPassword || ""), row.password_hash); } catch { ok = false; }
    if (!ok) return jsonResponse({ error: "目前密碼不正確" }, 400);
  }

  try {
    await env.DB.batch([
      env.DB.prepare("UPDATE admin_users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .bind(await hashPassword(body.newPassword), me.id),
      env.DB.prepare("UPDATE admin_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE user_id = ? AND id != ? AND revoked_at IS NULL")
        .bind(me.id, me.session_id)
    ]);
    await audit(env, me, "update", "account", me.id, { password: hasPassword ? "changed" : "set" });
    return jsonResponse({ success: true });
  } catch (error) {
    console.error("Password change failed", error);
    return jsonResponse({ error: "儲存失敗，請稍後再試" }, 500);
  }
}
