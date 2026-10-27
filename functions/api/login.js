import {
  jsonResponse,
  createSessionCookie
} from "../_lib/auth.js";

import { verifyPassword } from "../_lib/password.js";
import { createSession } from "../_lib/session.js";

const encoder = new TextEncoder();

// 登入失敗次數限制（防止有人一直猜密碼）
const WINDOW_MINUTES = 15;          // 計算期間：15 分鐘
const MAX_FAILS_PER_ACCOUNT = 5;    // 同一個 Email 最多失敗 5 次
const MAX_FAILS_PER_IP = 20;        // 同一個網路位置最多失敗 20 次

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
}

// 記錄一次登入嘗試（記錄失敗不影響登入流程）
async function recordAttempt(env, identifierHash, ipHash, success) {
  try {
    await env.DB.prepare(`
      INSERT INTO admin_login_attempts (identifier_hash, ip_hash, success)
      VALUES (?, ?, ?)
    `).bind(identifierHash, ipHash, success ? 1 : 0).run();
  } catch (error) {
    console.error("Login attempt logging failed", error);
  }
}

// 檢查是否已超過失敗次數上限
async function isRateLimited(env, identifierHash, ipHash) {
  const since = `-${WINDOW_MINUTES} minutes`;

  // 同一個 Email：只計算「最近一次成功登入之後」的失敗
  const account = await env.DB.prepare(`
    SELECT COUNT(*) AS fails
    FROM admin_login_attempts
    WHERE identifier_hash = ?
      AND success = 0
      AND attempted_at > datetime('now', ?)
      AND id > COALESCE((
        SELECT MAX(id) FROM admin_login_attempts
        WHERE identifier_hash = ? AND success = 1
      ), 0)
  `).bind(identifierHash, since, identifierHash).first();

  if ((account?.fails || 0) >= MAX_FAILS_PER_ACCOUNT) return true;

  if (ipHash) {
    const ip = await env.DB.prepare(`
      SELECT COUNT(*) AS fails
      FROM admin_login_attempts
      WHERE ip_hash = ?
        AND success = 0
        AND attempted_at > datetime('now', ?)
    `).bind(ipHash, since).first();

    if ((ip?.fails || 0) >= MAX_FAILS_PER_IP) return true;
  }

  return false;
}

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

  // 7. 檢查失敗次數（在耗時的密碼運算之前就擋下）
  const identifierHash = await sha256Hex(`login:${normalizedEmail}`);
  const clientIp = request.headers.get("CF-Connecting-IP") || "";
  const ipHash = clientIp ? await sha256Hex(`ip:${clientIp}`) : null;

  try {
    if (await isRateLimited(env, identifierHash, ipHash)) {
      const response = jsonResponse({ error: "Too many attempts" }, 429);
      response.headers.set("Retry-After", String(WINDOW_MINUTES * 60));
      return response;
    }
  } catch (error) {
    console.error("Rate limit check failed", error);
    return jsonResponse({ error: "Login failed" }, 500);
  }

  // 8. 查詢管理員帳號
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
    await recordAttempt(env, identifierHash, ipHash, false);
    return jsonResponse({ error: "Invalid credentials" }, 401);
  }

  // 9. 驗證密碼
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
    await recordAttempt(env, identifierHash, ipHash, false);
    return jsonResponse({ error: "Invalid credentials" }, 401);
  }

  // 10. 建立 Session
  let session;

  try {
    session = await createSession(env, admin.id);
  } catch (error) {
    console.error("Session creation failed", error);
    return jsonResponse({ error: "Login failed" }, 500);
  }

  // 11. 記錄成功登入、更新最後登入時間、清除 30 天前的舊紀錄
  await recordAttempt(env, identifierHash, ipHash, true);

  try {
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE admin_users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?"
      ).bind(admin.id),
      env.DB.prepare(
        "DELETE FROM admin_login_attempts WHERE attempted_at < datetime('now', '-30 days')"
      )
    ]);
  } catch (error) {
    console.error("Post-login bookkeeping failed", error);
  }

  // 12. 回傳登入結果並設定安全 Cookie
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
