// POST /api/admin/courses | items | projects
// 新增資料（需登入，且具備 write 權限：owner、admin、editor）
import { jsonResponse } from "../../_lib/auth.js";
import { TYPES, requireAdmin, readJson, validate, audit } from "../../_lib/content.js";

export async function onRequestPost({ request, env, params }) {
  const type = params.type;
  if (!TYPES[type]) return jsonResponse({ error: "Not found" }, 404);

  // 建立科目只限擁有者與管理員；圖卡、活動維持 write 權限
  const auth = await requireAdmin(request, env, type === "courses" ? "publish" : "write");
  if (auth.error) return auth.error;

  const parsed = await readJson(request);
  if (parsed.error) return parsed.error;

  const checked = await validate(type, parsed.body, env);
  if (checked.error) return checked.error;

  const values = checked.values;
  const columns = Object.keys(values);

  try {
    const result = await env.DB.prepare(`
      INSERT INTO ${TYPES[type].table} (${columns.join(", ")})
      VALUES (${columns.map(() => "?").join(", ")})
    `).bind(...columns.map(c => values[c])).run();

    const id = result.meta?.last_row_id;
    await audit(env, auth.admin, "create", type, id, { title: values.title });
    return jsonResponse({ success: true, id }, 201);
  } catch (error) {
    console.error("Create failed", error);
    return jsonResponse({ error: "儲存失敗，請稍後再試" }, 500);
  }
}
