// DELETE /api/admin/exams/5/attempts：清除這份考卷的所有作答紀錄（例如測試完）
import { jsonResponse } from "../../../../_lib/auth.js";
import { audit } from "../../../../_lib/content.js";
import { examAdminRequest, canEditCourse } from "../../../../_lib/examadmin.js";
import { loadExam, examDbError } from "../../../../_lib/examapi.js";

export async function onRequestDelete({ request, env, params }) {
  const req = await examAdminRequest(request, env, false);
  if (req.error) return req.error;
  try {
    const exam = await loadExam(env, params.id);
    if (!exam) return jsonResponse({ error: "找不到這份考卷" }, 404);
    if (!(await canEditCourse(env, req.user, exam.course_id))) return jsonResponse({ error: "你不是這個科目的負責人。" }, 403);
    const r = await env.DB.prepare("DELETE FROM exam_attempts WHERE exam_id = ?").bind(exam.id).run();
    await audit(env, req.user, "delete", "exam_attempts", exam.id, { title: exam.title, count: r.meta?.changes });
    return jsonResponse({ success: true, deleted: r.meta?.changes || 0 });
  } catch (error) { return examDbError(error); }
}
