import {
  jsonResponse,
  createSessionCookie
} from "../_lib/auth.js";

import { verifyPassword } from "../_lib/password.js";
import { createSession } from "../_lib/session.js";

const encoder = new TextEncoder();

export async function onRequestPost({ request, env }) {
  // 1. 確認 D1 綁定存在
  if (!env.DB) {
    return jsonResponse({ error: "Service unavailable" }, 503);
  }

  // 2. 僅接受本站送出的請求
  const origin = request.headers.get("Origin");

  if (origin && origin !== new URL(request.url).origin) {
    return jsonResponse({ error: "Forbidden" }, 403);
  }

  // 3. 必須使用 JSON
  const contentType = request.headers.get("Content-Type") || "";

  if (!contentType.toLowerCase().startsWith("application/json")) {
    return jsonResponse({ error: "JSON required" }, 415);
  }

  // 4. 限制請求大小
  const bodyText = await request.text();

  if (encoder.encode(bodyText).length > 4096) {
    return jsonResponse({ error: "Request too large" }, 413);
  }

  // 5. 解析 JSON
  let body;

  try {
    body = JSON.parse(bodyText);
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }

  const { email, password } = body;

  // 6. 基本輸入驗證
  if (
    typeof email !== "string" ||
    typeof password !== "string" ||
    email.length > 254 ||
    password.length > 1024
  ) {
    return jsonResponse({ error: "Invalid credentials" }, 401);
  }

  const normalizedEmail = email.trim().toLowerCase();

  if (!normalizedEmail || !password) {
    return jsonResponse({ error: "Invalid credentials" }, 401);
  }

  // 7. 查詢管理員帳號
  let admin;

  try {
    admin = await env.DB.prepare(`
      SELECT
        id,
        email,
        display_name,
        password_hash,
        role,
        status
      FROM admin_users
      WHERE email = ?
      LIMIT 1
    `)
      .bind(normalizedEmail)
      .first();
  } catch (error) {
    console.error("Login database query failed", error);
    return jsonResponse({ error: "Login failed" }, 500);
  }

  // 不透露帳號是否存在
  if (!admin || admin.status !== "active") {
    return jsonResponse({ error: "Invalid credentials" }, 401);
  }

  // 8. 驗證密碼
  let passwordValid = false;

  try {
    passwordValid = await verifyPassword(
      password,
      admin.password_hash
    );
  } catch (error) {
    console.error("Password verification failed", error);
    return jsonResponse({ error: "Login failed" }, 500);
  }

  if (!passwordValid) {
    return jsonResponse({ error: "Invalid credentials" }, 401);
  }

  // 9. 建立 Session
  let session;

  try {
    session = await createSession(env, admin.id);
  } catch (error) {
    console.error("Session creation failed", error);
    return jsonResponse({ error: "Login failed" }, 500);
  }

  // 10. 回傳登入結果並設定安全 Cookie
  const response = jsonResponse(
    {
      success: true,
      admin: {
        id: admin.id,
        email: admin.email,
        displayName: admin.display_name,
        role: admin.role
      }
    },
    200
  );

  response.headers.set(
    "Set-Cookie",
    createSessionCookie(session.token, session.maxAge)
  );

  return response;
}
