// 課程、圖卡、活動專案的共用工具：權限檢查、輸入驗證、操作紀錄
import { jsonResponse } from "./auth.js";
import { getCurrentAdmin, hasPermission } from "./session.js";

export const TYPES = {
  courses:  { table: "courses",  resource: "course"  },
  items:    { table: "items",    resource: "item"    },
  projects: { table: "projects", resource: "project" }
};

const encoder = new TextEncoder();
const MAX_BODY_BYTES = 1_200_000;   // 單次送出上限（含圖片）約 1.2 MB
const MAX_IMAGE_CHARS = 900_000;    // 圖片原檔約 650 KB 以內
const IMAGE_RE = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/* ---------- 權限 ---------- */

// 檢查：資料庫存在、請求來自本站、已登入、擁有指定權限
export async function requireAdmin(request, env, permission) {
  if (!env.DB) {
    return { error: jsonResponse({ error: "Service unavailable" }, 503) };
  }

  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) {
    return { error: jsonResponse({ error: "Forbidden" }, 403) };
  }

  let admin;
  try {
    admin = await getCurrentAdmin(request, env);
  } catch (error) {
    console.error("Session lookup failed", error);
    return { error: jsonResponse({ error: "Service unavailable" }, 503) };
  }

  if (!admin) {
    return { error: jsonResponse({ error: "Login required" }, 401) };
  }
  if (!hasPermission(admin, permission)) {
    return { error: jsonResponse({ error: "Permission denied" }, 403) };
  }

  return { admin };
}

/* ---------- 讀取 JSON ---------- */

export async function readJson(request) {
  const type = request.headers.get("Content-Type") || "";
  if (!type.toLowerCase().startsWith("application/json")) {
    return { error: jsonResponse({ error: "JSON required" }, 415) };
  }

  const text = await request.text();
  if (encoder.encode(text).length > MAX_BODY_BYTES) {
    return { error: jsonResponse({ error: "Request too large" }, 413) };
  }

  try {
    const body = JSON.parse(text);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
    return { body };
  } catch {
    return { error: jsonResponse({ error: "Invalid JSON" }, 400) };
  }
}

/* ---------- 輸入驗證 ---------- */

function cleanText(value, max, label, required) {
  const v = typeof value === "string" ? value.trim() : (value == null ? "" : null);
  if (v === null) return { error: `${label}格式錯誤` };
  if (required && !v) return { error: `請填寫${label}` };
  if (v.length > max) return { error: `${label}不可超過 ${max} 字` };
  return { value: v };
}

function cleanInt(value, label) {
  const n = value === "" || value == null ? 0 : Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 100000) return { error: `${label}必須是 0 以上的整數` };
  return { value: n };
}

function cleanDate(value) {
  const v = typeof value === "string" ? value.trim() : "";
  if (v && !DATE_RE.test(v)) return { error: "日期格式錯誤" };
  return { value: v };
}

// 圖片：沒有送 image 欄位＝保留原圖；空字串＝移除圖片；data URL＝更換圖片
function cleanImage(body) {
  if (!("image" in body)) return { keep: true };
  const v = body.image;
  if (v === "" || v === null) return { value: "" };
  if (typeof v !== "string" || !IMAGE_RE.test(v)) {
    return { error: "圖片格式不支援（請用 PNG、JPG、WebP 或 GIF）" };
  }
  if (v.length > MAX_IMAGE_CHARS) return { error: "圖片太大，請選擇小於 650 KB 的圖片" };
  return { value: v };
}

// 依資料類型驗證，回傳 { values } 或 { error }
export async function validate(type, body, env) {
  const out = {};
  const pick = (key, r) => {
    if (r.error) throw new Error(r.error);
    out[key] = r.value;
  };

  try {
    if (type === "courses") {
      pick("title",   cleanText(body.title, 100, "標題", true));
      pick("icon",    cleanText(body.icon, 10, "封面文字", false));
      // 課堂數、圖卡數改由前台自動計算；欄位保留，沒傳就存 0
      pick("lessons", cleanInt(body.lessons, "課堂數"));
      pick("cards",   cleanInt(body.cards, "圖卡數"));
      pick("latest",  cleanText(body.latest, 200, "最新課程名稱", false));
      if ("semesterCode" in body || "semester_code" in body) {
        const code = String(body.semesterCode ?? body.semester_code ?? "").trim();
        const sem = await env.DB.prepare("SELECT 1 AS ok FROM semesters WHERE code = ?").bind(code).first();
        if (!sem) throw new Error("請選擇學期");
        out.semester_code = code;
      }
      if ("slug" in body) {
        const slug = String(body.slug || "").trim().toLowerCase();
        if (slug && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) throw new Error("英文代碼只能用小寫英文、數字和連字號，例如 medical-biology");
        if (slug.length > 60) throw new Error("英文代碼不可超過 60 字");
        out.slug = slug;
      }
      return { values: out };
    }

    if (type === "items") {
      const courseId = Number(body.courseId ?? body.course_id);
      if (!Number.isInteger(courseId) || courseId < 1) throw new Error("請選擇所屬科目");
      const exists = await env.DB.prepare("SELECT 1 AS ok FROM courses WHERE id = ?").bind(courseId).first();
      if (!exists) throw new Error("所屬科目不存在");
      out.course_id = courseId;
    }

    // items 與 projects 共用欄位
    pick("title",       cleanText(body.title, 200, "標題", true));
    pick("description", cleanText(body.description, 20000, "內容介紹", false));
    pick("date",        cleanDate(body.date));

    const img = cleanImage(body);
    if (img.error) throw new Error(img.error);
    if (!img.keep) out.image = img.value;

    return { values: out };
  } catch (error) {
    return { error: jsonResponse({ error: error.message || "資料格式錯誤" }, 400) };
  }
}

/* ---------- 操作紀錄（失敗不影響主要動作） ---------- */

export async function audit(env, admin, action, type, id, details) {
  try {
    await env.DB.prepare(`
      INSERT INTO admin_audit_logs
        (actor_user_id, action, resource_type, resource_id, details)
      VALUES (?, ?, ?, ?, ?)
    `).bind(
      admin.id,
      action,
      TYPES[type]?.resource || type,
      String(id),
      details ? JSON.stringify(details).slice(0, 1000) : null
    ).run();
  } catch (error) {
    console.error("Audit log failed", error);
  }
}
