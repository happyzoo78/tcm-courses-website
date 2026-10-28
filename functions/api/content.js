// GET /api/content
// 讀取所有課程、圖卡、活動專案（必須是名單上的成員並已登入）
// 圖片本體不在這裡，另外用網址載入
import { jsonResponse } from "../_lib/auth.js";
import { getCurrentAdmin, hasPermission } from "../_lib/session.js";

function imageUrl(type, row) {
  return row.has_image
    ? `/api/images/${type}/${row.id}?v=${encodeURIComponent(row.updated_at || "")}`
    : "";
}

export async function onRequestGet({ request, env }) {
  if (!env.DB) {
    return jsonResponse({ error: "Service unavailable" }, 503);
  }

  let user;
  try {
    user = await getCurrentAdmin(request, env);
  } catch (error) {
    console.error("Session lookup failed", error);
    return jsonResponse({ error: "Service unavailable" }, 503);
  }
  if (!user || !hasPermission(user, "read")) {
    return jsonResponse({ error: "Login required" }, 401);
  }

  try {
    const [courses, items, projects, semesters, pages, owners] = await env.DB.batch([
      env.DB.prepare(`
        SELECT id, title, icon, lessons, cards, latest, semester_code, slug
        FROM courses
        ORDER BY id
      `),
      env.DB.prepare(`
        SELECT id, course_id, title, description, date, updated_at,
               (image <> '') AS has_image
        FROM items
        ORDER BY date DESC, id DESC
      `),
      env.DB.prepare(`
        SELECT id, title, description, date, updated_at,
               (image <> '') AS has_image
        FROM projects
        ORDER BY date DESC, id DESC
      `),
      env.DB.prepare(`
        SELECT code, label, sort_order, visible FROM semesters ORDER BY sort_order
      `),
      // 網頁清單（不含網頁本體，打開時才從 /p/編號 讀取）
      env.DB.prepare(`
        SELECT p.id, p.course_id, p.title, p.description, p.size, p.sort_order, p.updated_at,
               u.display_name AS updated_by_name
        FROM pages p LEFT JOIN admin_users u ON u.id = p.updated_by
        ORDER BY p.course_id, p.sort_order, p.id
      `),
      env.DB.prepare(`
        SELECT o.course_id, u.id AS user_id, u.display_name
        FROM course_owners o JOIN admin_users u ON u.id = o.user_id
        ORDER BY o.course_id, u.display_name
      `)
    ]);

    return jsonResponse({
      courses: courses.results.map(c => ({
        id: c.id,
        title: c.title,
        icon: c.icon || "",
        lessons: c.lessons,
        cards: c.cards,
        latest: c.latest || "",
        semesterCode: c.semester_code,
        slug: c.slug || "",
        owners: owners.results.filter(o => o.course_id === c.id).map(o => ({ id: o.user_id, name: o.display_name }))
      })),
      semesters: semesters.results.map(s => ({ code: s.code, label: s.label, sortOrder: s.sort_order, visible: Boolean(s.visible) })),
      pages: pages.results.map(p => ({
        id: p.id, courseId: p.course_id, title: p.title, description: p.description,
        size: p.size, sortOrder: p.sort_order, updatedAt: p.updated_at,
        updatedBy: p.updated_by_name || "", url: `/p/${p.id}`
      })),
      items: items.results.map(i => ({
        id: i.id,
        courseId: i.course_id,
        title: i.title,
        description: i.description,
        date: i.date,
        image: imageUrl("items", i)
      })),
      projects: projects.results.map(p => ({
        id: p.id,
        title: p.title,
        description: p.description,
        date: p.date,
        image: imageUrl("projects", p)
      }))
    });
  } catch (error) {
    console.error("Content query failed", error);
    return jsonResponse({ error: "Failed to load content" }, 500);
  }
}
