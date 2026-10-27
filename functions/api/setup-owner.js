
import { jsonResponse } from "../_lib/auth.js";
import { hashPassword } from "../_lib/password.js";

const encoder = new TextEncoder();

function secureEqual(a, b) {
  const left = encoder.encode(a);
  const right = encoder.encode(b);

  if (left.length !== right.length) return false;

  let difference = 0;
  for (let i = 0; i < left.length; i++) {
    difference |= left[i] ^ right[i];
  }

  return difference === 0;
}

export async function onRequestPost({ request, env }) {
  // 預設關閉：需明確啟用初始化功能。
  if (env.OWNER_SETUP_ENABLED !== "true") {
    return jsonResponse({ error: "Not found" }, 404);
  }

  if (!env.DB || !env.OWNER_SETUP_SECRET) {
    return jsonResponse({ error: "Service unavailable" }, 503);
  }

  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) {
    return jsonResponse({ error: "Forbidden" }, 403);
  }

  if (!request.headers.get("Content-Type")?.toLowerCase()
    .startsWith("application/json")) {
    return jsonResponse({ error: "JSON required" }, 415);
  }

  const bodyText = await request.text();
  if (encoder.encode(bodyText).length > 4096) {
    return jsonResponse({ error: "Request too large" }, 413);
  }

  let body;
  try {
    body = JSON.parse(bodyText);
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }

  const { setupSecret, email, displayName, password } = body;

  if (
    typeof setupSecret !== "string" ||
    !secureEqual(setupSecret, env.OWNER_SETUP_SECRET)
  ) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  if (
    typeof email !== "string" ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    email.length > 254 ||
    typeof displayName !== "string" ||
    displayName.trim().length < 1 ||
    displayName.length > 100
  ) {
    return jsonResponse({ error: "Invalid account details" }, 400);
  }

    if (
    typeof password !== "string" ||
    password.length < 12 ||
    encoder.encode(password).length > 1024
  ) {
    return jsonResponse({ error: "Invalid password" }, 400);
  }

  let passwordHash;
  try {
    passwordHash = await hashPassword(password);
  } catch (error) {
    console.error("Password hashing failed", {
      name: error?.name || "UnknownError"
    });

    return jsonResponse(
      { error: "Password hashing failed" },
      500
    );
  }

  try {
    // 使用單一 SQL 陳述式執行條件式插入。
    const result = await env.DB.prepare(`
      INSERT INTO admin_users
        (email, display_name, password_hash, role, status)
      SELECT ?, ?, ?, 'owner', 'active'
      WHERE NOT EXISTS (SELECT 1 FROM admin_users)
    `).bind(
      email.trim().toLowerCase(),
      displayName.trim(),
      passwordHash
    ).run();

    if (result.meta?.changes !== 1) {
      return jsonResponse({ error: "Already initialized" }, 409);
    }

    return jsonResponse({ success: true }, 201);
  } catch (error) {
    console.error("Owner initialization failed", error);
    return jsonResponse({ error: "Initialization failed" }, 500);
  }
}
