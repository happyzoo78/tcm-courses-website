// 自動寄「設定密碼」信：加入名單超過 1 小時、還沒登入過、也沒有密碼的成員，自動寄一次
// Cloudflare Pages 沒有排程功能，所以借用成員打開網站時的 /api/me 順便檢查（每個伺服器執行個體每 10 分鐘最多檢查一次）
// 只處理 7 天內加入的成員（避免一上線就寄給很久以前加入的人）；寄過任何設定／重設密碼信的人不會再寄
import { mailConfigured } from "./mail.js";
import { createAndSend } from "./pwtoken.js";
import { NO_PASSWORD } from "./members.js";

const EVERY_MS = 10 * 60 * 1000;
const PER_RUN = 5;
let lastRun = 0;

export function maybeAutoInvite(env, origin, waitUntil) {
  if (!env.DB || !mailConfigured(env)) return;
  const now = Date.now();
  if (now - lastRun < EVERY_MS) return;
  lastRun = now;
  const job = run(env, origin).catch(error => console.error("Auto invite failed", error));
  if (typeof waitUntil === "function") waitUntil(job);
}

async function run(env, origin) {
  let rows;
  try {
    ({ results: rows } = await env.DB.prepare(`
      SELECT u.id, u.email, u.display_name FROM admin_users u
      WHERE u.status = 'active' AND u.role != 'owner'
        AND u.last_login_at IS NULL
        AND (u.password_hash IS NULL OR u.password_hash = '' OR u.password_hash = ?)
        AND u.created_at < datetime('now', '-1 hour')
        AND u.created_at > datetime('now', '-7 days')
        AND NOT EXISTS (SELECT 1 FROM password_tokens t WHERE t.user_id = u.id)
      ORDER BY u.id LIMIT ${PER_RUN}
    `).bind(NO_PASSWORD).all());
  } catch (error) {
    if (/no such table/i.test(String(error))) return;   // 還沒建立 password_tokens
    throw error;
  }
  for (const u of rows || []) {
    // 寄之前再確認一次，降低兩個執行個體同時寄出的機會
    const again = await env.DB.prepare("SELECT 1 AS x FROM password_tokens WHERE user_id = ?").bind(u.id).first();
    if (again) continue;
    try {
      await createAndSend(env, origin, u, "invite", null, { auto: true });
      try {
        await env.DB.prepare("INSERT INTO admin_audit_logs (actor_user_id, action, resource_type, resource_id, details) VALUES (NULL, 'auto_invite', 'member', ?, NULL)").bind(String(u.id)).run();
      } catch {}
    } catch (error) { console.error("Auto invite mail failed", u.id, error); }
  }
}
