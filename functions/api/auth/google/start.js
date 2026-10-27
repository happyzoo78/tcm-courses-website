// GET /api/auth/google/start
// 按下「使用 Google 帳號登入」後，先到這裡，再轉到 Google 的登入頁
import { GOOGLE_AUTH_URL, randomHex, oauthCookie, redirectUri, redirectHome } from "../../../_lib/oauth.js";

export async function onRequestGet({ request, env }) {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    return redirectHome(request, { login_error: "not_configured" });
  }

  const state = randomHex(16);   // 防止偽造的登入回應
  const nonce = randomHex(16);   // 防止身分資料被重複使用

  const url = new URL(GOOGLE_AUTH_URL);
  url.searchParams.set("client_id", env.GOOGLE_CLIENT_ID);
  url.searchParams.set("redirect_uri", redirectUri(request));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  url.searchParams.set("nonce", nonce);
  url.searchParams.set("prompt", "select_account");

  return new Response(null, {
    status: 302,
    headers: {
      Location: url.toString(),
      "Set-Cookie": oauthCookie(`${state}.${nonce}`),
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow"
    }
  });
}
