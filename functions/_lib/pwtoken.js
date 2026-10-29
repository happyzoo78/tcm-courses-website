// 密碼設定連結：產生、寄出、驗證
// 資料表 password_tokens（只存連結的雜湊值，資料庫外洩也無法拿來重設密碼）
import { sendMail } from "./mail.js";

const encoder = new TextEncoder();
export async function sha256Hex(value) {
  const d = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(new Uint8Array(d), b => b.toString(16).padStart(2, "0")).join("");
}
function randomToken() {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// purpose：reset＝同學自己按「忘記密碼」（30 分鐘有效）；invite＝管理者寄出的設定密碼信（3 天有效）
const LIFETIME = { reset: "+30 minutes", invite: "+3 days" };

export async function createAndSend(env, origin, user, purpose, ipHash) {
  const token = randomToken();
  await env.DB.prepare(`
    INSERT INTO password_tokens (user_id, token_hash, purpose, expires_at, ip_hash)
    VALUES (?, ?, ?, datetime('now', ?), ?)
  `).bind(user.id, await sha256Hex(token), purpose, LIFETIME[purpose], ipHash || null).run();

  const link = `${origin}/#reset/${token}`;
  const raw = user.display_name && user.display_name !== user.email ? user.display_name : "同學";
  const name = String(raw).replace(/[<>&"']/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[c]));
  const first = purpose === "invite" ? "網站管理者邀請你設定「2026福建中醫台灣班網站」的登入密碼。" : "我們收到你「忘記密碼」的申請。";
  const expire = purpose === "invite" ? "3 天" : "30 分鐘";
  const text = `${raw}你好：\n\n${first}\n請在 ${expire}內打開下面的連結，設定新密碼：\n${link}\n\n設定好之後，就可以用這個 Email＋新密碼登入網站。\n如果不是你本人申請，請直接忽略這封信，你的密碼不會改變。\n\n2026福建中醫台灣班網站`;
  const html = `<div style="font-family:sans-serif;line-height:1.8;color:#2b2f2a">
    <p>${name}你好：</p><p>${first}<br>請在 <b>${expire}</b>內按下面的按鈕，設定新密碼：</p>
    <p><a href="${link}" style="display:inline-block;padding:10px 18px;background:#3e6152;color:#fff;border-radius:6px;text-decoration:none">設定新密碼</a></p>
    <p style="font-size:13px;color:#666">按鈕沒反應的話，請複製這個網址到瀏覽器打開：<br>${link}</p>
    <p style="font-size:13px;color:#666">如果不是你本人申請，請直接忽略這封信，你的密碼不會改變。</p>
    <p>2026福建中醫台灣班網站</p></div>`;
  await sendMail(env, { to: user.email, subject: purpose === "invite" ? "設定你的登入密碼｜2026福建中醫台灣班網站" : "重設密碼｜2026福建中醫台灣班網站", text, html });
}
