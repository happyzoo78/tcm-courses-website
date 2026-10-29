// GET /api/summary：唯讀檢查用的清單（不用登入）
// 擁有者 2026-10-29 同意公開這些「不敏感」的資訊，方便 Claude 核對上傳結果：
//   學期、科目名稱、各科圖卡數量、試題的名稱／分類／排序／題數／總分／是否公開／更新時間
// 不含：題目、答案、解析、圖卡內容、成員、作答紀錄
// 想關閉時，在 Cloudflare 環境變數加 SUMMARY_DISABLED=true（或刪除這個檔案）
import { jsonResponse } from "../_lib/auth.js";

export async function onRequestGet({ env }) {
  if (!env.DB) return jsonResponse({ error: "Service unavailable" }, 503);
  if (String(env.SUMMARY_DISABLED || "").toLowerCase() === "true") return jsonResponse({ error: "已關閉" }, 404);
  try {
    const [sem, courses, items] = await env.DB.batch([
      env.DB.prepare("SELECT code, label, visible FROM semesters ORDER BY sort_order"),
      env.DB.prepare("SELECT id, title, semester_code FROM courses ORDER BY id"),
      env.DB.prepare("SELECT course_id, COUNT(*) AS n FROM items GROUP BY course_id")
    ]);
    let exams = [];
    try {
      const r = await env.DB.prepare(`
        SELECT id, course_id, title, category, sort_order, question_count, total_points, published, version, updated_at
        FROM exams ORDER BY course_id, sort_order, id`).all();
      exams = r.results.map(e => ({ id: e.id, courseId: e.course_id, title: e.title, category: e.category || "",
        sortOrder: e.sort_order, questionCount: e.question_count, totalPoints: e.total_points,
        published: Boolean(e.published), version: e.version, updatedAt: e.updated_at }));
    } catch {}
    const itemCount = Object.fromEntries((items.results || []).map(r => [r.course_id, r.n]));
    const res = jsonResponse({
      generatedAt: new Date().toISOString(),
      semesters: sem.results.map(s => ({ code: s.code, label: s.label, visible: Boolean(s.visible) })),
      courses: courses.results.map(c => ({ id: c.id, title: c.title, semester: c.semester_code, cards: itemCount[c.id] || 0,
        exams: exams.filter(e => e.courseId === c.id).length })),
      exams
    });
    return res;
  } catch (error) {
    console.error("Summary failed", error);
    return jsonResponse({ error: "讀取失敗" }, 500);
  }
}
