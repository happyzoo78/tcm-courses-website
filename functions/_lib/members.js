// 成員管理的共用設定
export const MEMBER_ROLES = ["viewer", "editor"];   // 可指派給同學的權限：一般會員、編輯者
// 只用 Google 登入的成員沒有密碼；這個值永遠無法通過密碼驗證
export const NO_PASSWORD = "!google-only";

// 帳號密碼登入的密碼規則：12～128 字
export const MIN_PASSWORD = 12;   // 和 password.js 的最低長度一致
export function checkPassword(pw) {
  if (typeof pw !== "string") return "請輸入密碼";
  if (pw.length < MIN_PASSWORD) return `密碼至少要 ${MIN_PASSWORD} 個字`;
  if (pw.length > 128) return "密碼不可超過 128 個字";
  return null;
}
