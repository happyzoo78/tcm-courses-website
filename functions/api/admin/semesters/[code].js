// PUT /api/admin/semesters/2026_y1s2：開放或隱藏學期（只限擁有者、管理員）
// 內容：{ "visible": true }
import { jsonResponse } from "../../../_lib/auth.js";
import { requireAdmin, readJson, audit } from "../../../_lib/content.js";

export async function onRequestPut({ request, env, params }) {
  const auth = await requireAdmin(request, env, "publish");
  if (auth.error) return auth.error;

  const code = String(params.code || "");
  const sem = (/^\d{4}_y\ds\d$/.test(code) || code === "zy_bank") && await env.DB.prepare("SELECT code, label FROM semesters WHERE code = ?").bind(code).first();
  if (!sem) return jsonResponse({ error: "找不到這個學期" }, 404);

  const parsed = await readJson(request);
  if (parsed.error) return parsed.error;
  if (typeof parsed.body.visible !== "boolean") return jsonResponse({ error: "請指定開放或隱藏" }, 400);

  await env.DB.prepare("UPDATE semesters SET visible = ? WHERE code = ?").bind(parsed.body.visible ? 1 : 0, code).run();
  await audit(env, auth.admin, "update", "semester", code, { label: sem.label, visible: parsed.body.visible });
  return jsonResponse({ success: true });
}
