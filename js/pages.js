/* pages.js：首頁、課程、圖卡、活動、關於我們等瀏覽頁面
   載入順序：core.js → pages.js → admin.js → app.js（順序不能改） */

/* =========================================================
   四、各頁面內容
   ========================================================= */
function courseCard(c) {
  const n = pagesOf(c.id).length + filesOf(c.id).length;
  const x = publishedExamsOf(c.id).length;
  const k = itemsOf(c.id).length + deckCardCount(c.id);
  return `
  <article class="course">
    <div class="cover" aria-hidden="true">${COVER_ART(Number(c.id) - 1)}<span>${esc(c.icon || c.title.slice(0, 2))}</span></div>
    <div class="course-body">
      <h3>${esc(c.title)}${isExamSubject(c) ? ' <span class="exam-tag">執醫考科</span>' : ''}</h3>
      <p class="meta-label">${[n ? `${n} 份講義` : '', `${k} 張圖卡`, `${x} 份試題`].filter(Boolean).join(' · ')}</p>
      <p class="meta-label">最新進度</p>
      <div class="latest">${esc(c.latest) || '—'}</div>
      <a class="more-btn go" href="#course/${c.id}">進入圖卡總目錄<span class="arr" aria-hidden="true">›</span></a>
    </div>
  </article>`;
}

// 依年級分頁顯示科目卡（只顯示開放中的學期），資料再多頁面也不會無限變長
function yearCoursesHtml() {
  const sems = visibleSemesters().filter(s => s.code !== BANK_SEM && coursesIn(s.code).length);
  if (!sems.length) return '<p class="empty-note">目前沒有開放的科目。</p>';
  const tabs = yearTabsHtml(new Set(sems.map(s => yearOf(s.code))));
  return tabs + semestersOfYear(sems, siteYear).map(s => `
    <h3 class="sem-title">${esc(s.label)}</h3>
    <div class="cards">${coursesIn(s.code).map(courseCard).join('')}</div>`).join('');
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
      <a class="more-btn go" href="#detail/${type}/${i.id}">查看詳細內容<span class="arr" aria-hidden="true">›</span></a>
    </div>
  </article>`;
}

// 首頁「最新更新」：網頁、考卷、圖卡一起依時間排序
function recentUpdates(limit) {
  const open = new Set(visibleSemesters().map(x => x.code));
  const visible = id => open.has(getCourse(id)?.semesterCode);
  const day = t => String(t || '').slice(0, 10);
  const list = [
    ...(data.pages || []).filter(p => visible(p.courseId)).map(p => ({ t: p.updatedAt, date: day(fmtTime(p.updatedAt)).replace(/\//g, '-'), kind: '講義', courseId: p.courseId, title: p.title, desc: p.description, href: p.url })),
    ...(data.exams || []).filter(e => e.published && visible(e.courseId)).map(e => ({ t: e.updatedAt, date: day(fmtTime(e.updatedAt)).replace(/\//g, '-'), kind: '試題', group: `${e.courseId}|${examCatName(e.courseId, e.category)}`, courseId: e.courseId, title: shortExamTitle(e, getCourse(e.courseId) || {}), desc: `${examCatName(e.courseId, e.category) || '其他試題'} · ${e.questionCount} 題`, href: `#exam/${e.id}` })),
    ...data.items.filter(i => visible(i.courseId) && itemsOf(i.courseId).length).map(i => ({ t: i.date, date: i.date, kind: '圖卡', courseId: i.courseId, title: i.title, desc: i.description, href: `#detail/item/${i.id}` })),
    ...data.courses.filter(c => open.has(c.semesterCode)).flatMap(c => (deckOf(c.id)?.chapters || []).map(ch => { const t = ch.updated || deckOf(c.id).version; return { t, date: day(t), kind: '圖卡', courseId: c.id, title: `第 ${ch.no} 章 ${ch.title}`, desc: `${ch.cards.length} 張圖卡`, href: `#cards/${c.id}/${ch.no}` }; })),
    ...data.courses.filter(c => open.has(c.semesterCode)).flatMap(c => filesOf(c.id).map(f => ({ t: f.updated, date: day(f.updated), kind: '講義', courseId: c.id, title: f.title, desc: f.description || '', href: f.path })))
  ];
  list.sort((a, b) => String(b.t || '').localeCompare(String(a.t || '')));
  // 同一天、同科目、同分類一次上傳好幾份考卷 → 合併成一筆
  const out = [];
  for (const u of list) {
    const last = out[out.length - 1];
    if (u.group && last && last.group === u.group && last.date === u.date) { last.names.push(u.title); continue; }
    out.push(u.group ? { ...u, names: [u.title] } : u);
  }
  return out.slice(0, limit).map(u => u.names && u.names.length > 1
    ? { ...u, title: `${u.desc.split(' · ')[0]}：新增 ${u.names.length} 份`, desc: u.names.join('、'), href: `#course/${u.courseId}` }
    : u);
}

// 首頁主角：依年級顯示學習圖卡（每科最多 4 張，其餘到科目頁看）
// 首頁學習圖卡：輪播以「學期」為一頁，每頁列出該學期所有科目（每科最多 3 張最新圖卡）
function shelfCardsHtml() {
  const sems = visibleSemesters().filter(s => s.code !== BANK_SEM && coursesIn(s.code).length).sort((a, b) => a.sortOrder - b.sortOrder);
  if (!sems.length) return '<p class="empty-note">目前沒有開放的科目。</p>';
  const shelf = c => {
    // 依章節的圖卡集排前面（新的章在前），再接單張圖卡
    const chaps = (deckOf(c.id)?.chapters || []).slice().reverse().map(ch => ({ href: `#cards/${c.id}/${ch.no}`, image: ch.cover.thumb, title: `第 ${ch.no} 章 ${ch.title}`, sub: `${ch.cards.length} 張圖卡` }));
    const singles = itemsOf(c.id).slice().sort(byDateDesc).map(i => ({ href: `#detail/item/${i.id}`, image: i.image, title: i.title, sub: i.date || '' }));
    const items = [...chaps, ...singles];
    const total = itemsOf(c.id).length + deckCardCount(c.id);
    return `
      <div class="shelf">
        <div class="shelf-head">
          <h4><a href="#course/${c.id}">${esc(c.title)}</a>${isExamSubject(c) ? ' <span class="exam-tag">執醫考科</span>' : ''}</h4>
          <span class="shelf-meta">${total} 張圖卡</span>
        </div>
        ${items.length ? `<div class="shelf-list">${items.slice(0, 3).map(i => `
          <a class="mini-card" href="${i.href}">
            <span class="mini-thumb">${i.image ? `<img src="${esc(i.image)}" alt="" loading="lazy">` : TAIJI}</span>
            <span class="mini-text"><b>${esc(i.title)}</b><small>${esc(i.sub)}</small></span>
          </a>`).join('')}</div>`
          : '<p class="empty-note">這個科目還沒有圖卡。</p>'}
        <a class="more-btn" href="#course/${c.id}" title="進入「${esc(c.title)}」" aria-label="進入「${esc(c.title)}」">More<span class="arr" aria-hidden="true">›</span></a>
      </div>`;
  };
  const start = sems.length - 1;   // 預設停在最新的學期
  return `
  <div class="carousel sem-carousel" data-carousel data-car-start="${start}" aria-roledescription="輪播" aria-label="各學期圖卡">
    <div class="car-bar car-top">
      <button type="button" class="car-btn" data-car="prev" aria-label="上一個學期">‹</button>
      <div class="car-tabs">${sems.map((sm, i) => `<button type="button" class="car-tab" data-car-dot="${i}">${esc(shortSemLabel(sm.code))}</button>`).join('')}</div>
      <button type="button" class="car-btn" data-car="next" aria-label="下一個學期">›</button>
    </div>
    <div class="car-track">${sems.map(sm => {
      const has = c => itemsOf(c.id).length + deckCardCount(c.id) > 0;
      const list = coursesIn(sm.code).slice().sort((a, b) => has(b) - has(a));
      return `
      <section class="car-slide" aria-label="${esc(sm.label)}">
        <h3 class="sem-title">${esc(sm.label)} <small>${list.length} 個科目</small></h3>
        <div class="shelves" data-n="${list.length}">${list.map(shelf).join('')}</div>
      </section>`;
    }).join('')}</div>
  </div>`;
}

function homePage() {
  const open = new Set(visibleSemesters().map(s => s.code));
  const shown = data.courses.filter(c => open.has(c.semesterCode) && !isBankCourse(c));
  const bankShown = data.courses.filter(c => open.has(c.semesterCode) && isBankCourse(c));
  const sum = f => shown.reduce((n, c) => n + f(c.id).length, 0);
  const totalPages = sum(pagesOf) + sum(filesOf);
  const totalExams = sum(publishedExamsOf) + bankShown.reduce((n, c) => n + publishedExamsOf(c.id).length, 0);
  const totalCards = sum(itemsOf) + shown.reduce((n, c) => n + deckCardCount(c.id), 0);
  const updates = recentUpdates(5);
  return `
  <section class="hero has-art">${HERO_ART}
    <div class="eyebrow"><span class="nw">中醫學習</span> · <span class="nw">大醫精誠</span></div>
    <h1 class="hero-title"><span><em>2026</em>福建中醫台灣班 -</span> <span>學習圖書館</span></h1>
    <p>從台灣到福建，深耕中醫學問 · 經典為本，辨證為綱，系統整理，臨床致用。</p>
    <div class="stats">
      <div class="stat"><strong>${shown.length}</strong><span>學習科目</span></div>
      ${totalPages ? `<div class="stat"><strong>${totalPages}</strong><span>學習講義</span></div>` : ''}
      <div class="stat"><strong>${totalCards}</strong><span>學習圖卡</span></div>
      <div class="stat"><strong>${totalExams}</strong><span>學習試題</span></div>
    </div>
  </section>

  <h2 class="section">學習圖卡 <small class="motto">博觀約取，厚積薄發</small></h2>
  <div class="sub-block">${shelfCardsHtml()}</div>

  <hr class="block-sep" aria-hidden="true">
  <h2 class="section">最新更新 <small class="motto">日新又新，學無止境</small></h2>
  <div class="sub-block"><div class="upd-list">
    ${updates.map(u => `
      <a class="upd-row" href="${esc(u.href)}" title="${esc(u.desc || u.title)}">
        <time>${esc(u.date.slice(5))}</time>
        <span class="kind-tag">${esc(u.kind)}</span>
        <span class="upd-course">${esc(courseName(u.courseId))}</span>
        <span class="upd-title">${esc(u.title)}</span>
      </a>`).join('') || '<p class="empty-note">目前沒有更新紀錄。</p>'}
  </div></div>

  <hr class="block-sep" aria-hidden="true">
  <h2 class="section">使用說明 <small class="motto">按圖索驥，循序漸進</small></h2>
  <div class="sub-block"><div class="panel prose use-guide">
    <p><b>瀏覽方式：</b>本站依科目整理，每個科目收著該科的圖卡與試題。上方「學習科目」依年級找科目；「學習試題」集中所有可線上作答的試題；「作業專區」不用登入也能看。</p>
    ${hasAdminAccess() ? `<p><b>資料管理：</b>點右上角「管理後台」，可以出題${admin.canWrite ? '，或新增修改科目與圖卡' : '（限你負責的科目）'}。</p>` : ''}
    <p><b>使用範圍：</b>本站內容僅供班級成員學習使用，請勿轉貼或外流，並尊重教材著作權。</p>
  </div></div>`;
}

const zoneCourseSel = {};   // 每個年級目前選的科目

// 模擬考專區：年級 → 科目 → 分類 → 章節，一次只顯示一個科目
function examZonePage() {
  // #examzone/科目編號/章號（圖卡的「學習試題」）：選好年級、科目，並跳到有這一章的第一個分類
  if (routeParts[1]) {
    const dc = getCourse(routeParts[1]);
    if (dc) {
      siteYear = yearOf(dc.semesterCode) || siteYear;
      zoneCourseSel[siteYear] = dc.id;
      const no = routeParts[2] || '';
      const g = no && examGroups(dc.id).find(([, list]) => list.some(e => examChapNo(shortExamTitle(e, dc)) === no));
      if (g) examFilter[dc.id] = { cat: g[0], ch: '', want: no };
    }
    routeParts = ['examzone'];
    history.replaceState(null, '', '#examzone');
  }
  const sems = visibleSemesters().filter(s => s.code !== BANK_SEM || coursesIn(s.code).length);
  const tabs = yearTabsHtml(new Set(sems.map(s => yearOf(s.code))), null, true);
  const inYear = semestersOfYear(sems, siteYear);
  const courses = inYear.flatMap(sm => coursesIn(sm.code));
  const count = c => examsOf(c.id).length;
  const c = courses.find(x => x.id === zoneCourseSel[siteYear]) || courses.find(count) || courses[0];
  const head = '<h2 class="section">學習試題 <small class="motto">學而時習，溫故知新</small></h2>';
  if (!c) return head + tabs + '<p class="empty-note">目前沒有開放的學期。</p>';
  return `${head}${tabs}
  ${siteYear === BANK_YEAR ? '' : `<div class="subj-rows">${subjChipsHtml(inYear, c.id, count, 'data-zone-course')}</div>`}
  <div class="exnav">
    <div class="exnav-top">
      <h3 class="exnav-title">${isBankCourse(c) ? esc(c.title) : `<a class="link" href="#course/${c.id}">${esc(c.title)}</a>`}${isExamSubject(c) ? ' <span class="exam-tag">執醫考科</span>' : ''}</h3>
      ${canEditCourseUI(c.id) ? `<a class="more-btn sec-link" href="#admin/exams/${c.id}">管理試題<span class="arr" aria-hidden="true">›</span></a>` : ''}
    </div>
    ${examBrowserHtml(c)}
  </div>`;
}

function coursesPage() {
  return `
  <h2 class="section">學習科目 <small class="motto">博學審問，慎思明辨</small></h2>
  ${yearCoursesHtml()}`;
}

// 單一科目頁（學習科目 → 進入圖卡總目錄）：整頁介紹這科的圖卡（依章節圖卡＝總目錄、其他圖卡），講義放最前面；
// 試題不在這裡展開，只在最下方提供「到學習試題作答」的連結（試題集中在「學習試題」）
function coursePage() {
  const c = getCourse(courseTarget);
  if (!c) return `<p class="empty-note">找不到這個科目。</p><a class="btn secondary" href="#courses">回學習科目</a>`;
  const list = pagesOf(c.id);
  const items = itemsOf(c.id).slice().sort(byDateDesc);
  const deck = deckOf(c.id);
  const pages = [...list, ...filesOf(c.id).map(f => ({ url: f.path, title: f.title, description: f.description || '', updatedAt: f.updated, updatedBy: '', file: true }))];
  return `
  <h2 class="section">${esc(c.title)} · 圖卡總目錄${isExamSubject(c) ? ' <span class="exam-tag">執醫考科</span>' : ''} <small>${esc(semesterLabel(c.semesterCode))}${c.owners?.length ? `　負責人：${c.owners.map(o => esc(o.name)).join('、')}` : ''}</small></h2>
  <div class="sub-block">
  ${pages.length ? `
  <h3 class="sec-title">講義</h3>
  <div class="pagelist">
    ${pages.map(p => `
      <a class="pagerow" href="${esc(p.url)}">
        <span class="pr-title">${esc(p.title)}</span>
        ${p.description ? `<span class="pr-desc">${esc(cut(p.description, 120))}</span>` : ''}
        <span class="pr-meta">更新：${esc(p.file ? String(p.updatedAt || '').slice(0, 10) : fmtTime(p.updatedAt).slice(0, 10))}${p.updatedBy ? ' · ' + esc(p.updatedBy) : ''}</span>
      </a>`).join('')}
  </div>` : ''}
  ${deck ? `
  <h3 class="sec-title sec-rule">各章節圖卡 <small>${deck.chapters.length} 章 · ${deckCardCount(c.id)} 張</small></h3>
  <div class="note-box deck-note"><span class="note-lab">使用方式</span>選一章點<strong>「看圖卡」</strong>進入該章的圖卡，點圖可看大圖；看完圖卡，頁面最下方有<strong>「做這章的試題 ›」</strong>，直接到學習試題作答。</div>
  <div class="note-box deck-note"><span class="note-lab">提醒</span>圖卡由 AI 協助製作，難免會有錯字或疏漏。複習時請<strong>搭配上課 PPT 和課本一起對照</strong>，不要只看圖卡。<br>發現錯誤時，請<strong>在班群告知是哪一張圖卡、哪裡有錯</strong>（例如「第 02 章 02-08 第③區」），科目負責人會盡快安排修正。謝謝大家的配合！</div>
  ${deckChaptersHtml(c, deck)}` : ''}
  ${items.length ? `
  <h3 class="sec-title sec-rule">${deck ? '其他圖卡' : '圖卡'}<a class="more-btn sec-link" href="#items/${c.id}">搜尋圖卡<span class="arr" aria-hidden="true">›</span></a></h3>
  <div class="itemgrid">${items.map(i => itemCard(i, 'item')).join('')}</div>` : ''}
  ${!deck && !items.length ? '<p class="empty-note">這個科目還沒有圖卡。</p>' : ''}
  ${courseExamJumpHtml(c)}
  </div>`;
}

// 科目頁最下方：試題只放連結（點了到「學習試題」並選好這一科；管理試題在學習試題頁與後台）
function courseExamJumpHtml(c) {
  const n = publishedExamsOf(c.id).length;
  if (!n) return '';
  return `
  <div class="exam-jump">
    <span>這一科有 <b>${n}</b> 份試題</span>
    <a class="more-btn" href="#examzone/${c.id}">到學習試題作答<span class="arr" aria-hidden="true">›</span></a>
  </div>`;
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
  <h2 class="section">活動專案 <small class="motto">切磋琢磨，教學相長</small></h2>
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
  <section class="hero about-hero has-art">${HERO_ART}
    <div class="eyebrow"><span class="nw">中醫學習</span> · <span class="nw">大醫精誠</span></div>
    <h1>關於本站</h1>
    <p>這是 2026 福建中醫藥大學台灣班同學共同耕耘的學習園地。我們從台灣負笈福建，在經典與臨床、中醫與西醫之間往返求索：把課堂重點整理成講義，把章節考點編成試題，把難記的概念繪成圖卡，也把每一份作業、每一道錯題，都留作彼此的參照。</p>
    <p>醫道浩瀚，一人獨行易迷，眾人同行致遠。願這座小小的圖書館，陪伴每位同學溫故知新、互補長短，在執醫之路上步步踏實，終能以精誠之心，成為病人可以安心託付的好醫者。</p>
    <p class="about-note">本站內容僅供班級成員學習使用。如需加入，請將你的 Gmail 提供給網站管理者。</p>
  </section>
  ${contactHtml()}`;
}

// 聯絡管理員：登入的成員寫信給網站管理者（信寄到管理者信箱，管理者按回覆會回到你的 Email）
function contactHtml() {
  if (!admin || !admin.mailEnabled) return '';
  return `
  <hr class="block-sep" aria-hidden="true">
  <h2 class="section" id="contact">聯絡管理員 <small class="motto">同窗共勉，教學相長</small></h2>
  <div class="panel prose contact">
    <form id="contactform">
      <div class="field"><label for="c-subject">主旨（選填）</label><input id="c-subject" name="subject" maxlength="60" placeholder="例如：試題有錯字、想協助出題"></div>
      <div class="field"><label for="c-msg">內容</label><textarea id="c-msg" name="message" maxlength="2000" required></textarea></div>
      <p class="meta-label" style="margin-top:0">管理者會回信到你的登入信箱 ${esc(admin.email)}。</p>
      <div class="note-box"><span class="note-lab">提醒</span>管理者的回信<strong>有可能被歸到垃圾郵件</strong>，<strong>沒收到請先查看垃圾郵件匣</strong>。<br>這個表單<strong>要登入才能使用</strong>。若有同學進不了網站，請他在登入頁按<strong>「忘記密碼／第一次設定密碼？」</strong>，或<strong>在班群私訊網站管理者</strong>。</div>
      <div id="contactmsg"></div>
      <button class="btn" type="submit">寄出</button>
    </form>
  </div>`;
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
    <div class="panel-head"><h3>基本資料</h3><p>暱稱會顯示在科目負責人、網頁的「更新者」等地方，其他成員看得到。</p></div>
    <form id="accountform">
      <div class="field"><label for="a-name">暱稱（最多 ${MAX_NAME} 字）</label>
        <input id="a-name" name="displayName" required maxlength="${MAX_NAME}" value="${esc(admin.displayName)}" autocomplete="nickname"></div>
      <div id="accountmsg"></div>
      <button class="btn" type="submit">儲存暱稱</button>
    </form>
    <dl class="account-info">
      <dt>登入信箱</dt><dd>${esc(admin.email)}</dd>
      <dt>權限</dt><dd>${esc(roleLabel(admin.role, owned.length > 0))}</dd>
      <dt>負責科目</dt><dd>${admin.canManageCourses ? '全部科目（擁有者、管理員可管理所有科目）' : owned.length ? owned.map(c => esc(c.title)).join('、') : '無'}</dd>
    </dl>
    <p class="meta-label">登入信箱與權限由網站管理者設定，如需變更請聯絡管理者。</p>
  </div>
  <div class="panel prose account" style="margin-top:16px">
    <div class="panel-head"><h3>登入密碼</h3><p>${admin.hasPassword
      ? '你可以用「Email＋密碼」登入。改密碼後，其他裝置上的登入會被登出。'
      : '你目前只用 Google 登入。設定密碼後，也可以用「Email＋密碼」登入（例如人在大陸、不能用 Google 時）。'}</p></div>
    <form id="pwform" autocomplete="on">
      <input type="email" name="username" value="${esc(admin.email)}" autocomplete="username" hidden>
      ${admin.hasPassword ? '<div class="field"><label for="p-cur">目前密碼</label><input id="p-cur" name="currentPassword" type="password" autocomplete="current-password" required></div>' : ''}
      <div class="field"><label for="p-new">新密碼（至少 12 字）</label><input id="p-new" name="newPassword" type="password" minlength="12" maxlength="128" autocomplete="new-password" required></div>
      <div class="field"><label for="p-new2">再輸入一次新密碼</label><input id="p-new2" name="newPassword2" type="password" minlength="12" maxlength="128" autocomplete="new-password" required></div>
      <div id="pwmsg"></div>
      <button class="btn" type="submit">${admin.hasPassword ? '修改密碼' : '設定密碼'}</button>
    </form>
  </div>`;
}


/* 第一次登入：使用須知＋備用密碼（同意之前不能使用其他頁面） */
function welcomePage() {
  const needPw = !admin.hasPassword;
  return `
  <div class="welcome">
    <div class="panel prose">
      <div class="eyebrow">歡迎加入</div>
      <h2 style="margin-top:4px">${esc(admin.displayName && admin.displayName !== admin.email ? admin.displayName : '同學')}，開始使用前請先閱讀</h2>
      <ol class="terms">
        <li><b>班級專用</b>：本站只給 2026 福建中醫藥大學台灣班成員學習使用。請勿把帳號借給別人，也不要把講義、圖卡、試題、作業答案轉貼或外流。</li>
        <li><b>尊重著作權</b>：教材著作權屬於原作者與學校，本站內容是同學整理的複習資料，僅供個人學習。</li>
        <li><b>內容以課堂為準</b>：講義、圖卡、試題由同學整理，難免有錯，請以老師上課與教材為準；發現錯誤請告訴科目負責人。</li>
        <li><b>登入方式</b>：可以用 Google 帳號，或「Email＋密碼」。<b>人在大陸時 Google 常常不能用</b>，建議現在就設一組備用密碼。忘記密碼時，可在登入頁按「忘記密碼／第一次設定密碼？」收信重設，或請網站管理者幫忙。</li>
        <li><b>本站會記錄的資料</b>：你的 Email、暱稱、最後登入與上線時間、試題作答與成績（科目負責人與管理者看得到成績）。詳細內容請看<a class="link" href="/privacy.html" target="_blank" rel="noopener">隱私權政策</a>。</li>
      </ol>
      <form id="welcomeform">
        ${needPw ? `
        <fieldset class="welcome-pw">
          <legend>設定備用密碼（建議，以防不能用 Google 登入）</legend>
          <input type="email" name="username" value="${esc(admin.email)}" autocomplete="username" hidden>
          <div class="field"><label for="w-pw">密碼（至少 12 字）</label><input id="w-pw" name="pw" type="password" minlength="12" maxlength="128" autocomplete="new-password"></div>
          <div class="field"><label for="w-pw2">再輸入一次</label><input id="w-pw2" name="pw2" type="password" minlength="12" maxlength="128" autocomplete="new-password"></div>
          <p class="meta-label" style="margin:0">之後登入時，輸入 <b>${esc(admin.email)}</b> 和這組密碼即可。現在不設也可以，之後到「我的帳號」設定。</p>
        </fieldset>` : '<p class="meta-label">你已經設定過登入密碼，可以用 Email＋密碼登入。</p>'}
        <label class="agree"><input type="checkbox" name="agree" required> 我已閱讀並同意以上須知</label>
        <div id="welcomemsg"></div>
        <button class="btn" type="submit">同意，開始使用</button>
      </form>
    </div>
  </div>`;
}

/* =========================================================
   圖卡集（依章節）：#cards/科目 → 總目錄；#cards/科目/章號 → 章節圖卡；點縮圖看大圖
   圖檔與清單放在 content/courses/{學期}/{科目}/cards/（cards.json），由 manifest.json 的 decks 登記
   ========================================================= */
const CARD_TAG_KIND = { '總複習': 'sum', '老師強調': 'hot', '易混淆': 'mix', '自我檢測': 'quiz', '補充': 'ext' };
const cardTagsHtml = tags => (tags || []).map(t => `<span class="ctag ${CARD_TAG_KIND[t] || ''}">${esc(t)}</span>`).join('');
const chapLabel = ch => `第 ${esc(ch.no)} 章`;
// 有這章的試題嗎（任一分類的章名開頭是同一個章號）
const chapHasExams = (c, no) => publishedExamsOf(c.id).some(e => examChapNo(shortExamTitle(e, c)) === String(no));

function deckChaptersHtml(c, d, compact) {
  return `<div class="deck-chaps${compact ? ' compact' : ''}">${d.chapters.map(ch => `
    <article class="deck-chap">
      <a class="dc-thumb" href="#cards/${c.id}/${esc(ch.no)}" aria-label="${chapLabel(ch)} ${esc(ch.title)}"><img src="${esc(ch.cover.thumb)}" alt="" loading="lazy"></a>
      <div class="dc-body">
        <span class="dc-no">${chapLabel(ch)}</span>
        <h4><a href="#cards/${c.id}/${esc(ch.no)}">${esc(ch.title)}</a></h4>
        ${ch.subtitle ? `<p class="dc-sub">${esc(ch.subtitle)}</p>` : ''}
        <p class="dc-meta">${ch.cards.length} 張圖卡${ch.date ? ' · ' + esc(ch.date) : ''}</p>
        <div class="dc-links">
          <a class="more-btn" href="#cards/${c.id}/${esc(ch.no)}">看圖卡<span class="arr" aria-hidden="true">›</span></a>
        </div>
      </div>
    </article>`).join('')}</div>`;
}

function cardsPage() {
  const c = getCourse(routeParts[1]);
  const d = c && deckOf(c.id);
  if (!c || !d) return `<p class="empty-note">這個科目還沒有依章節整理的圖卡。</p>`;
  const no = routeParts[2];
  // 圖卡總目錄就是科目頁
  if (!no) { courseTarget = c.id; history.replaceState(null, '', '#course/' + c.id); return coursePage(); }

  const i = d.chapters.findIndex(ch => ch.no === no);
  if (i < 0) return `<p class="empty-note">找不到這一章的圖卡。</p>`;
  const ch = d.chapters[i], prev = d.chapters[i - 1], next = d.chapters[i + 1];
  let n = 0;
  return `
  <h2 class="section chap-h2">${chapLabel(ch)}　${esc(ch.title)}${ch.subtitle ? ` <small>${esc(ch.subtitle)}</small>` : ''}</h2>
  <div class="sub-block">
  <div class="note-box chap-note"><span class="note-lab">使用方式</span>本章共 <strong>${ch.cards.length} 張圖卡</strong>，分 ${ch.groups.length} 組${ch.date ? `（上課日期 ${esc(ch.date)}）` : ''}。點縮圖可<strong>看大圖</strong>，大圖可左右滑動換張、點圖放大；${chapHasExams(c, ch.no) ? '看完後，頁面最下方可<strong>直接做這章的試題</strong>。' : '建議依分組順序閱讀。'}</div>
  ${ch.groups.map(g => `
  <section class="cgrp">
    <div class="cgrp-head"><span class="cgrp-name">${esc(g.name)}</span><span class="cgrp-count">${g.cards.length} 張${g.note ? `　${esc(g.note)}` : ''}</span></div>
    <div class="cgrid">${g.cards.map(x => `
      <button type="button" class="ccard" data-card="${n++}">
        <span class="cc-thumb"><img src="${esc(x.thumb)}" alt="" loading="lazy"></span>
        <span class="cc-text"><span class="cc-id">${esc(x.id)}</span><b>${esc(x.title)}</b>${x.tags.length ? `<span class="cc-tags">${cardTagsHtml(x.tags)}</span>` : ''}</span>
      </button>`).join('')}</div>
  </section>`).join('')}
  ${chapHasExams(c, ch.no) ? `
  <div class="chap-next">
    <div><b>看完這一章了嗎？</b><span>到學習試題做「${esc(ch.no)} ${esc(ch.title)}」的題目，檢查記住了多少。</span></div>
    <a class="more-btn" href="#examzone/${c.id}/${esc(ch.no)}">做這章的試題<span class="arr" aria-hidden="true">›</span></a>
  </div>` : ''}
  ${prev || next ? `<nav class="chap-pager" aria-label="上一章／下一章">
    ${prev ? `<a class="btn secondary" href="#cards/${c.id}/${esc(prev.no)}">‹ ${chapLabel(prev)} ${esc(prev.title)}</a>` : '<span></span>'}
    ${next ? `<a class="btn secondary" href="#cards/${c.id}/${esc(next.no)}">${chapLabel(next)} ${esc(next.title)} ›</a>` : '<span></span>'}
  </nav>` : ''}
  </div>`;
}

// 看大圖（共用）：章節圖卡頁、試題解析的「對照圖卡」都用這個
// list＝[{ id, title, img, chapterHref? }]；左右鍵／滑動換張；點圖切換原始大小；Esc 或 ✕ 關閉；不會換頁
let lbKeys = null;
function openCardViewer(list, start = 0, opts = {}) {
  closeCardViewer();
  if (!list.length) return;
  const box = document.createElement('div');
  box.className = 'lb'; box.id = 'lightbox';
  box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-label', '看大圖');
  box.innerHTML = `
    <div class="lb-bar">
      <span class="lb-count"></span><span class="lb-title"></span>
      <a class="lb-btn lb-chap" target="_blank" rel="noopener" hidden>整章圖卡 ↗</a>
      <a class="lb-btn lb-orig" target="_blank" rel="noopener">原圖</a>
      <button type="button" class="lb-btn lb-close" aria-label="關閉">✕</button>
    </div>
    <div class="lb-stage"><img class="lb-img" alt=""></div>
    ${list.length > 1 ? '<button type="button" class="lb-nav prev" aria-label="上一張">‹</button><button type="button" class="lb-nav next" aria-label="下一張">›</button>' : ''}
    <p class="lb-loading">原圖載入中…</p><p class="lb-hint">點圖放大／縮小${list.length > 1 ? ' · 左右滑動或方向鍵換張' : ''} · Esc 關閉</p>`;
  document.body.appendChild(box);
  document.body.classList.add('lb-open');
  const img = box.querySelector('.lb-img'), stage = box.querySelector('.lb-stage');
  let i = 0;
  const show = k => {
    i = (k + list.length) % list.length;
    const x = list[i];
    box.classList.remove('zoomed');
    // 大圖是無損原圖（約 2MB），先顯示縮圖，原圖載好再換上，手機上不會一片空白
    img.alt = x.title;
    if (x.thumb) {
      img.src = x.thumb; box.classList.add('loading');
      const full = new Image();
      full.onload = () => { if (list[i] === x) { img.src = x.img; box.classList.remove('loading'); } };
      full.src = x.img;
    } else img.src = x.img;
    box.querySelector('.lb-count').textContent = list.length > 1 ? `${i + 1} / ${list.length}` : '';
    box.querySelector('.lb-title').textContent = `${x.id}　${x.title}`;
    box.querySelector('.lb-orig').href = x.img;
    const chap = box.querySelector('.lb-chap');
    chap.hidden = !x.chapterHref; if (x.chapterHref) chap.href = x.chapterHref;
    stage.scrollTo(0, 0);
    [list[i + 1], list[i - 1]].forEach(y => { if (y) new Image().src = y.img; });   // 先載入前後兩張
    opts.onShow?.(i);
  };
  const back = document.activeElement;
  box.close = () => { box.remove(); document.body.classList.remove('lb-open'); lbKeys = null; opts.onClose?.(i); if (back && document.contains(back)) back.focus(); };
  box.querySelector('.lb-close').onclick = () => box.close();
  box.querySelector('.lb-nav.prev')?.addEventListener('click', () => show(i - 1));
  box.querySelector('.lb-nav.next')?.addEventListener('click', () => show(i + 1));
  img.onclick = () => box.classList.toggle('zoomed');
  stage.onclick = e => { if (e.target === stage && !box.classList.contains('zoomed')) box.close(); };
  // 左右滑動換張：只認「一根手指、快速、明顯水平」的滑動。
  // 兩指放大（含放大後放開其中一指）、畫面已被放大、點圖放大模式下拖曳看圖，都不換張，避免誤觸跳到別張
  let sx = 0, sy = 0, st = 0, multi = false;
  const pageZoomed = () => (window.visualViewport?.scale || 1) > 1.05;
  stage.addEventListener('touchstart', e => {
    if (e.touches.length > 1) { multi = true; return; }
    if (e.touches.length === 1) { multi = false; sx = e.touches[0].clientX; sy = e.touches[0].clientY; st = Date.now(); }
  }, { passive: true });
  stage.addEventListener('touchend', e => {
    if (e.touches.length > 0) return;            // 還有手指在螢幕上（兩指手勢進行中）
    const wasMulti = multi; multi = false;
    if (wasMulti || list.length < 2 || box.classList.contains('zoomed') || pageZoomed() || e.changedTouches.length !== 1) return;
    const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
    if (Date.now() - st < 600 && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 2) show(i + (dx < 0 ? 1 : -1));
  }, { passive: true });
  stage.addEventListener('touchcancel', () => { multi = false; }, { passive: true });
  lbKeys = e => {
    if (e.key === 'Escape') { e.preventDefault(); box.close(); }
    else if (list.length > 1 && e.key === 'ArrowRight') { e.preventDefault(); show(i + 1); }
    else if (list.length > 1 && e.key === 'ArrowLeft') { e.preventDefault(); show(i - 1); }
  };
  show(start);
  box.querySelector('.lb-close').focus();
}
function closeCardViewer() { document.getElementById('lightbox')?.close?.(); document.body.classList.remove('lb-open'); lbKeys = null; }
document.addEventListener('keydown', e => { if (lbKeys) lbKeys(e); });

// 依編號找圖卡（00-06 → 第 00 章第 06 張）；找不到回傳 null
function findCard(courseId, id) {
  const ch = (deckOf(courseId)?.chapters || []).find(x => x.no === String(id).split('-')[0]);
  const card = ch && ch.cards.find(x => x.id === id);
  return card ? { ...card, chapter: ch, chapterHref: `#cards/${courseId}/${ch.no}` } : null;
}

// 章節圖卡頁：點縮圖看大圖；網址 #cards/科目/章號/圖卡編號 直接打開那一張
function bindCards() {
  closeCardViewer();
  if (page !== 'cards' || !routeParts[2]) return;
  const c = getCourse(routeParts[1]);
  const ch = c && (deckOf(c.id)?.chapters || []).find(x => x.no === routeParts[2]);
  if (!ch) return;
  const open = k => openCardViewer(ch.cards, k, { onClose: last => document.querySelector(`[data-card="${last}"]`)?.focus() });
  document.querySelectorAll('[data-card]').forEach(b => b.onclick = () => open(Number(b.dataset.card)));
  const want = routeParts[3] && ch.cards.findIndex(x => x.id === routeParts[3]);
  if (want >= 0) { routeParts = routeParts.slice(0, 3); history.replaceState(null, '', `#cards/${c.id}/${ch.no}`); open(want); }
}

// 試題解析裡的「對照圖卡」：點了在原頁面打開大圖（不換頁）
document.addEventListener('click', e => {
  const b = e.target.closest('[data-cref]');
  if (!b) return;
  const box = b.closest('.q-cards');
  const refs = [...box.querySelectorAll('[data-cref]')];
  const list = refs.map(x => findCard(x.dataset.course, x.dataset.cref)).filter(Boolean);
  const k = list.findIndex(x => x.id === b.dataset.cref);
  if (k >= 0) openCardViewer(list, k);
});


/* =========================================================
   各頁的階層路線（麵包屑）：同步畫出來的頁面在這裡；試題、成績等載入後才知道名稱的頁面在 exams.js 裡各自加
   ========================================================= */
const ADMIN_TAB_NAME = { semesters: '學期管理', courses: '科目管理', items: '圖卡管理', exams: '試題管理', members: '成員管理', pages: '講義管理' };
function pageCrumbs() {
  const subj = c => [`${c.title}圖卡總目錄`, `#course/${c.id}`];
  switch (page) {
    case 'courses': return crumbsHtml([['學習科目']]);
    case 'course': { const c = getCourse(courseTarget); return crumbsHtml([['學習科目', '#courses'], c && [subj(c)[0]]]); }
    case 'cards': {
      const c = getCourse(routeParts[1]);
      if (!c) return crumbsHtml([['學習科目', '#courses']]);
      const ch = routeParts[2] && (deckOf(c.id)?.chapters || []).find(x => x.no === routeParts[2]);
      return crumbsHtml([['學習科目', '#courses'], ch ? subj(c) : [subj(c)[0]], ch && [`第 ${ch.no} 章 ${ch.title}`]]);
    }
    case 'examzone': return crumbsHtml([['學習試題']]);
    case 'items': return crumbsHtml([['學習科目', '#courses'], ['圖卡目錄']]);
    case 'detail': {
      const [type, id] = detailTarget;
      if (type === 'project') return crumbsHtml([['活動專案', '#projects'], [(data.projects.find(x => x.id == id) || {}).title || '內容']]);
      const i = data.items.find(x => x.id == id), c = i && getCourse(i.courseId);
      return crumbsHtml([['學習科目', '#courses'], c && subj(c), [i?.title || '內容']]);
    }
    case 'projects': return crumbsHtml([['活動專案']]);
    case 'about': return crumbsHtml([['關於本站']]);
    case 'account': return crumbsHtml([['我的帳號']]);
    case 'admin': return hasAdminAccess() ? crumbsHtml([['管理後台', '#admin'], [ADMIN_TAB_NAME[adminType] || '管理']]) : crumbsHtml([['管理後台']]);
    case 'editor': return crumbsHtml([['管理後台', '#admin'], ['講義編輯']]);
    default: return '';   // 首頁不用；試題、成績、出題、統計頁載入後自己加
  }
}
