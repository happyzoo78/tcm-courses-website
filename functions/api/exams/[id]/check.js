// POST /api/exams/5/check：錯題練習（只批改自己某次作答答錯的題目，不留紀錄、不算進統計）
// 內容：{ "attemptId": 9, "answers": { "q2": "A", ... } }
import { jsonResponse } from "../../../_lib/auth.js";
import { requireAdmin, readJson } from "../../../_lib/content.js";
import { grade } from "../../../_lib/exam.js";
import { loadExam, canSeeExam, parseJson, examDbError } from "../../../_lib/examapi.js";

export async function onRequestPost({ request, env, params }) {
  const auth = await requireAdmin(request, env, "read");
  if (auth.error) return auth.error;
  const body = await readJson(request);
  if (body.error) return body.error;
  const { attemptId, answers } = body.body;
  if (!answers || typeof answers !== "object" || Array.isArray(answers)) return jsonResponse({ error: "作答資料格式不正確" }, 400);

  try {
    const exam = await loadExam(env, params.id);
    if (!exam || !(await canSeeExam(env, auth.admin, exam))) return jsonResponse({ error: "找不到這份考卷" }, 404);
    const a = await env.DB.prepare("SELECT id, user_id, exam_id, exam_version, results FROM exam_attempts WHERE id = ?")
      .bind(Number(attemptId) || 0).first();
    if (!a || a.user_id !== auth.admin.id || a.exam_id !== exam.id) return jsonResponse({ error: "找不到這次作答" }, 404);
    if (a.exam_version !== exam.version) return jsonResponse({ error: "考卷已經改版，請重新作答一次再練錯題。" }, 409);

    // 只開放這次作答「答錯」的客觀題
    const prev = parseJson(a.results, {});
    const wrong = new Set(exam.parsed.questions.filter(q => q.type !== "essay" && prev[q.id] && !prev[q.id].correct).map(q => q.id));
    const questions = exam.parsed.questions.filter(q => wrong.has(q.id));
    const subset = { questions, groups: exam.parsed.groups.filter(g => questions.some(q => q.group === g.id)) };
    const g = grade(subset, answers);
    return jsonResponse({ score: g.score, maxScore: g.maxScore, results: g.results, given: g.given, questions: subset.questions, groups: subset.groups });
  } catch (error) { return examDbError(error); }
}
