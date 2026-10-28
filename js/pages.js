/* pages.js：首頁、課程、圖卡、活動、關於我們等瀏覽頁面
   載入順序：core.js → pages.js → admin.js → app.js（順序不能改） */

/* =========================================================
   四、各頁面內容
   ========================================================= */
function courseCard(c, compact) {
  return `
  <article class="course">
    <div class="cover" aria-hidden="true">${TAIJI}<span>${esc(c.icon || c.title.slice(0, 2))}</span></div>
    <div class="course-body">
      <h3>${esc(c.title)}</h3>
      ${compact
        ? `<p class="meta-label">${c.lessons} 堂課 · ${c.cards} 張圖卡</p>`
        : `<div class="numbers">
             <div><strong>${c.lessons}</strong><small> 堂　收錄課堂</small></div>
             <div><strong>${c.cards}</strong><small> 張　圖卡數量</small></div>
           </div>`}
      <p class="meta-label">最新一堂</p>
      <div class="latest">${esc(c.latest) || '—'}</div>
      <a class="link go" href="#items/${c.id}">進入圖卡目錄 →</a>
    </div>
  </article>`;
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

function homePage() {
  const totalCards = data.courses.reduce((s, c) => s + (Number(c.cards) || 0), 0);
  const totalLessons = data.courses.reduce((s, c) => s + (Number(c.lessons) || 0), 0);
  const updates = [...data.items].sort(byDateDesc).slice(0, 5);
  return `
  <section class="hero">
    <div class="eyebrow">學科複習考試速記圖卡</div>
    <h1 class="hero-title"><span><em>2026</em>福建中醫台灣班 -</span> <span>圖卡總目錄</span></h1>
    <p>從經典出發，走向臨床實用 · 系統整理，圖文並茂</p>
    <div class="stats">
      <div class="stat"><strong>${data.courses.length}</strong><span>收錄科目</span></div>
      <div class="stat"><strong>${totalLessons}</strong><span>收錄課堂</span></div>
      <div class="stat"><strong>${totalCards}</strong><span>圖卡總數</span></div>
    </div>
  </section>

  <h2 class="section">科目入口 <small>點擊進入該科目圖卡目錄</small></h2>
  <div class="cards">${data.courses.map(c => courseCard(c, false)).join('')}</div>

  <h2 class="section">更新說明 <small>依最新資料排序</small></h2>
  <div class="panel">
    ${updates.map(i => `
      <div class="update">
        <time>${esc(i.date)}</time>
        <div><span class="tag">${esc(courseName(i.courseId))}</span></div>
        <div class="desc"><a class="link" href="#detail/item/${i.id}">${esc(i.title)}</a>　${esc(i.description)}</div>
      </div>`).join('') || '<div class="empty">目前沒有更新紀錄</div>'}
  </div>

  <h2 class="section">使用說明</h2>
  <div class="panel prose">
    <p><b>瀏覽方式：</b>可依科目查看圖卡，點擊卡片進入詳細內容。</p>
    ${admin?.canWrite ? '<p><b>資料管理：</b>點右上角「管理後台」，可以新增或修改課程、圖卡與活動專案。</p>' : ''}
    <p><b>使用範圍：</b>本站內容僅供班級成員學習使用，請勿轉貼或外流，並尊重教材著作權。</p>
  </div>`;
}

function coursesPage() {
  return `
  <h2 class="section">課程總覽</h2>
  <div class="cards">${data.courses.map(c => courseCard(c, true)).join('')}</div>`;
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
  <a class="btn secondary back" href="#courses">← 返回課程</a>
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
  const backHref = type === 'item' ? `#items/${i.courseId}` : '#projects';
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
