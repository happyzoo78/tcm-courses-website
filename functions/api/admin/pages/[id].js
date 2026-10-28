// PUT    /api/admin/pages/123：修改標題、說明、排序，或換成新的網頁檔、搬到其他科目
// DELETE /api/admin/pages/123：刪除網頁
// 權限：擁有者、管理員、該科目負責人
import { jsonResponse } from "../../../_lib/auth.js";
import { audit } from "../../../_lib/content.js";
import { canEditCourse } from "../../../_lib/pages.js";
import { pageRequest, cleanPage } from "../../../_lib/pageapi.js";

async function loadPage(env, params) {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id < 1) return null;
  return env.DB.prepare("SELECT id, course_id, title FROM pages WHERE id = ?").bind(id).first();
}

export async function onRequestPut({ request, env, params }) {
  const req = await pageRequest(request, env);
  if (req.error) return req.error;
  const { user, body } = req;

  const page = await loadPage(env, params);
  if (!page) return jsonResponse({ error: "找不到這個網頁" }, 404);
  if (!(await canEditCourse(env, user, page.course_id))) return jsonResponse({ error: "你不是這個科目的負責人，不能修改。" }, 403);

  let v;
  try { v = cleanPage(body, { requireHtml: false }); } catch (e) { return jsonResponse({ error: e.message }, 400); }

  if ("courseId" in body) {
    const to = Number(body.courseId);
    const exists = Number.isInteger(to) && await env.DB.prepare("SELECT 1 AS ok FROM courses WHERE id = ?").bind(to).first();
    if (!exists) return jsonResponse({ error: "科目不存在" }, 400);
    if (!(await canEditCourse(env, user, to))) return jsonResponse({ error: "你不是目標科目的負責人，不能搬過去。" }, 403);
    v.course_id = to;
  }

  const cols = Object.keys(v);
  if (!cols.length) return jsonResponse({ error: "沒有要修改的內容" }, 400);
  try {
    await env.DB.prepare(`
      UPDATE pages SET ${cols.map(c => `${c} = ?`).join(", ")}, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).bind(...cols.map(c => v[c]), user.id, page.id).run();
    await audit(env, user, "update", "page", page.id, { title: v.title || page.title, fields: cols.filter(c => c !== "html") , newFile: "html" in v });
    return jsonResponse({ success: true });
  } catch (error) {
    console.error("Page update failed", error);
    return jsonResponse({ error: "儲存失敗，請稍後再試" }, 500);
  }
}

export async function onRequestDelete({ request, env, params }) {
  const req = await pageRequest(request, env);
  if (req.error) return req.error;
  const { user } = req;

  const page = await loadPage(env, params);
  if (!page) return jsonResponse({ error: "找不到這個網頁" }, 404);
  if (!(await canEditCourse(env, user, page.course_id))) return jsonResponse({ error: "你不是這個科目的負責人，不能刪除。" }, 403);

  try {
    await env.DB.prepare("DELETE FROM pages WHERE id = ?").bind(page.id).run();
    await audit(env, user, "delete", "page", page.id, { title: page.title });
    return jsonResponse({ success: true });
  } catch (error) {
    console.error("Page delete failed", error);
    return jsonResponse({ error: "刪除失敗，請稍後再試" }, 500);
  }
}
