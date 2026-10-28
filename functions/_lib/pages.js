// 網頁（上傳的 HTML）與科目負責人的共用工具
import { hasPermission } from "./session.js";

export const MAX_PAGE_BYTES = 1_900_000;   // 資料庫單筆上限 2 MB，留一點空間

// 擁有者、管理員可以管理所有科目
export const canManageAll = user => hasPermission(user, "publish");

// 這位使用者負責哪些科目
export async function ownedCourseIds(env, user) {
  if (!user) return [];
  const { results } = await env.DB.prepare(
    "SELECT course_id FROM course_owners WHERE user_id = ?"
  ).bind(user.id).all();
  return results.map(r => r.course_id);
}

// 能否編輯某個科目裡的網頁：擁有者、管理員，或該科目的負責人
export async function canEditCourse(env, user, courseId) {
  if (!user || user.status !== "active") return false;
  if (canManageAll(user)) return true;
  const row = await env.DB.prepare(
    "SELECT 1 AS ok FROM course_owners WHERE course_id = ? AND user_id = ?"
  ).bind(courseId, user.id).first();
  return Boolean(row);
}

// 從 HTML 的 <title> 抓出標題（使用者沒填標題時用）
export function titleFromHtml(html) {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html || "");
  if (!m) return "";
  return m[1].replace(/\s+/g, " ").replace(/｜.*$/, "").trim().slice(0, 200);
}
