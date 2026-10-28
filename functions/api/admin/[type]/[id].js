// PUT    /api/admin/items/101  修改（需 write 權限：owner、admin、editor）
// DELETE /api/admin/items/101  刪除（需 publish 權限：owner、admin）
import { jsonResponse } from "../../../_lib/auth.js";
import { TYPES, requireAdmin, readJson, validate, audit } from "../../../_lib/content.js";

function parseTarget(params) {
  const type = params.type;
  const id = Number(params.id);
  if (!TYPES[type] || !Number.isInteger(id) || id < 1) return null;
  return { type, id, table: TYPES[type].table };
}

export async function onRequestPut({ request, env, params }) {
  const target = parseTarget(params);
  if (!target) return jsonResponse({ error: "Not found" }, 404);

  // 修改科目只限擁有者與管理員；圖卡、活動維持 write 權限
  const auth = await requireAdmin(request, env, target.type === "courses" ? "publish" : "write");
  if (auth.error) return auth.error;

  const parsed = await readJson(request);
  if (parsed.error) return parsed.error;

  const exists = await env.DB.prepare(`SELECT 1 AS ok FROM ${target.table} WHERE id = ?`)
    .bind(target.id).first();
  if (!exists) return jsonResponse({ error: "找不到這筆資料" }, 404);

  const checked = await validate(target.type, parsed.body, env);
  if (checked.error) return checked.error;

  const values = checked.values;
  const columns = Object.keys(values);

  try {
    await env.DB.prepare(`
      UPDATE ${target.table}
      SET ${columns.map(c => `${c} = ?`).join(", ")}, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(...columns.map(c => values[c]), target.id).run();

    await audit(env, auth.admin, "update", target.type, target.id, { title: values.title });
    return jsonResponse({ success: true, id: target.id });
  } catch (error) {
    console.error("Update failed", error);
    return jsonResponse({ error: "儲存失敗，請稍後再試" }, 500);
  }
}

export async function onRequestDelete({ request, env, params }) {
  const target = parseTarget(params);
  if (!target) return jsonResponse({ error: "Not found" }, 404);

  const auth = await requireAdmin(request, env, "publish");
  if (auth.error) return auth.error;

  try {
    if (target.type === "courses") {
      const used = await env.DB.prepare("SELECT 1 AS ok FROM items WHERE course_id = ? LIMIT 1")
        .bind(target.id).first();
      if (used) return jsonResponse({ error: "請先刪除或調整此課程所屬的圖卡。" }, 409);
      const hasPages = await env.DB.prepare("SELECT 1 AS ok FROM pages WHERE course_id = ? LIMIT 1")
        .bind(target.id).first();
      if (hasPages) return jsonResponse({ error: "請先刪除此科目裡的網頁。" }, 409);
      let hasExams = null;
      try {
        hasExams = await env.DB.prepare("SELECT 1 AS ok FROM exams WHERE course_id = ? LIMIT 1").bind(target.id).first();
      } catch { /* 還沒建立模擬考題資料表 */ }
      if (hasExams) return jsonResponse({ error: "請先刪除此科目裡的模擬考卷。" }, 409);
      await env.DB.prepare("DELETE FROM course_owners WHERE course_id = ?").bind(target.id).run();
    }

    const row = await env.DB.prepare(`SELECT title FROM ${target.table} WHERE id = ?`)
      .bind(target.id).first();
    if (!row) return jsonResponse({ error: "找不到這筆資料" }, 404);

    await env.DB.prepare(`DELETE FROM ${target.table} WHERE id = ?`).bind(target.id).run();

    await audit(env, auth.admin, "delete", target.type, target.id, { title: row.title });
    return jsonResponse({ success: true });
  } catch (error) {
    console.error("Delete failed", error);
    return jsonResponse({ error: "刪除失敗，請稍後再試" }, 500);
  }
}
