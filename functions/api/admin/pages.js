// POST /api/admin/pages：上傳網頁到某個科目（擁有者、管理員、該科目負責人）
import { jsonResponse } from "../../_lib/auth.js";
import { audit } from "../../_lib/content.js";
import { canEditCourse } from "../../_lib/pages.js";
import { pageRequest, cleanPage, missingEditorColumn } from "../../_lib/pageapi.js";

export async function onRequestPost({ request, env }) {
  const req = await pageRequest(request, env);
  if (req.error) return req.error;
  const { user, body } = req;

  const courseId = Number(body.courseId);
  if (!Number.isInteger(courseId) || courseId < 1) return jsonResponse({ error: "請選擇科目" }, 400);
  const course = await env.DB.prepare("SELECT id, title FROM courses WHERE id = ?").bind(courseId).first();
  if (!course) return jsonResponse({ error: "科目不存在" }, 400);
  if (!(await canEditCourse(env, user, courseId))) return jsonResponse({ error: "你不是這個科目的負責人，不能上傳。" }, 403);

  let v;
  try { v = cleanPage(body, { requireHtml: true }); } catch (e) { return jsonResponse({ error: e.message }, 400); }
  if (v.sort_order === undefined) {
    const max = await env.DB.prepare("SELECT COALESCE(MAX(sort_order), 0) AS m FROM pages WHERE course_id = ?").bind(courseId).first();
    v.sort_order = (max?.m || 0) + 10;
  }

  try {
    let r;
    try {
      r = await env.DB.prepare(`
        INSERT INTO pages (course_id, title, description, html, size, sort_order, editor, created_by, updated_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(courseId, v.title, v.description || "", v.html, v.size, v.sort_order, v.editor, user.id, user.id).run();
    } catch (e) {
      if (!missingEditorColumn(e)) throw e;
      r = await env.DB.prepare(`
        INSERT INTO pages (course_id, title, description, html, size, sort_order, created_by, updated_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(courseId, v.title, v.description || "", v.html, v.size, v.sort_order, user.id, user.id).run();
    }
    const id = r.meta?.last_row_id;
    await audit(env, user, "create", "page", id, { title: v.title, course: course.title, size: v.size });
    return jsonResponse({ success: true, id, url: `/p/${id}` }, 201);
  } catch (error) {
    console.error("Page create failed", error);
    return jsonResponse({ error: "儲存失敗，請稍後再試" }, 500);
  }
}
