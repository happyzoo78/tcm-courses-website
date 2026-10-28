// GET /api/attempts/9：看一次作答的結果（本人，或該科目負責人）
// PUT /api/attempts/9：申論題自評分數（只有本人）
import { jsonResponse } from "../../_lib/auth.js";
import { requireAdmin, readJson } from "../../_lib/content.js";
import { applySelfScores } from "../../_lib/exam.js";
import { canEditCourse } from "../../_lib/pages.js";
import { loadExam, parseJson, examDbError } from "../../_lib/examapi.js";

async function loadAttempt(env, id) {
  const n = Number(id);
  if (!Number.isInteger(n) || n < 1) return null;
  return env.DB.prepare(`
    SELECT a.*, u.display_name FROM exam_attempts a LEFT JOIN admin_users u ON u.id = a.user_id WHERE a.id = ?
  `).bind(n).first();
}

export async function onRequestGet({ request, env, params }) {
  const auth = await requireAdmin(request, env, "read");
  if (auth.error) return auth.error;
  try {
    const a = await loadAttempt(env, params.id);
    if (!a) return jsonResponse({ error: "找不到這次作答" }, 404);
    const exam = await loadExam(env, a.exam_id);
    const mine = a.user_id === auth.admin.id;
    if (!exam || !(mine || await canEditCourse(env, auth.admin, exam.course_id))) return jsonResponse({ error: "找不到這次作答" }, 404);
    return jsonResponse({
      id: a.id, examId: exam.id, courseId: exam.course_id, title: exam.title, mine, name: a.display_name,
      score: a.score, maxScore: a.max_score, createdAt: a.created_at,
      oldVersion: a.exam_version !== exam.version,
      // 作答後才看得到答案與解析
      questions: exam.parsed.questions, groups: exam.parsed.groups,
      answers: parseJson(a.answers, {}), results: parseJson(a.results, {})
    });
  } catch (error) { return examDbError(error); }
}

export async function onRequestPut({ request, env, params }) {
  const auth = await requireAdmin(request, env, "read");
  if (auth.error) return auth.error;
  const body = await readJson(request);
  if (body.error) return body.error;
  try {
    const a = await loadAttempt(env, params.id);
    if (!a || a.user_id !== auth.admin.id) return jsonResponse({ error: "找不到這次作答" }, 404);
    const exam = await loadExam(env, a.exam_id);
    if (!exam) return jsonResponse({ error: "找不到這份考卷" }, 404);
    if (a.exam_version !== exam.version) return jsonResponse({ error: "考卷已經改版，舊的作答不能再自評。" }, 409);
    const results = parseJson(a.results, {});
    const score = applySelfScores(exam.parsed, results, body.body.selfScores);
    await env.DB.prepare("UPDATE exam_attempts SET results = ?, score = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(JSON.stringify(results), score, a.id).run();
    return jsonResponse({ success: true, score, results });
  } catch (error) { return examDbError(error); }
}
