// GET /api/me
// 查詢目前登入的管理員（未登入回傳 admin: null）
import { jsonResponse } from "../_lib/auth.js";
import { getCurrentAdmin, hasPermission } from "../_lib/session.js";

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

  return jsonResponse({
    admin: {
      id: admin.id,
      email: admin.email,
      displayName: admin.display_name,
      role: admin.role,
      canWrite: hasPermission(admin, "write"),
      canDelete: hasPermission(admin, "publish")
    }
  });
}
