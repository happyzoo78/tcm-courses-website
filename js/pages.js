/* pages.js：首頁、課程、圖卡、活動、關於我們等瀏覽頁面
   載入順序：core.js → pages.js → admin.js → app.js（順序不能改） */

/* =========================================================
   四、各頁面內容
   ========================================================= */
function courseCard(c, compact) {
  const n = pagesOf(c.id).length + filesOf(c.id).length;
  const x = publishedExamsOf(c.id).length;
  const k = itemsOf(c.id).length;
  return `
  <article class="course">
    <div class="cover" aria-hidden="true">${TAIJI}<span>${esc(c.icon || c.title.slice(0, 2))}</span></div>
    <div class="course-body">
      <h3>${esc(c.title)}${isExamSubject(c) ? ' <span class="exam-tag">執醫考科</span>' : ''}</h3>
      ${compact
        ? `<p class="meta-label">${n} 份網頁 · ${x} 份考卷 · ${k} 張圖卡</p>`
        : `<div class="numbers">
             <div><strong>${n}</strong><small> 份　學習網頁</small></div>
             <div><strong>${x}</strong><small> 份　模擬考卷</small></div>
             <div><strong>${k}</strong><small> 張　圖卡</small></div>
           </div>`}
      <p class="meta-label">最新一堂</p>
      <div class="latest">${esc(c.latest) || '—'}</div>
      <a class="link go" href="#course/${c.id}">進入科目 →</a>
    </div>
  </article>`;
}

// 依學期分組顯示科目（只顯示開放中的學期，新的在前）
function semesterSections(compact) {
  const sems = visibleSemesters().filter(s => coursesIn(s.code).length);
  if (!sems.length) return '<p class="empty">目前沒有開放的科目。</p>';
  return sems.map(s => `
    <h3 class="sem-title">${esc(s.label)}</h3>
    <div class="cards">${coursesIn(s.code).map(c => courseCard(c, compact)).join('')}</div>`).join('');
}

function itemCard(i, type) {
  const kicker = type === 'item' ? courseName(i.courseId) : '活動專案';
  return `
  <article class="item">
    <div class="thumb">${i.image ? `<img src="${esc(i.image)}" alt="${esc(i.title)}" loading="lazy">` : TAIJI}</div>
    <div class="item-body">
      <span class="kicker">${esc(kicker)}</span>
      <h3>${esc(i.title)}</h3>
      <p>${esc(cut(i.description, 80))}</p>
      <a class="link" href="#detail/${type}/${i.id}">查看詳細內容 →</a>
    </div>
  </article>`;
}

// 首頁「最新更新」：網頁、考卷、圖卡一起依時間排序
function recentUpdates(limit) {
  const open = new Set(visibleSemesters().map(x => x.code));
  const visible = id => open.has(getCourse(id)?.semesterCode);
  const day = t => String(t || '').slice(0, 10);
  const list = [
    ...(data.pages || []).filter(p => visible(p.courseId)).map(p => ({ t: p.updatedAt, date: day(fmtTime(p.updatedAt)).replace(/\//g, '-'), kind: '學習網頁', courseId: p.courseId, title: p.title, desc: p.description, href: p.url })),
    ...(data.exams || []).filter(e => e.published && visible(e.courseId)).map(e => ({ t: e.updatedAt, date: day(fmtTime(e.updatedAt)).replace(/\//g, '-'), kind: '模擬考', courseId: e.courseId, title: e.title, desc: `${e.category || '其他試題'} · ${e.questionCount} 題`, href: `#exam/${e.id}` })),
    ...data.items.filter(i => visible(i.courseId)).map(i => ({ t: i.date, date: i.date, kind: '圖卡', courseId: i.courseId, title: i.title, desc: i.description, href: `#detail/item/${i.id}` })),
    ...data.courses.filter(c => open.has(c.semesterCode)).flatMap(c => filesOf(c.id).map(f => ({ t: f.updated, date: day(f.updated), kind: '學習網頁', courseId: c.id, title: f.title, desc: f.description || '', href: f.path })))
  ];
  return list.sort((a, b) => String(b.t || '').localeCompare(String(a.t || ''))).slice(0, limit);
}

function homePage() {
  const open = new Set(visibleSemesters().map(s => s.code));
  const shown = data.courses.filter(c => open.has(c.semesterCode));
  const sum = f => shown.reduce((n, c) => n + f(c.id).length, 0);
  const totalPages = sum(pagesOf) + sum(filesOf);
  const totalExams = sum(publishedExamsOf);
  const totalCards = sum(itemsOf);
  const updates = recentUpdates(8);
  return `
  <section class="hero">
    <div class="eyebrow">學科複習考試速記圖卡</div>
    <h1 class="hero-title"><span><em>2026</em>福建中醫台灣班 -</span> <span>學習圖書館</span></h1>
    <p>從台灣到福建，深耕中醫學問 · 經典為本，辨證為綱，系統整理，臨床致用。</p>
    <div class="stats">
      <div class="stat"><strong>${shown.length}</strong><span>收錄科目</span></div>
      <div class="stat"><strong>${totalPages}</strong><span>學習網頁</span></div>
      <div class="stat"><strong>${totalExams}</strong><span>模擬考卷</span></div>
      <div class="stat"><strong>${totalCards}</strong><span>圖卡</span></div>
    </div>
  </section>

  <h2 class="section">科目入口 <small>點擊進入該科目</small></h2>
  ${semesterSections(false)}

  <h2 class="section">最新更新 <small>學習網頁、模擬考、圖卡依時間排序</small></h2>
  <div class="panel">
    ${updates.map(u => `
      <div class="update">
        <time>${esc(u.date)}</time>
        <div><span class="tag">${esc(courseName(u.courseId))}</span> <span class="kind-tag">${esc(u.kind)}</span></div>
        <div class="desc"><a class="link" href="${esc(u.href)}">${esc(u.title)}</a>　${esc(cut(u.desc, 60))}</div>
      </div>`).join('') || '<div class="empty">目前沒有更新紀錄</div>'}
  </div>

  <h2 class="section">使用說明</h2>
  <div class="panel prose">
    <p><b>瀏覽方式：</b>依學期找到科目，點「進入科目」查看該科的學習網頁、模擬考題與圖卡；上方「模擬考專區」可一次看到所有科目的考卷，「各科作業專區」不用登入也能看。</p>
    ${hasAdminAccess() ? `<p><b>資料管理：</b>點右上角「管理後台」，可以上傳網頁、出模擬考題${admin.canWrite ? '，或新增修改課程與圖卡' : '（限你負責的科目）'}。</p>` : ''}
    <p><b>使用範圍：</b>本站內容僅供班級成員學習使用，請勿轉貼或外流，並尊重教材著作權。</p>
  </div>`;
}

// 模擬考專區：所有開放學期、所有科目的考卷
function examZonePage() {
  const sems = visibleSemesters().map(sm => ({ sm, courses: coursesIn(sm.code).filter(c => examGroups(c.id).length) })).filter(x => x.courses.length);
  return `
  <h2 class="section">模擬考專區 <small>依學期、科目整理；點考卷開始作答</small></h2>
  ${sems.map(({ sm, courses }) => `
    <h3 class="sem-title">${esc(sm.label)}</h3>
    ${courses.map(c => `
      <div class="panel zone-course">
        <div class="zone-head"><a class="link" href="#course/${c.id}"><b>${esc(c.title)}</b></a>${isExamSubject(c) ? ' <span class="exam-tag">執醫考科</span>' : ''}</div>
        ${examGroups(c.id).map(([name, list]) => `
          <div class="zone-cat"><span class="kind-tag">${esc(name)}</span></div>
          <div class="pagelist">${list.map(examRowHtml).join('')}</div>`).join('')}
      </div>`).join('')}`).join('') || '<p class="empty">目前還沒有公開的模擬考卷。</p>'}`;
}

function coursesPage() {
  return `
  <h2 class="section">課程總覽</h2>
  ${semesterSections(true)}`;
}

// 單一科目頁：學習網頁清單＋圖卡
function coursePage() {
  const c = getCourse(courseTarget);
  if (!c) return `<p class="empty">找不到這個科目。</p><a class="btn secondary" href="#courses">回課程總覽</a>`;
  const list = pagesOf(c.id);
  const items = data.items.filter(i => i.courseId == c.id).sort(byDateDesc);
  return `
  <a class="btn secondary back" href="#courses">← 返回課程</a>
  <h2 class="section">${esc(c.title)} <small>${esc(semesterLabel(c.semesterCode))}</small></h2>
  ${c.owners?.length ? `<p class="meta-label">科目負責人：${c.owners.map(o => esc(o.name)).join('、')}</p>` : ''}
  ${canEditCourseUI(c.id) ? `<p><a class="btn" href="#admin/pages/${c.id}">＋ 上傳或管理這個科目的網頁</a></p>` : ''}
  <h3 class="sem-title">學習網頁</h3>
  <div class="pagelist">
    ${[...list.map(p => ({ ...p })), ...filesOf(c.id).map(f => ({ url: f.path, title: f.title, description: f.description || '', updatedAt: f.updated, updatedBy: '' , file: true }))].map(p => `
      <a class="pagerow" href="${esc(p.url)}">
        <span class="pr-title">${esc(p.title)}</span>
        ${p.description ? `<span class="pr-desc">${esc(cut(p.description, 120))}</span>` : ''}
        <span class="pr-meta">更新：${esc(p.file ? String(p.updatedAt || '').slice(0, 10) : fmtTime(p.updatedAt).slice(0, 10))}${p.updatedBy ? ' · ' + esc(p.updatedBy) : ''}</span>
      </a>`).join('') || '<p class="empty">這個科目還沒有上傳網頁。</p>'}
  </div>
  ${courseExamsHtml(c)}
  ${items.length ? `
  <h3 class="sem-title">圖卡 <small><a class="link" href="#items/${c.id}">搜尋圖卡 →</a></small></h3>
  <div class="itemgrid">${items.map(i => itemCard(i, 'item')).join('')}</div>` : ''}`;
}

function filteredItems() {
  const q = query.trim().toLowerCase();
  return data.items
    .filter(i => filter === 'all' || i.courseId == filter)
    .filter(i => !q || [i.title, i.description, courseName(i.courseId)].join(' ').toLowerCase().includes(q))
    .sort(byDateDesc);
}
function itemGridHtml() {
  return filteredItems().map(i => itemCard(i, 'item')).join('') || '<p class="empty">尚無符合條件的圖卡。</p>';
}
function itemsPage() {
  return `
  <a class="btn secondary back" href="${filter !== 'all' ? '#course/' + esc(filter) : '#courses'}">← 返回</a>
  <h2 class="section">圖卡目錄 ${filter !== 'all' ? `<small>${esc(courseName(filter))}</small>` : ''}</h2>
  <div class="toolbar">
    <input id="search" type="search" placeholder="搜尋圖卡或內容…" aria-label="搜尋圖卡" value="${esc(query)}">
    <select id="coursefilter" aria-label="篩選科目">
      <option value="all">所有科目</option>
      ${data.courses.map(c => `<option value="${c.id}" ${filter == c.id ? 'selected' : ''}>${esc(c.title)}</option>`).join('')}
    </select>
  </div>
  <div class="itemgrid" id="itemgrid">${itemGridHtml()}</div>`;
}

function projectsPage() {
  return `
  <h2 class="section">活動專案 <small>課程活動、讀書計畫與學習專案</small></h2>
  <div class="itemgrid">${[...data.projects].sort(byDateDesc).map(i => itemCard(i, 'project')).join('') || '<p class="empty">尚無活動專案。</p>'}</div>`;
}

function detailPage() {
  const [type, id] = detailTarget;
  const list = type === 'item' ? data.items : data.projects;
  const i = list.find(x => x.id == id);
  if (!i) return `<p class="empty">找不到內容。</p><a class="btn secondary" href="#home">回首頁</a>`;
  const backHref = type === 'item' ? `#course/${i.courseId}` : '#projects';
  return `
  <div class="reading">
    <a class="btn secondary back" href="${backHref}">← 返回列表</a>
    <article class="panel prose">
      <div class="eyebrow">${type === 'item' ? esc(courseName(i.courseId)) : '活動專案'}</div>
      <h1>${esc(i.title)}</h1>
      <p class="date">${esc(i.date)}</p>
      ${i.image ? `<img class="detail-image" src="${esc(i.image)}" alt="${esc(i.title)}">` : ''}
      <div class="content">${esc(i.description)}</div>
    </article>
  </div>`;
}

function aboutPage() {
  return `
  <section class="hero">
    <div class="eyebrow">傳承岐黃 · 學以致用</div>
    <h1>關於2026福建中醫台灣班網站</h1>
    <p>這是 2026 福建中醫藥大學台灣班同學共同整理的學習網站，收錄中醫與醫學課程的複習圖卡、筆記與讀書計畫。</p>
    <p>本站內容僅供班級成員學習使用。如需加入，請將你的 Gmail 提供給網站管理者。</p>
  </section>`;
}

// 我的帳號：每位成員都可以改自己的暱稱
const MAX_NAME = 30;
function accountPage() {
  const owned = data.courses.filter(c => (admin.ownedCourseIds || []).includes(c.id));
  const flash = adminFlash ? `<div class="msg ok">${esc(adminFlash)}</div>` : '';
  adminFlash = '';
  return `
  <h2 class="section">我的帳號</h2>
  ${flash}
  <div class="panel prose account">
    <form id="accountform">
      <div class="field"><label for="a-name">暱稱（最多 ${MAX_NAME} 字）</label>
        <input id="a-name" name="displayName" required maxlength="${MAX_NAME}" value="${esc(admin.displayName)}" autocomplete="nickname"></div>
      <p class="meta-label" style="margin-top:0">暱稱會顯示在科目負責人、網頁的「更新者」等地方，其他成員看得到。</p>
      <div id="accountmsg"></div>
      <button class="btn" type="submit">儲存暱稱</button>
    </form>
    <dl class="account-info">
      <dt>登入信箱</dt><dd>${esc(admin.email)}</dd>
      <dt>權限</dt><dd>${esc(ROLE_NAME[admin.role] || admin.role)}</dd>
      <dt>負責科目</dt><dd>${admin.canManageCourses ? '全部科目（擁有者、管理員可管理所有科目）' : owned.length ? owned.map(c => esc(c.title)).join('、') : '無'}</dd>
    </dl>
    <p class="meta-label">登入信箱與權限由網站管理者設定，如需變更請聯絡管理者。</p>
  </div>`;
}
