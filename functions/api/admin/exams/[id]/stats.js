// GET /api/admin/exams/5/stats：全班作答統計（擁有者、管理員、該科目負責人）
// 題目統計只計算「目前版本」的作答；每位同學的分數列出所有版本
import { jsonResponse } from "../../../../_lib/auth.js";
import { examAdminRequest, canEditCourse } from "../../../../_lib/examadmin.js";
import { loadExam, parseJson, examDbError } from "../../../../_lib/examapi.js";

const pct = (a, b) => b ? Math.round(a / b * 1000) / 10 : 0;

export async function onRequestGet({ request, env, params }) {
  const req = await examAdminRequest(request, env, false);
  if (req.error) return req.error;
  try {
    const exam = await loadExam(env, params.id);
    if (!exam) return jsonResponse({ error: "找不到這份考卷" }, 404);
    if (!(await canEditCourse(env, req.user, exam.course_id))) return jsonResponse({ error: "你不是這個科目的負責人。" }, 403);

    const { results: rows } = await env.DB.prepare(`
      SELECT a.id, a.user_id, a.exam_version, a.score, a.max_score, a.answers, a.results, a.created_at, u.display_name
      FROM exam_attempts a LEFT JOIN admin_users u ON u.id = a.user_id
      WHERE a.exam_id = ? ORDER BY a.id
    `).bind(exam.id).all();

    const current = rows.filter(r => r.exam_version === exam.version);
    const scores = current.map(r => pct(r.score, r.max_score));
    const questions = exam.parsed.questions.map(q => {
      const s = { id: q.id, no: q.no, type: q.type, stem: q.stem.slice(0, 80), points: q.points, answered: 0, correct: 0, earned: 0, choices: {} };
      for (const r of current) {
        const res = parseJson(r.results, {})[q.id];
        const given = parseJson(r.answers, {})[q.id];
        if (!res) continue;
        s.answered++;
        if (res.correct) s.correct++;
        s.earned += res.earned || 0;
        if (q.type === "single" && given) s.choices[given] = (s.choices[given] || 0) + 1;
        if (q.type === "multi" && Array.isArray(given) && given.length) { const k = given.join(""); s.choices[k] = (s.choices[k] || 0) + 1; }
        if (q.type === "tf" && typeof given === "boolean") { const k = given ? "對" : "錯"; s.choices[k] = (s.choices[k] || 0) + 1; }
      }
      s.correctRate = q.type === "essay" ? null : pct(s.correct, s.answered);
      s.avgEarned = s.answered ? Math.round(s.earned / s.answered * 100) / 100 : 0;
      s.answer = q.type === "tf" ? (q.answer ? "對" : "錯") : Array.isArray(q.answer) ? q.answer.map(a => Array.isArray(a) ? a[0] : a).join(q.type === "fill" ? "；" : "") : (q.answer ?? "");
      return s;
    });

    const byUser = new Map();
    for (const r of rows) {
      const u = byUser.get(r.user_id) || { userId: r.user_id, name: r.display_name || "（已移除的成員）", attempts: 0, best: 0, latest: 0, latestAt: "", latestId: 0 };
      u.attempts++;
      const p = pct(r.score, r.max_score);
      u.best = Math.max(u.best, p);
      u.latest = p; u.latestAt = r.created_at; u.latestId = r.id;
      byUser.set(r.user_id, u);
    }

    return jsonResponse({
      id: exam.id, courseId: exam.course_id, title: exam.title, version: exam.version, totalPoints: exam.total_points,
      attempts: current.length, allAttempts: rows.length, students: new Set(current.map(r => r.user_id)).size,
      average: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length * 10) / 10 : null,
      highest: scores.length ? Math.max(...scores) : null, lowest: scores.length ? Math.min(...scores) : null,
      questions, studentList: [...byUser.values()].sort((a, b) => b.best - a.best)
    });
  } catch (error) { return examDbError(error); }
}
