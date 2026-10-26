
const encoder = new TextEncoder();

const COOKIE_NAME = "__Host-tcm_session";

const ROLE_PERMISSIONS = {
  owner: [
    "read",
    "write",
    "publish",
    "manage_users",
    "manage_system"
  ],
  admin: [
    "read",
    "write",
    "publish",
    "manage_editors"
  ],
  editor: [
    "read",
    "write"
  ],
  viewer: [
    "read"
  ]
};

function getSessionToken(request) {
  const cookieHeader = request.headers.get("Cookie") || "";

  for (const part of cookieHeader.split(";")) {
    const cookie = part.trim();
    if (cookie.startsWith(`${COOKIE_NAME}=`)) {
      const token = cookie.slice(COOKIE_NAME.length + 1);
      return /^[a-f0-9]{64}$/i.test(token) ? token : null;
    }
  }

  return null;
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(value)
  );

  return Array.from(new Uint8Array(digest), byte =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

export async function getCurrentAdmin(request, env) {
  if (!env.DB) {
    throw new Error("D1 binding is missing");
  }

  const token = getSessionToken(request);
  if (!token) return null;

  const tokenHash = await sha256Hex(token);

  const admin = await env.DB.prepare(`
    SELECT
      u.id,
      u.email,
      u.display_name,
      u.role,
      u.status,
      s.id AS session_id
    FROM admin_sessions AS s
    JOIN admin_users AS u ON u.id = s.user_id
    WHERE s.token_hash = ?
      AND s.revoked_at IS NULL
      AND s.expires_at > CURRENT_TIMESTAMP
      AND u.status = 'active'
    LIMIT 1
  `).bind(tokenHash).first();

  return admin || null;
}

export function hasPermission(admin, permission) {
  if (!admin || admin.status !== "active") {
    return false;
  }

  return (
    ROLE_PERMISSIONS[admin.role] || []
  ).includes(permission);
}

export function hasRole(admin, allowedRoles) {
  return Boolean(
    admin &&
    admin.status === "active" &&
    allowedRoles.includes(admin.role)
  );
}

export async function createSession(env, userId) {
  if (!env.DB) {
    throw new Error("D1 binding is missing");
  }

  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = Array.from(bytes, byte =>
    byte.toString(16).padStart(2, "0")
  ).join("");

  const tokenHash = await sha256Hex(token);

  const expiresAt = new Date(
    Date.now() + 8 * 60 * 60 * 1000
  ).toISOString().replace("T", " ").slice(0, 19);

  await env.DB.prepare(`
    INSERT INTO admin_sessions
      (user_id, token_hash, expires_at)
    VALUES (?, ?, ?)
  `).bind(userId, tokenHash, expiresAt).run();

  return {
    token,
    maxAge: 8 * 60 * 60
  };
}

export async function revokeSession(request, env) {
  const token = getSessionToken(request);
  if (!token) return;

  const tokenHash = await sha256Hex(token);

  await env.DB.prepare(`
    UPDATE admin_sessions
    SET revoked_at = CURRENT_TIMESTAMP
    WHERE token_hash = ?
      AND revoked_at IS NULL
  `).bind(tokenHash).run();
}
