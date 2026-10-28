// POST /api/exams/5/attempts：交卷，伺服器批改後回傳成績、正確答案與解析
import { jsonResponse } from "../../../_lib/auth.js";
import { requireAdmin, readJson } from "../../../_lib/content.js";
import { grade } from "../../../_lib/exam.js";
import { loadExam, canSeeExam, examDbError } from "../../../_lib/examapi.js";

export async function onRequestPost({ request, env, params }) {
  const auth = await requireAdmin(request, env, "read");
  if (auth.error) return auth.error;
  const parsedBody = await readJson(request);
  if (parsedBody.error) return parsedBody.error;
  const answers = parsedBody.body.answers;
  if (!answers || typeof answers !== "object" || Array.isArray(answers)) return jsonResponse({ error: "作答資料格式不正確" }, 400);

  try {
    const exam = await loadExam(env, params.id);
    if (!exam || !(await canSeeExam(env, auth.admin, exam))) return jsonResponse({ error: "找不到這份考卷" }, 404);
    const g = grade(exam.parsed, answers);
    const r = await env.DB.prepare(`
      INSERT INTO exam_attempts (exam_id, user_id, exam_version, score, max_score, answers, results)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(exam.id, auth.admin.id, exam.version, g.score, g.maxScore, JSON.stringify(g.given), JSON.stringify(g.results)).run();
    return jsonResponse({ success: true, attemptId: r.meta?.last_row_id }, 201);
  } catch (error) { return examDbError(error); }
}
