// PUT /api/account：修改自己的暱稱（所有登入的成員都可以使用）
// 內容：{ "displayName": "小明" }
import { jsonResponse } from "../_lib/auth.js";
import { requireAdmin, readJson, audit } from "../_lib/content.js";

export const MAX_NAME = 30;

export async function onRequestPut({ request, env }) {
  const auth = await requireAdmin(request, env, "read");
  if (auth.error) return auth.error;

  const parsed = await readJson(request);
  if (parsed.error) return parsed.error;

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
