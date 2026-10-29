// GET /api/me
// 查詢目前登入的使用者與權限（未登入回傳 admin: null）
import { jsonResponse } from "../_lib/auth.js";
import { getCurrentAdmin, hasPermission } from "../_lib/session.js";
import { ownedCourseIds } from "../_lib/pages.js";

export async function onRequestGet({ request, env }) {
  if (!env.DB) {
    return jsonResponse({ error: "Service unavailable" }, 503);
  }

  let admin;
  try {
    admin = await getCurrentAdmin(request, env);
  } catch (error) {
    console.error("Session lookup failed", error);
    return jsonResponse({ error: "Service unavailable" }, 503);
  }

  if (!admin) return jsonResponse({ admin: null });

  let hasPassword = false;
  try {
    const row = await env.DB.prepare("SELECT password_hash FROM admin_users WHERE id = ?").bind(admin.id).first();
    hasPassword = Boolean(row?.password_hash) && row.password_hash !== "!google-only";
  } catch (error) { console.error("Password flag lookup failed", error); }

  let owned = [];
  try { owned = await ownedCourseIds(env, admin); } catch (error) { console.error("Owner lookup failed", error); }

  return jsonResponse({
    admin: {
      id: admin.id,
      email: admin.email,
      displayName: admin.display_name,
      role: admin.role,
      canWrite: hasPermission(admin, "write"),
      canDelete: hasPermission(admin, "publish"),
      canManageMembers: hasPermission(admin, "manage_users"),
      canManageCourses: hasPermission(admin, "publish"),   // 建立科目、指派負責人、開放學期
      hasPassword,                                          // 有沒有設定登入密碼（我的帳號頁用）
      ownedCourseIds: owned                                 // 自己負責的科目

    }
  });
}
