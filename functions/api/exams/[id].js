// GET /api/exams/5：取得考卷題目（沒有答案）與自己的作答紀錄
import { jsonResponse } from "../../_lib/auth.js";
import { requireAdmin } from "../../_lib/content.js";
import { publicExam } from "../../_lib/exam.js";
import { canEditCourse } from "../../_lib/pages.js";
import { loadExam, canSeeExam, examDbError } from "../../_lib/examapi.js";

export async function onRequestGet({ request, env, params }) {
  const auth = await requireAdmin(request, env, "read");
  if (auth.error) return auth.error;
  try {
    const exam = await loadExam(env, params.id);
    if (!exam || !(await canSeeExam(env, auth.admin, exam))) return jsonResponse({ error: "找不到這份考卷" }, 404);
    const { results } = await env.DB.prepare(`
      SELECT id, score, max_score, exam_version, created_at FROM exam_attempts
      WHERE exam_id = ? AND user_id = ? ORDER BY id DESC LIMIT 50
    `).bind(exam.id, auth.admin.id).all();
    return jsonResponse({
      id: exam.id, courseId: exam.course_id, title: exam.title, description: exam.description, category: exam.category || "",
      published: Boolean(exam.published), version: exam.version, totalPoints: exam.total_points,
      canManage: await canEditCourse(env, auth.admin, exam.course_id),
      ...publicExam(exam.parsed),
      myAttempts: results.map(a => ({ id: a.id, score: a.score, maxScore: a.max_score, oldVersion: a.exam_version !== exam.version, createdAt: a.created_at }))
    });
  } catch (error) { return examDbError(error); }
}
