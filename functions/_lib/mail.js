// 寄信（忘記密碼、設定密碼連結）：使用 Brevo 的免費寄信服務（每天 300 封）
// 需要在 Cloudflare Pages 的「設定 → 變數和密碼」加上：
//   BREVO_API_KEY  Brevo 的 API 金鑰（請設為「密碼／加密」類型，不要讓別人看到）
//   MAIL_FROM      寄件人 Email（必須先在 Brevo 驗證過，例如網站擁有者的信箱）
// 沒設定時，網站照常運作，只是不能寄信（會提示同學找管理者重設密碼）

export const mailConfigured = env => Boolean(env.BREVO_API_KEY && env.MAIL_FROM);

// to 可以是一個 Email 或 Email 陣列；replyTo（選填）＝收件人按「回覆」時寄到哪裡
export async function sendMail(env, { to, subject, text, html, replyTo }) {
  if (!mailConfigured(env)) throw new Error("mail not configured");
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": env.BREVO_API_KEY, "Content-Type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      sender: { email: env.MAIL_FROM, name: "2026福建中醫台灣班網站" },
      to: (Array.isArray(to) ? to : [to]).map(email => ({ email })),
      ...(replyTo ? { replyTo } : {}),
      subject, textContent: text, htmlContent: html
    })
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Brevo ${res.status}: ${detail.slice(0, 200)}`);
  }
}
