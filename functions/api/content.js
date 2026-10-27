// GET /api/content
// 公開讀取：所有課程、圖卡、活動專案（不含圖片本體，圖片另外用網址載入）
import { jsonResponse } from "../_lib/auth.js";

function imageUrl(type, row) {
  return row.has_image
    ? `/api/images/${type}/${row.id}?v=${encodeURIComponent(row.updated_at || "")}`
    : "";
}

export async function onRequestGet({ env }) {
  if (!env.DB) {
    return jsonResponse({ error: "Service unavailable" }, 503);
  }

  try {
    const [courses, items, projects] = await env.DB.batch([
      env.DB.prepare(`
        SELECT id, title, icon, lessons, cards, latest
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
      `)
    ]);

    return jsonResponse({
      courses: courses.results.map(c => ({
        id: c.id,
        title: c.title,
        icon: c.icon || "",
        lessons: c.lessons,
        cards: c.cards,
        latest: c.latest || ""
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
