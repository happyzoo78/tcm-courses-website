// POST /api/logout
// 登出：讓伺服器端的登入紀錄失效，並清除瀏覽器的登入 Cookie
import { jsonResponse, clearSessionCookie } from "../_lib/auth.js";
import { revokeSession } from "../_lib/session.js";

export async function onRequestPost({ request, env }) {
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) {
    return jsonResponse({ error: "Forbidden" }, 403);
  }

  if (env.DB) {
    try {
      await revokeSession(request, env);
    } catch (error) {
      console.error("Logout failed", error);
    }
  }

  const response = jsonResponse({ success: true });
  response.headers.set("Set-Cookie", clearSessionCookie());
  return response;
}
