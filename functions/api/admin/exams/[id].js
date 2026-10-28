// GET    /api/admin/exams/5：讀取考卷原始文字（編輯用）
// PUT    /api/admin/exams/5：修改考卷（改了題目會變成新版本，題目統計重新計算）
// DELETE /api/admin/exams/5：刪除考卷與所有作答紀錄
import { jsonResponse } from "../../../_lib/auth.js";
import { audit } from "../../../_lib/content.js";
import { examAdminRequest, cleanExam, badRequest, canEditCourse } from "../../../_lib/examadmin.js";
import { loadExam, examDbError } from "../../../_lib/examapi.js";

async function guard(request, env, params, needBody) {
  const req = await examAdminRequest(request, env, needBody);
  if (req.error) return req;
  const exam = await loadExam(env, params.id);
  if (!exam) return { error: jsonResponse({ error: "找不到這份考卷" }, 404) };
  if (!(await canEditCourse(env, req.user, exam.course_id))) return { error: jsonResponse({ error: "你不是這個科目的負責人。" }, 403) };
  return { ...req, exam };
}

export async function onRequestGet({ request, env, params }) {
  try {
    const g = await guard(request, env, params, false);
    if (g.error) return g.error;
    const { exam } = g;
    return jsonResponse({ id: exam.id, courseId: exam.course_id, title: exam.title, description: exam.description, category: exam.category || "",
      source: exam.source, published: Boolean(exam.published), version: exam.version, sortOrder: exam.sort_order });
  } catch (error) { return examDbError(error); }
}

export async function onRequestPut({ request, env, params }) {
  try {
    const g = await guard(request, env, params, true);
    if (g.error) return g.error;
    const { exam, user, body } = g;
    let v;
    try { v = cleanExam(body, { requireAll: false }); } catch (e) { return badRequest(e); }
    const changed = "source" in v && v.source !== exam.source;
    if ("source" in v && !changed) { delete v.source; delete v.data; delete v.question_count; delete v.total_points; }
    const cols = Object.keys(v);
    if (!cols.length) return jsonResponse({ success: true, version: exam.version });
    await env.DB.prepare(`
      UPDATE exams SET ${cols.map(c => `${c} = ?`).join(", ")}${changed ? ", version = version + 1" : ""},
        updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).bind(...cols.map(c => v[c]), user.id, exam.id).run();
    await audit(env, user, "update", "exam", exam.id, { title: v.title || exam.title, newVersion: changed });
    return jsonResponse({ success: true, version: exam.version + (changed ? 1 : 0) });
  } catch (error) { return examDbError(error); }
}

export async function onRequestDelete({ request, env, params }) {
  try {
    const g = await guard(request, env, params, false);
    if (g.error) return g.error;
    const { exam, user } = g;
    await env.DB.batch([
      env.DB.prepare("DELETE FROM exam_attempts WHERE exam_id = ?").bind(exam.id),
      env.DB.prepare("DELETE FROM exams WHERE id = ?").bind(exam.id)
    ]);
    await audit(env, user, "delete", "exam", exam.id, { title: exam.title });
    return jsonResponse({ success: true });
  } catch (error) { return examDbError(error); }
}
