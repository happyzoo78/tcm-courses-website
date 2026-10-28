// PUT /api/admin/courses/4/owners：指定科目負責人（只限擁有者、管理員）
// 內容：{ "userIds": [5, 7] }  → 取代原本的負責人名單
import { jsonResponse } from "../../../../_lib/auth.js";
import { requireAdmin, readJson, audit } from "../../../../_lib/content.js";

export async function onRequestPut({ request, env, params }) {
  const auth = await requireAdmin(request, env, "publish");
  if (auth.error) return auth.error;

  const courseId = Number(params.id);
  const course = Number.isInteger(courseId) && await env.DB.prepare("SELECT id, title FROM courses WHERE id = ?").bind(courseId).first();
  if (!course) return jsonResponse({ error: "找不到這個科目" }, 404);

  const parsed = await readJson(request);
  if (parsed.error) return parsed.error;
  const ids = parsed.body.userIds;
  if (!Array.isArray(ids) || ids.length > 20 || !ids.every(x => Number.isInteger(x) && x > 0)) {
    return jsonResponse({ error: "負責人名單格式不正確" }, 400);
  }
  const unique = [...new Set(ids)];
  for (const uid of unique) {
    const u = await env.DB.prepare("SELECT 1 AS ok FROM admin_users WHERE id = ?").bind(uid).first();
    if (!u) return jsonResponse({ error: "名單中有不存在的成員" }, 400);
  }

  try {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM course_owners WHERE course_id = ?").bind(courseId),
      ...unique.map(uid => env.DB.prepare("INSERT INTO course_owners (course_id, user_id) VALUES (?, ?)").bind(courseId, uid))
    ]);
    await audit(env, auth.admin, "update", "course_owners", courseId, { course: course.title, userIds: unique });
    return jsonResponse({ success: true });
  } catch (error) {
    console.error("Set owners failed", error);
    return jsonResponse({ error: "儲存失敗，請稍後再試" }, 500);
  }
}
