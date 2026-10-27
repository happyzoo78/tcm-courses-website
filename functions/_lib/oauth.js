// Google 登入的共用工具
export const OAUTH_COOKIE = "__Host-tcm_oauth";
export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

export function randomHex(bytes = 32) {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), b =>
    b.toString(16).padStart(2, "0")
  ).join("");
}

export function getCookie(request, name) {
  const header = request.headers.get("Cookie") || "";
  for (const part of header.split(";")) {
    const c = part.trim();
    if (c.startsWith(name + "=")) return decodeURIComponent(c.slice(name.length + 1));
  }
  return null;
}

// 暫存「這次登入的驗證碼」用的 Cookie（10 分鐘內有效）
// 必須用 SameSite=Lax：從 Google 跳回本站時，瀏覽器才會帶上它
export function oauthCookie(value, maxAge = 600) {
  return [
    `${OAUTH_COOKIE}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    `Max-Age=${maxAge}`
  ].join("; ");
}

export function redirectUri(request) {
  return new URL("/api/auth/google/callback", request.url).toString();
}

// 跳轉回網站首頁（可附帶錯誤代碼）
export function redirectHome(request, params = {}) {
  const url = new URL("/", request.url);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new Response(null, {
    status: 302,
    headers: {
      Location: url.pathname + url.search,
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow"
    }
  });
}

// 解讀 Google 回傳的身分資料（JWT 的中間段）
export function decodeJwtPayload(jwt) {
  const part = String(jwt || "").split(".")[1];
  if (!part) throw new Error("Invalid token");
  const b64 = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}
