// POST /api/contact：登入的成員寫信給網站管理者（寄到所有「擁有者」的信箱）
// 內容：{ "subject": "主旨（選填）", "message": "內容" }
// 管理者在信箱按「回覆」，會直接回到寫信同學的 Email
import { jsonResponse } from "../_lib/auth.js";
import { requireAdmin, readJson } from "../_lib/content.js";
import { mailConfigured, sendMail } from "../_lib/mail.js";

export const MAX_SUBJECT = 60;
export const MAX_MESSAGE = 2000;
const PER_HOUR = 5;   // 每人每小時最多寄 5 封，避免洗信把每天 300 封的額度用完
const PER_DAY = 15;

const clean = (v, keepNewlines) => String(v ?? "")
  .replace(keepNewlines ? /[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f]/g : /[\u0000-\u001f\u007f]/g, "")
  .trim();
const esc = s => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export async function onRequestPost({ request, env }) {
  const auth = await requireAdmin(request, env, "read");
  if (auth.error) return auth.error;
  const me = auth.admin;

  if (!mailConfigured(env)) return jsonResponse({ error: "網站目前還不能寄信，請改用其他方式聯絡管理者" }, 503);

  const parsed = await readJson(request);
  if (parsed.error) return parsed.error;
  const subject = clean(parsed.body.subject);
  const message = clean(parsed.body.message, true).replace(/\r\n?/g, "\n");
  if ([...message].length < 5) return jsonResponse({ error: "請寫下你想說的內容（至少 5 個字）" }, 400);
  if ([...message].length > MAX_MESSAGE) return jsonResponse({ error: `內容不可超過 ${MAX_MESSAGE} 字` }, 400);
  if ([...subject].length > MAX_SUBJECT) return jsonResponse({ error: `主旨不可超過 ${MAX_SUBJECT} 字` }, 400);

  try {
    const c = await env.DB.prepare(`
      SELECT
        SUM(CASE WHEN created_at > datetime('now', '-1 hour') THEN 1 ELSE 0 END) AS h,
        COUNT(*) AS d
      FROM admin_audit_logs
      WHERE actor_user_id = ? AND action = 'contact' AND created_at > datetime('now', '-1 day')
    `).bind(me.id).first();
    if ((c?.h || 0) >= PER_HOUR || (c?.d || 0) >= PER_DAY) {
      return jsonResponse({ error: "寄得太頻繁了，請稍後再試" }, 429);
    }
  } catch (error) { console.error("Contact rate check failed", error); }

  const owners = await env.DB.prepare("SELECT email FROM admin_users WHERE role = 'owner' AND status = 'active'").all();
  const to = (owners.results || []).map(r => r.email).filter(Boolean);
  if (!to.length) return jsonResponse({ error: "找不到網站管理者的信箱" }, 500);

  const name = me.display_name || me.email;
  const title = `【網站聯絡】${name}：${subject || "（無主旨）"}`;
  const text = `${name}（${me.email}）透過網站寫信給你：\n\n${subject ? `主旨：${subject}\n\n` : ""}${message}\n\n——\n直接按「回覆」就會寄給 ${me.email}。`;
  const html = `<div style="font-family:sans-serif;line-height:1.7;color:#2b2f2a">
    <p><b>${esc(name)}</b>（${esc(me.email)}）透過網站寫信給你：</p>
    ${subject ? `<p><b>主旨：</b>${esc(subject)}</p>` : ""}
    <div style="white-space:pre-wrap;border-left:3px solid #3d5e50;padding:8px 12px;background:#f3ede1">${esc(message)}</div>
    <p style="color:#5f5a4c;font-size:14px">直接按「回覆」就會寄給 ${esc(me.email)}。</p></div>`;

  try {
    await sendMail(env, { to, subject: title, text, html, replyTo: { email: me.email, name } });
  } catch (error) {
    console.error("Contact mail failed", error);
    return jsonResponse({ error: "寄送失敗，請稍後再試" }, 502);
  }

  try {
    await env.DB.prepare("INSERT INTO admin_audit_logs (actor_user_id, action, resource_type, resource_id, details) VALUES (?, 'contact', 'contact', ?, ?)")
      .bind(me.id, String(me.id), JSON.stringify({ subject: subject.slice(0, 60), length: [...message].length })).run();
  } catch (error) { console.error("Contact audit failed", error); }

  return jsonResponse({ success: true });
}
