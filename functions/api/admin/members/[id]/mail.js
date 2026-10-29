// POST /api/admin/members/5/mail   擁有者寄「設定密碼」的信給成員（3 天有效）
import { jsonResponse } from "../../../../_lib/auth.js";
import { requireAdmin, audit } from "../../../../_lib/content.js";
import { mailConfigured } from "../../../../_lib/mail.js";
import { createAndSend } from "../../../../_lib/pwtoken.js";

export async function onRequestPost({ request, env, params }) {
  const auth = await requireAdmin(request, env, "manage_users");
  if (auth.error) return auth.error;
  if (!mailConfigured(env)) return jsonResponse({ error: "網站還沒設定寄信，請先照步驟設定 Brevo。" }, 503);

  const user = await env.DB.prepare("SELECT id, email, display_name, status, role FROM admin_users WHERE id = ?").bind(Number(params.id)).first();
  if (!user) return jsonResponse({ error: "找不到這位成員" }, 404);
  if (user.status !== "active") return jsonResponse({ error: "這位成員已停用" }, 400);

  try {
    await createAndSend(env, new URL(request.url).origin, user, "invite", null);
    await audit(env, auth.admin, "update", "member", user.id, { email: user.email, password: "mail-sent" });
    return jsonResponse({ success: true });
  } catch (error) {
    console.error("Send password mail failed", error);
    if (/no such table/i.test(String(error))) return jsonResponse({ error: "資料庫還沒建立 password_tokens 表，請先執行 SQL。" }, 503);
    return jsonResponse({ error: "寄信失敗：請確認 Brevo 金鑰與寄件人設定正確。" }, 500);
  }
}
