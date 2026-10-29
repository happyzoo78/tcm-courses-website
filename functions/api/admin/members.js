// GET  /api/admin/members   成員名單
// POST /api/admin/members   加入新成員（只有擁有者可以使用）
import { jsonResponse } from "../../_lib/auth.js";
import { requireAdmin, readJson, audit } from "../../_lib/content.js";
import { MEMBER_ROLES, NO_PASSWORD, checkPassword } from "../../_lib/members.js";
import { hashPassword } from "../../_lib/password.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function onRequestGet({ request, env }) {
  const auth = await requireAdmin(request, env, "manage_users");
  if (auth.error) return auth.error;

  const order = "ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'editor' THEN 2 ELSE 3 END, id";
  let results;
  try {
    ({ results } = await env.DB.prepare(`
      SELECT id, email, display_name, role, status, created_at, last_login_at, last_seen_at, password_hash
      FROM admin_users ${order}
    `).all());
  } catch {
    // 還沒建立 last_seen_at 欄位
    ({ results } = await env.DB.prepare(`
      SELECT id, email, display_name, role, status, created_at, last_login_at, password_hash
      FROM admin_users ${order}
    `).all());
  }
  const now = await env.DB.prepare("SELECT CURRENT_TIMESTAMP AS t").first();

  return jsonResponse({
    now: now?.t || null,
    seenSupported: results.length ? "last_seen_at" in results[0] : true,
    members: results.map(m => ({
      id: m.id,
      email: m.email,
      displayName: m.display_name,
      role: m.role,
      status: m.status,
      createdAt: m.created_at,
      lastLoginAt: m.last_login_at,
      lastSeenAt: m.last_seen_at ?? null,
      hasPassword: Boolean(m.password_hash) && m.password_hash !== NO_PASSWORD,
      isSelf: m.id === auth.admin.id
    }))
  });
}

export async function onRequestPost({ request, env }) {
  const auth = await requireAdmin(request, env, "manage_users");
  if (auth.error) return auth.error;

  const parsed = await readJson(request);
  if (parsed.error) return parsed.error;

  const email = String(parsed.body.email || "").trim().toLowerCase();
  const displayName = String(parsed.body.displayName || "").trim() || email;
  const role = parsed.body.role;

  if (!EMAIL_RE.test(email) || email.length > 254) {
    return jsonResponse({ error: "Email 格式不正確" }, 400);
  }
  if (displayName.length > 100) {
    return jsonResponse({ error: "名稱不可超過 100 字" }, 400);
  }
  if (!MEMBER_ROLES.includes(role)) {
    return jsonResponse({ error: "請選擇權限" }, 400);
  }

  // 臨時密碼（選填）：有填的話，對方也可以用「Email＋密碼」登入（例如人在大陸、不能用 Google 時）
  const pw = parsed.body.password;
  if (pw) {
    const bad = checkPassword(pw);
    if (bad) return jsonResponse({ error: bad }, 400);
  }

  const exists = await env.DB.prepare("SELECT 1 AS ok FROM admin_users WHERE email = ?").bind(email).first();
  if (exists) return jsonResponse({ error: "這個 Email 已經在名單裡了" }, 409);

  try {
    const result = await env.DB.prepare(`
      INSERT INTO admin_users (email, display_name, password_hash, role, status)
      VALUES (?, ?, ?, ?, 'active')
    `).bind(email, displayName, pw ? await hashPassword(pw) : NO_PASSWORD, role).run();

    const id = result.meta?.last_row_id;
    await audit(env, auth.admin, "create", "member", id, { email, role, password: pw ? "set" : "none" });
    return jsonResponse({ success: true, id }, 201);
  } catch (error) {
    console.error("Add member failed", error);
    return jsonResponse({ error: "新增失敗，請稍後再試" }, 500);
  }
}
