// POST /api/admin/exams/preview：檢查貼上的題目格式（不會儲存）
import { jsonResponse } from "../../../_lib/auth.js";
import { parseExam, summarize } from "../../../_lib/exam.js";
import { examAdminRequest } from "../../../_lib/examadmin.js";

export async function onRequestPost({ request, env }) {
  const req = await examAdminRequest(request, env);
  if (req.error) return req.error;
  const parsed = parseExam(typeof req.body.source === "string" ? req.body.source : "");
  return jsonResponse({ ...parsed, summary: summarize(parsed) });
}
