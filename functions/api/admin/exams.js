// POST /api/admin/exams：新增一份模擬考卷（擁有者、管理員、該科目負責人）
import { jsonResponse } from "../../_lib/auth.js";
import { audit } from "../../_lib/content.js";
import { examAdminRequest, cleanExam, badRequest, canEditCourse } from "../../_lib/examadmin.js";
import { examDbError } from "../../_lib/examapi.js";

export async function onRequestPost({ request, env }) {
  const req = await examAdminRequest(request, env);
  if (req.error) return req.error;
  const { user, body } = req;
  const courseId = Number(body.courseId);
  if (!Number.isInteger(courseId) || courseId < 1) return jsonResponse({ error: "請選擇科目" }, 400);
  const course = await env.DB.prepare("SELECT id, title FROM courses WHERE id = ?").bind(courseId).first();
  if (!course) return jsonResponse({ error: "科目不存在" }, 400);
  if (!(await canEditCourse(env, user, courseId))) return jsonResponse({ error: "你不是這個科目的負責人，不能新增考卷。" }, 403);

  let v;
  try { v = cleanExam(body, { requireAll: true }); } catch (e) { return badRequest(e); }
  try {
    const max = await env.DB.prepare("SELECT COALESCE(MAX(sort_order), 0) AS m FROM exams WHERE course_id = ?").bind(courseId).first();
    const r = await env.DB.prepare(`
      INSERT INTO exams (course_id, title, description, category, source, data, question_count, total_points, published, sort_order, created_by, updated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(courseId, v.title, v.description || "", v.category || "", v.source, v.data, v.question_count, v.total_points,
            v.published ?? 0, v.sort_order ?? ((max?.m || 0) + 10), user.id, user.id).run();
    const id = r.meta?.last_row_id;
    await audit(env, user, "create", "exam", id, { title: v.title, course: course.title, questions: v.question_count });
    return jsonResponse({ success: true, id }, 201);
  } catch (error) { return examDbError(error); }
}
