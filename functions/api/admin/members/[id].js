// PUT    /api/admin/members/5   修改成員的權限、名稱或停用狀態
// DELETE /api/admin/members/5   從名單移除（只限從未登入過的成員）
import { jsonResponse } from "../../../_lib/auth.js";
import { requireAdmin, readJson, audit } from "../../../_lib/content.js";
import { MEMBER_ROLES, NO_PASSWORD, checkPassword } from "../../../_lib/members.js";
import { hashPassword } from "../../../_lib/password.js";

async function loadTarget(env, params, auth) {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id < 1) return { error: jsonResponse({ error: "Not found" }, 404) };

  const target = await env.DB.prepare(
    "SELECT id, email, role, status FROM admin_users WHERE id = ?"
  ).bind(id).first();

  if (!target) return { error: jsonResponse({ error: "找不到這位成員" }, 404) };
  if (target.id === auth.admin.id) return { error: jsonResponse({ error: "不能修改自己的帳號" }, 403) };
  if (target.role === "owner") return { error: jsonResponse({ error: "不能修改擁有者" }, 403) };
  return { target };
}

// 讓該成員目前的登入立即失效
function revokeSessions(env, userId) {
  return env.DB.prepare(`
    UPDATE admin_sessions SET revoked_at = CURRENT_TIMESTAMP
    WHERE user_id = ? AND revoked_at IS NULL
  `).bind(userId);
}

export async function onRequestPut({ request, env, params }) {
  const auth = await requireAdmin(request, env, "manage_users");
  if (auth.error) return auth.error;

  const found = await loadTarget(env, params, auth);
  if (found.error) return found.error;
  const { target } = found;

  const parsed = await readJson(request);
  if (parsed.error) return parsed.error;
  const body = parsed.body;

  const sets = [];
  const values = [];

  if ("role" in body) {
    if (!MEMBER_ROLES.includes(body.role)) return jsonResponse({ error: "權限設定不正確" }, 400);
    sets.push("role = ?"); values.push(body.role);
  }
  if ("status" in body) {
    if (!["active", "suspended"].includes(body.status)) return jsonResponse({ error: "狀態設定不正確" }, 400);
    sets.push("status = ?"); values.push(body.status);
  }
  if ("displayName" in body) {
    const name = String(body.displayName || "").trim();
    if (!name || name.length > 100) return jsonResponse({ error: "名稱需為 1～100 字" }, 400);
    sets.push("display_name = ?"); values.push(name);
  }
  // 設定／重設密碼（擁有者幫忘記密碼的同學重設）；password: null 代表取消密碼登入，只能用 Google
  let passwordChanged = false;
  if ("password" in body) {
    if (body.password === null) {
      sets.push("password_hash = ?"); values.push(NO_PASSWORD);
    } else {
      const bad = checkPassword(body.password);
      if (bad) return jsonResponse({ error: bad }, 400);
      sets.push("password_hash = ?"); values.push(await hashPassword(body.password));
    }
    passwordChanged = true;
  }
  if (!sets.length) return jsonResponse({ error: "沒有要修改的內容" }, 400);

  // 權限降低或被停用時，讓對方重新登入，新權限才會立即生效
  const mustRelogin =
    passwordChanged ||
    (body.status === "suspended") ||
    ("role" in body && body.role !== target.role);

  try {
    const stmts = [
      env.DB.prepare(`UPDATE admin_users SET ${sets.join(", ")}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
        .bind(...values, target.id)
    ];
    if (mustRelogin) stmts.push(revokeSessions(env, target.id));
    await env.DB.batch(stmts);

    const { password, ...logged } = body;   // 密碼不寫進操作紀錄
    await audit(env, auth.admin, "update", "member", target.id, { email: target.email, ...logged, ...(passwordChanged ? { password: password === null ? "removed" : "reset" } : {}) });
    return jsonResponse({ success: true });
  } catch (error) {
    console.error("Update member failed", error);
    return jsonResponse({ error: "儲存失敗，請稍後再試" }, 500);
  }
}

export async function onRequestDelete({ request, env, params }) {
  const auth = await requireAdmin(request, env, "manage_users");
  if (auth.error) return auth.error;

  const found = await loadTarget(env, params, auth);
  if (found.error) return found.error;
  const { target } = found;

  // 有登入或操作紀錄的成員不能刪除（保留紀錄的完整性），請改用「停用」
  const used = await env.DB.prepare(`
    SELECT
      (SELECT COUNT(*) FROM admin_sessions WHERE user_id = ?) +
      (SELECT COUNT(*) FROM admin_audit_logs WHERE actor_user_id = ?) AS n
  `).bind(target.id, target.id).first();

  if ((used?.n || 0) > 0) {
    return jsonResponse({ error: "這位成員已經登入過，為了保留紀錄無法刪除，請改用「停用」。" }, 409);
  }

  try {
    // 先移除科目負責人指派，才不會因資料關聯刪不掉
    await env.DB.batch([
      env.DB.prepare("DELETE FROM course_owners WHERE user_id = ?").bind(target.id),
      env.DB.prepare("DELETE FROM admin_users WHERE id = ?").bind(target.id)
    ]);
    await audit(env, auth.admin, "delete", "member", target.id, { email: target.email });
    return jsonResponse({ success: true });
  } catch (error) {
    console.error("Delete member failed", error);
    return jsonResponse({ error: "刪除失敗，請稍後再試" }, 500);
  }
}
