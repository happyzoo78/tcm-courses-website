// GET /api/auth/google/callback
// Google 登入完成後跳回這裡：確認身分 → 檢查是否在成員名單 → 建立登入狀態
import { createSessionCookie } from "../../../_lib/auth.js";
import { createSession } from "../../../_lib/session.js";
import {
  OAUTH_COOKIE, GOOGLE_TOKEN_URL, getCookie, oauthCookie,
  redirectUri, redirectHome, decodeJwtPayload
} from "../../../_lib/oauth.js";

const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

function fail(request, code, extra = {}) {
  const res = redirectHome(request, { login_error: code, ...extra });
  res.headers.append("Set-Cookie", oauthCookie("", 0)); // 清除暫存驗證碼
  return res;
}

export async function onRequestGet({ request, env }) {
  if (!env.DB || !env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    return fail(request, "not_configured");
  }

  const url = new URL(request.url);

  // 使用者在 Google 頁面按了取消
  if (url.searchParams.get("error")) return fail(request, "cancelled");

  // 1. 確認這次回應確實對應本站剛才發出的登入請求
  const saved = getCookie(request, OAUTH_COOKIE) || "";
  const [savedState, savedNonce] = saved.split(".");
  const state = url.searchParams.get("state") || "";
  const code = url.searchParams.get("code") || "";

  if (!savedState || !savedNonce || state !== savedState || !code) {
    return fail(request, "expired");
  }

  // 2. 用一次性代碼向 Google 換取身分資料
  let idToken;
  try {
    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        redirect_uri: redirectUri(request),
        grant_type: "authorization_code"
      })
    });
    if (!tokenRes.ok) {
      console.error("Google token exchange failed", tokenRes.status, await tokenRes.text());
      return fail(request, "google");
    }
    idToken = (await tokenRes.json()).id_token;
  } catch (error) {
    console.error("Google token request error", error);
    return fail(request, "google");
  }

  // 3. 檢查身分資料（直接從 Google 伺服器取得，再逐項核對）
  let claims;
  try {
    claims = decodeJwtPayload(idToken);
  } catch {
    return fail(request, "google");
  }

  const audOk = claims.aud === env.GOOGLE_CLIENT_ID ||
    (Array.isArray(claims.aud) && claims.aud.includes(env.GOOGLE_CLIENT_ID));

  if (
    !audOk ||
    !GOOGLE_ISSUERS.includes(claims.iss) ||
    !(Number(claims.exp) * 1000 > Date.now()) ||
    claims.nonce !== savedNonce ||
    typeof claims.email !== "string" ||
    !(claims.email_verified === true || claims.email_verified === "true")
  ) {
    return fail(request, "google");
  }

  const email = claims.email.trim().toLowerCase();

  // 4. 只有成員名單上、且未停用的帳號才能登入
  let user;
  try {
    user = await env.DB.prepare(`
      SELECT id, email, display_name, role, status
      FROM admin_users
      WHERE email = ?
      LIMIT 1
    `).bind(email).first();
  } catch (error) {
    console.error("Member lookup failed", error);
    return fail(request, "server");
  }

  if (!user) return fail(request, "not_allowed", { email });
  if (user.status !== "active") return fail(request, "suspended", { email });

  // 5. 建立登入狀態（與密碼登入相同的機制）
  let session;
  try {
    session = await createSession(env, user.id);
  } catch (error) {
    console.error("Session creation failed", error);
    return fail(request, "server");
  }

  try {
    // 名稱若還是 Email（管理者加入時沒填），就換成 Google 帳號的名字
    const googleName = typeof claims.name === "string" ? claims.name.trim().slice(0, 100) : "";
    await env.DB.batch([
      env.DB.prepare(`
        UPDATE admin_users
        SET last_login_at = CURRENT_TIMESTAMP,
            display_name = CASE WHEN display_name = email AND ? <> '' THEN ? ELSE display_name END
        WHERE id = ?
      `).bind(googleName, googleName, user.id),
      env.DB.prepare(`
        INSERT INTO admin_audit_logs (actor_user_id, action, resource_type, resource_id)
        VALUES (?, 'login_google', 'session', ?)
      `).bind(user.id, String(user.id))
    ]);
  } catch (error) {
    console.error("Post-login bookkeeping failed", error);
  }

  const res = redirectHome(request, { login: "ok" });
  res.headers.append("Set-Cookie", createSessionCookie(session.token, session.maxAge));
  res.headers.append("Set-Cookie", oauthCookie("", 0));
  return res;
}
