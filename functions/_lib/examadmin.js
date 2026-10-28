// 模擬考題後台：檢查欄位、權限
import { jsonResponse } from "./auth.js";
import { requireAdmin, readJson } from "./content.js";
import { canEditCourse } from "./pages.js";
import { parseExam, summarize, MAX_SOURCE } from "./exam.js";

export async function examAdminRequest(request, env, needBody = true) {
  const auth = await requireAdmin(request, env, "read");
  if (auth.error) return auth;
  if (!needBody) return { user: auth.admin, body: {} };
  const body = await readJson(request);
  if (body.error) return body;
  return { user: auth.admin, body: body.body };
}

// 檢查標題、說明、題目文字；有 source 時順便拆題
export function cleanExam(body, { requireAll }) {
  const out = {};
  if ("title" in body || requireAll) {
    const t = typeof body.title === "string" ? body.title.trim() : "";
    if (!t) throw new Error("請填寫考卷名稱");
    if (t.length > 200) throw new Error("考卷名稱不可超過 200 字");
    out.title = t;
  }
  if ("description" in body) {
    const d = typeof body.description === "string" ? body.description.trim() : "";
    if (d.length > 1000) throw new Error("說明不可超過 1000 字");
    out.description = d;
  }
  if ("category" in body) {
    const c = typeof body.category === "string" ? body.category.replace(/\s+/g, " ").trim() : "";
    if (c.length > 30) throw new Error("分類標籤不可超過 30 字");
    out.category = c;
  }
  if ("published" in body) out.published = body.published ? 1 : 0;
  if ("sortOrder" in body) {
    const n = Number(body.sortOrder);
    if (!Number.isInteger(n) || n < 0 || n > 100000) throw new Error("排序必須是 0 以上的整數");
    out.sort_order = n;
  }
  if ("source" in body || requireAll) {
    const src = typeof body.source === "string" ? body.source : "";
    if (!src.trim()) throw new Error("請貼上題目");
    if (src.length > MAX_SOURCE) throw new Error("題目太長，請分成兩份考卷");
    const parsed = parseExam(src);
    if (parsed.errors.length) {
      const e = new Error(`題目格式有 ${parsed.errors.length} 個問題，請先按「檢查格式」修正：${parsed.errors[0].message}`);
      e.errors = parsed.errors;
      throw e;
    }
    const s = summarize(parsed);
    out.source = src;
    out.data = JSON.stringify(parsed);
    out.question_count = s.questionCount;
    out.total_points = s.total;
  }
  return out;
}

export const badRequest = e => jsonResponse({ error: e.message, errors: e.errors || [] }, 400);
export { canEditCourse };
