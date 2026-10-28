// GET /api/content
// 讀取所有課程、圖卡、活動專案（必須是名單上的成員並已登入）
// 圖片本體不在這裡，另外用網址載入
import { jsonResponse } from "../_lib/auth.js";
import { getCurrentAdmin, hasPermission } from "../_lib/session.js";
import { canManageAll, ownedCourseIds } from "../_lib/pages.js";

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
    const query = withEditor => env.DB.batch([
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
               ${withEditor ? "p.editor" : "0 AS editor"},
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
    // 資料庫還沒加 editor 欄位時，先用 0 代替，網站照常運作
    let results;
    try { results = await query(true); }
    catch (e) {
      if (!/editor/i.test(String(e?.message || e))) throw e;
      results = await query(false);
    }
    const [courses, items, projects, semesters, pages, owners] = results;

    // 模擬考題（資料表還沒建立時就當作沒有考卷）
    let exams = [];
    try {
      const all = canManageAll(user);
      const owned = all ? [] : await ownedCourseIds(env, user);
      const [list, mine] = await env.DB.batch([
        env.DB.prepare(`
          SELECT id, course_id, title, description, category, question_count, total_points, published, sort_order, updated_at
          FROM exams ORDER BY course_id, sort_order, id
        `),
        env.DB.prepare(`
          SELECT exam_id, COUNT(*) AS n, MAX(score * 100.0 / max_score) AS best
          FROM exam_attempts WHERE user_id = ? AND max_score > 0 GROUP BY exam_id
        `).bind(user.id)
      ]);
      exams = list.results
        .filter(e => e.published || all || owned.includes(e.course_id))
        .map(e => {
          const m = mine.results.find(x => x.exam_id === e.id);
          return { id: e.id, courseId: e.course_id, title: e.title, description: e.description, category: e.category || "",
                   questionCount: e.question_count, totalPoints: e.total_points, published: Boolean(e.published),
                   sortOrder: e.sort_order, updatedAt: e.updated_at,
                   myAttempts: m ? m.n : 0, myBest: m ? Math.round(m.best * 10) / 10 : null };
        });
    } catch (error) {
      if (!/no such table/i.test(String(error?.message || error))) console.error("Exam list failed", error);
    }

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
      exams,
      semesters: semesters.results.map(s => ({ code: s.code, label: s.label, sortOrder: s.sort_order, visible: Boolean(s.visible) })),
      pages: pages.results.map(p => ({
        id: p.id, courseId: p.course_id, title: p.title, description: p.description,
        size: p.size, sortOrder: p.sort_order, updatedAt: p.updated_at,
        updatedBy: p.updated_by_name || "", url: `/p/${p.id}`, editable: Boolean(p.editor)
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
