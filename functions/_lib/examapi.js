// 模擬考題 API 的共用工具
import { jsonResponse } from "./auth.js";
import { canEditCourse } from "./pages.js";

export const parseJson = (s, fallback) => { try { return JSON.parse(s); } catch { return fallback; } };

// 讀一份考卷（含答案，只在伺服器使用）
export async function loadExam(env, id) {
  const n = Number(id);
  if (!Number.isInteger(n) || n < 1) return null;
  const row = await env.DB.prepare(`
    SELECT id, course_id, title, description, category, source, data, question_count, total_points,
           published, version, sort_order, updated_at
    FROM exams WHERE id = ?
  `).bind(n).first();
  if (!row) return null;
  return { ...row, parsed: parseJson(row.data, { questions: [], groups: [] }) };
}

// 同學能不能看這份考卷：已公開，或自己能管理這個科目
export async function canSeeExam(env, user, exam) {
  return Boolean(exam.published) || await canEditCourse(env, user, exam.course_id);
}

// 資料表還沒建立時，回傳看得懂的訊息
export function examDbError(error) {
  console.error("Exam DB error", error);
  if (/no such table/i.test(String(error?.message || error))) {
    return jsonResponse({ error: "模擬考題的資料庫還沒設定，請網站管理者先執行設定 SQL。" }, 500);
  }
  return jsonResponse({ error: "伺服器暫時無法處理，請稍後再試" }, 500);
}
