/* =========================================================
   作業專區・共用科目選單（所有作業頁共用這一個檔案）
   ---------------------------------------------------------
   ★ 以後新增科目或作業，只要改下面的 HW_DATA 就好，
     不用改任何作業頁面。
   - 學期：id 學期代碼、name 全名、short 簡稱（選單按鈕上顯示）
           open: true 才會顯示；新的學期放在最前面
   - 科目：name 科目名稱、slug 資料夾英文名、works 作業清單
   - 作業：title 作業名稱、url 網址（以 /content/homework/ 開頭）

   選單依「學期」分開：上方的學期按鈕可切換學期，
   科目按鈕只列出目前選定學期的科目，學期再多選單也不會變長。
   ========================================================= */
const HW_DATA = [
  {
    id: '2026_y1s1', name: '2026 一年級上學期', short: '一上', open: true,
    subjects: [
      { name: '医学生物学', slug: 'medical-biology', works: [
        { title: '作业 · 答案卷', url: '/content/homework/2026_y1s1/medical-biology/answer-sheet.html' },
        { title: '染色体核型分析图 · 作答页', url: '/content/homework/2026_y1s1/medical-biology/karyotype-worksheet.html' },
      ] },
      { name: '人体解剖学', slug: 'anatomy', works: [] },
      { name: '组织学与胚胎学', slug: 'histology-embryology', works: [] },
      { name: '中医基础理论', slug: 'tcm-basic-theory', works: [] },
    ],
  },
  /* 下學期開學後，複製上面整段，改成例如：
  { id: '2026_y1s2', name: '2026 一年級下學期', short: '一下', open: true, subjects: [ ... ] },
  並放在最前面（新的學期排最上方）。
  其他簡稱：二上、二下、三上、三下、四上、四下、五上、五下 */
];

(function () {
  /* 網址正規化：Cloudflare Pages 會把 .html 去掉（/answer-sheet.html → /answer-sheet），
     index 頁也可能是 /資料夾/ 或 /資料夾/index；比對前兩邊都統一成同一種寫法 */
  const norm = p => {
    let x = String(p || '').split(/[?#]/)[0];
    try { x = decodeURIComponent(x); } catch (e) {}
    x = x.replace(/\.html$/i, '').replace(/\/index$/i, '/').replace(/\/+$/, '');
    return x || '/';
  };
  const here = norm(location.pathname);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sems = HW_DATA.filter(s => s.open);
  const isCur = w => here === norm(w.url);
  const semOfPage = sems.find(se => se.subjects.some(s => s.works.some(isCur)));
  const curSubj = semOfPage && semOfPage.subjects.find(s => s.works.some(isCur));
  const yearOf = se => (se.id || '').slice(0, 4);
  const label = se => `${yearOf(se)} ${se.short || se.name}`;
  let active = semOfPage || sems[0];
  const HW_HOME = '/content/homework/';
  /* 執業醫師考試科目：科目名稱含下列任一詞（簡、繁都列），就加「执医考科」標籤，和網站科目卡一致 */
  const EXAM_WORDS = ['中医基础理论','中醫基礎理論','中医诊断学','中醫診斷學','中药学','中藥學','方剂学','方劑學','针灸学','針灸學',
    '四大经典','四大經典','黄帝内经','黃帝內經','伤寒论','傷寒論','金匮要略','金匱要略','温病学','溫病學',
    '西医诊断学','西醫診斷學','西医内科学','西醫內科學','西医传染病学','西醫傳染病學',
    '中医内科学','中醫內科學','中医外科学','中醫外科學','中医妇科学','中醫婦科學','中医儿科学','中醫兒科學'];
  const isExam = s => EXAM_WORDS.some(w => String(s.name).includes(w));
  const examTag = s => isExam(s) ? '<span class="hw-exam">执医考科</span>' : '';
  const atHwHome = here === norm(HW_HOME);   // 作業專區首頁不需要「回作業專區」按鈕   // 目前選單顯示的學期：所在頁面的學期，否則最新學期
  // 可以左右滑的按鈕列：自動捲到目前選中的那一顆
  const reveal = root => (root || document).querySelectorAll('.hw-chips, .hwz-semrow, .hwz-years').forEach(box => {
    if (box.scrollWidth <= box.clientWidth + 2) return;
    const cur = box.querySelector('.cur, [aria-pressed="true"], [aria-selected="true"]');
    if (!cur) return;
    const b = box.getBoundingClientRect(), c = cur.getBoundingClientRect();
    box.scrollLeft += (c.left - b.left) - (b.width - c.width) / 2;
  });

  /* ---------- 樣式 ---------- */
  const css = `
  .hw-menu { border-top: 1px solid var(--line); background: var(--surface); }
  .hw-row { max-width: 1240px; margin: 0 auto; padding: 6px 20px; display: flex; align-items: center; gap: 8px; min-height: 46px; }
  .hw-back { flex: none; display: inline-flex; align-items: center; gap: 4px; padding: 6px 10px; border-radius: 6px; border: 1px solid var(--line); background: var(--bg); color: var(--ink); font-size: 14.5px; font-weight: 700; text-decoration: none; white-space: nowrap; }
  .hw-back:hover { border-color: var(--accent); color: var(--accent); }
  .hw-all { flex: none; display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 6px; border: 1px solid var(--accent); background: var(--accent); color: var(--accent-ink); font: inherit; font-size: 14.5px; font-weight: 700; cursor: pointer; }
  .hw-sembtn { flex: none; display: inline-flex; align-items: center; gap: 4px; padding: 6px 10px; border-radius: 6px; border: 1.5px solid var(--accent); background: var(--surface); color: var(--accent); font: inherit; font-size: 14.5px; font-weight: 700; cursor: pointer; white-space: nowrap; }
  .hw-sembtn .car { font-size: 11px; }
  .hw-sembtn[aria-expanded="true"] { background: var(--accent-soft); }
  .hw-sep { flex: none; width: 1px; height: 22px; background: var(--line); }
  .hw-chips { display: flex; gap: 6px; overflow-x: auto; scrollbar-width: none; min-width: 0; }
  .hw-chips::-webkit-scrollbar { display: none; }
  .hw-chip { flex: none; padding: 6px 12px; border-radius: 6px; border: 1px solid var(--line); background: var(--bg); color: var(--ink); font: inherit; font-size: 14.5px; font-weight: 600; cursor: pointer; white-space: nowrap; }
  .hw-chip:hover { background: var(--surface-2); }
  .hw-chip.cur { border-color: var(--accent); color: var(--accent); }
  .hw-chip[aria-expanded="true"] { background: var(--accent-soft); color: var(--accent-soft-ink); border-color: var(--accent); }
  .hw-panel { position: absolute; left: 0; right: 0; background: var(--surface); border-bottom: 1px solid var(--line); box-shadow: var(--shadow); max-height: 70vh; overflow: auto; }
  .hw-panel[hidden] { display: none; }
  .hw-panel-in { max-width: 1240px; margin: 0 auto; padding: 14px 20px 18px; }
  .hw-sem { font-size: 13px; font-weight: 700; color: var(--muted); letter-spacing: .1em; margin: 0 0 8px; }
  .hw-sem + .hw-grid { margin-bottom: 14px; }
  .hw-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 10px; }
  .hw-subj { padding: 10px 12px; border: 1px solid var(--line); border-radius: 6px; background: var(--bg); }
  .hw-exam { display: inline-block; margin-left: 6px; padding: 0 7px; border: 1px solid var(--red, #973d2f); border-radius: 6px; color: var(--red, #973d2f); font-size: 12px; font-weight: 600; line-height: 1.5; vertical-align: 2px; white-space: nowrap; }
  .hw-chip .hw-exam { margin-left: 5px; font-size: 11px; vertical-align: 1px; }
  .hw-subj h4 { margin: 0 0 6px; font-size: 16px; color: var(--accent); }
  .hw-subj ul { list-style: none; margin: 0; padding: 0; }
  .hw-subj li { margin: 2px 0; }
  .hw-subj a { display: block; padding: 5px 8px; border-radius: 4px; color: var(--ink); text-decoration: none; font-size: 15px; }
  .hw-subj a:hover { background: var(--surface-2); }
  .hw-subj a[aria-current="page"] { background: var(--accent); color: var(--accent-ink); font-weight: 700; }
  .hw-empty { padding: 5px 8px; color: var(--muted); font-size: 14px; }
  .hw-semlist { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 8px; }
  .hw-semlist button { width: 100%; text-align: left; padding: 10px 12px; border-radius: 6px; border: 1px solid var(--line); background: var(--bg); color: var(--ink); font: inherit; font-size: 15px; font-weight: 600; cursor: pointer; }
  .hw-semlist button:hover { border-color: var(--accent); }
  .hw-semlist button[aria-pressed="true"] { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); }
  .hw-semlist small { display: block; font-weight: 400; font-size: 13px; opacity: .8; }
  .hw-note { margin: 10px 0 0; font-size: 13px; color: var(--muted); }
  .hw-home { display: inline-block; margin-top: 12px; font-weight: 700; color: var(--accent); text-decoration: none; }
  html { scroll-padding-top: 128px !important; }
  .toc { top: 128px !important; max-height: calc(100vh - 148px) !important; }
  /* 浮動標題列：手機／平板往下捲時自動收起，往上捲就出現 */
  header { transition: transform .25s ease; will-change: transform; }
  header.hw-hidden { transform: translateY(-100%); box-shadow: none; }
  .hw-cur { display: none; }
  /* 手機：一列只放「←」和一顆大按鈕（目前科目 · 學期 ▾），點開是完整的科目／作業清單 */
  @media (max-width: 720px) {
    .hw-row { padding: 8px 14px; gap: 8px; }
    .hw-all, .hw-sembtn, .hw-sep, .hw-chips, .hw-back .t { display: none; }
    .hw-back { padding: 8px 12px; font-size: 16px; }
    .hw-cur { display: flex; flex: 1; min-width: 0; align-items: center; gap: 8px; padding: 8px 12px; border-radius: 6px; border: 1px solid var(--accent); background: var(--surface); color: var(--ink); font: inherit; font-size: 15px; cursor: pointer; text-align: left; }
    .hw-cur[aria-expanded="true"] { background: var(--accent-soft); }
    .hw-cur-t { font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
    .hw-cur-s { flex: none; font-size: 13px; color: var(--muted); }
    .hw-cur .car { margin-left: auto; color: var(--accent); font-size: 12px; }
    .hw-panel { max-height: calc(100vh - 140px); }
    .hw-panel-in { padding: 12px 14px 16px; }
    .hw-grid { grid-template-columns: 1fr; gap: 8px; }
    .hw-subj a { padding: 10px 10px; font-size: 16px; }
    .logo-sub { display: none !important; }
    .hw-menu-home { display: none; }
    html { scroll-padding-top: 120px !important; }
  }
  footer { text-align: center; }   /* 頁尾文字置中（與主站一致） */
  /* 作業專區首頁 */
  .hwz-years { display: flex; gap: 8px; margin: 18px 0 14px; overflow-x: auto; scrollbar-width: none; }
  .hwz-years::-webkit-scrollbar { display: none; }
  .hwz-year { flex: 1 0 auto; min-width: 80px; min-height: 58px; justify-content: center; padding: 8px 12px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: var(--ink); font: inherit; font-size: 16px; font-weight: 600; cursor: pointer; display: flex; flex-direction: column; align-items: center; line-height: 1.3; }
  .hwz-year small { font-size: 12px; color: var(--muted); font-weight: 400; }
  .hwz-year[aria-selected="true"] { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); }
  .hwz-year:disabled { opacity: .55; cursor: not-allowed; }
  .hwz-semrow { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; margin: 0 0 8px; }
  .hwz-sem { flex: none; align-self: stretch; display: inline-flex; align-items: center; padding: 0 12px 0 0; margin-right: 4px; border-right: 2px solid var(--accent); font-size: 15px; font-weight: 700; color: var(--ink); letter-spacing: .04em; }
  /* 科目按鈕：與主站一致（淡綠底＋綠框），選到＝實心綠 */
  .hwz-subj { display: inline-flex; align-items: center; gap: 6px; padding: 7px 14px; border: 1px solid color-mix(in srgb, var(--accent) 45%, transparent); border-radius: 6px; background: color-mix(in srgb, var(--accent) 16%, var(--surface)); color: var(--ink); font: inherit; font-size: 15px; font-weight: 600; cursor: pointer; white-space: nowrap; }
  .hwz-subj small { font-size: 12px; color: inherit; opacity: .75; font-weight: 400; }
  .hwz-subj:hover { border-color: var(--accent); }
  .hwz-subj.none { opacity: .6; }
  .hwz-subj[aria-pressed="true"] { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); opacity: 1; }
  .hwz-subj[aria-pressed="true"] small { color: var(--accent-ink); opacity: .85; }
  .hwz-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--red, #973d2f); display: inline-block; }
  .hwz-legend { display: flex; align-items: center; gap: 4px; margin: 0 0 12px; font-size: 12.5px; color: var(--muted); }
  .hwz-panel { padding: 16px 18px; border: 1px solid var(--line); border-radius: 10px; background: var(--surface); }
  .hwz-title { margin: 0 0 10px; font-size: 20px; font-weight: 700; font-family: "Noto Serif TC", "Noto Serif CJK TC", "Source Han Serif TC", "Songti TC", "STSong", "Songti SC", "SimSun", "PMingLiU", serif; display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; }
  .hwz-title small { margin-left: auto; font-size: 13px; font-weight: 400; color: var(--muted); }
  .hwz-list { display: grid; gap: 8px; }
  .hwz-work { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 12px 14px; border: 1px solid var(--line); border-left: 4px solid var(--accent); border-radius: 6px; background: var(--bg); color: var(--ink); text-decoration: none; font-size: 16px; }
  .hwz-work:hover { border-color: var(--accent); }
  .hwz-work span { color: var(--accent); }
  .hwz-empty { color: var(--muted); margin: 6px 0 0; }
  @media (max-width: 720px) {
    .hwz-semrow { flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none; }
    .hwz-semrow::-webkit-scrollbar { display: none; }
    .hwz-subj, .hwz-sem { flex: none; }
    .hwz-panel { padding: 14px; }
  }
  .hwz-select-wrap { display: none; position: relative; margin: 0 0 12px; }
  .hwz-select-wrap::after { content: "▾"; position: absolute; right: 14px; top: 50%; transform: translateY(-50%); color: var(--accent); pointer-events: none; }
  .hwz-select { appearance: none; -webkit-appearance: none; width: 100%; padding: 12px 36px 12px 14px; border: 1px solid var(--accent); border-radius: 6px; background: var(--surface); color: var(--ink); font: inherit; font-size: 16px; font-weight: 700; }
  @media (max-width: 720px) {
    .hwz-semrow { display: none; }
    .hwz-select-wrap { display: block; }
    .hwz-years { overflow: visible; gap: 6px; }
    .hwz-year { flex: 1 1 0; min-width: 0; min-height: 52px; padding: 6px 2px; font-size: 14.5px; }
    .hwz-year small { font-size: 11px; }
  }
  @media (prefers-reduced-motion: reduce) { header { transition: none; } }
  @media print { .hw-menu { display: none !important; } header.hw-hidden { transform: none; } }`;
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  /* ---------- 共用片段 ---------- */
  const workList = s => s.works.length
    ? '<ul>' + s.works.map(w => `<li><a href="${esc(w.url)}"${isCur(w) ? ' aria-current="page"' : ''}>${esc(w.title)}</a></li>`).join('') + '</ul>'
    : '<div class="hw-empty">尚无作业</div>';
  const subjBox = s => `<div class="hw-subj"><h4>${esc(s.name)}${examTag(s)}</h4>${workList(s)}</div>`;
  const countWorks = se => se.subjects.reduce((n, s) => n + s.works.length, 0);

  /* ---------- 選單 ---------- */
  const nav = document.getElementById('hw-menu');
  if (nav && atHwHome) nav.classList.add('hw-menu-home');   // 作業專區首頁：手機上不顯示（頁面本身就有年級／科目選擇）
  if (nav && active) {
    const render = () => {
      const allPanel = sems.map(se => `<p class="hw-sem">${esc(se.name)}</p><div class="hw-grid">${se.subjects.map(subjBox).join('')}</div>`).join('')
        + `<a class="hw-home" href="/content/homework/">→ 作业专区首页</a>`;
      const semPanel = `<p class="hw-sem">选择学期</p><ul class="hw-semlist">${sems.map((se, i) =>
          `<li><button type="button" data-sem="${i}" aria-pressed="${se === active}">${esc(label(se))}<small>${esc(se.name)} · ${se.subjects.length} 科 · ${countWorks(se)} 份作业</small></button></li>`).join('')}</ul>`
        + (sems.length < 2 ? '<p class="hw-note">其他学期开放后，会出现在这里。</p>' : '');
      nav.innerHTML = `
        <div class="hw-row">
          ${atHwHome ? '' : `<a class="hw-back" href="${HW_HOME}" title="回作业专区" aria-label="回作业专区">←<span class="t"> 作业专区</span></a>`}
          <button class="hw-all" type="button" aria-expanded="false" data-p="all">☰<span class="t"> 科目选单</span></button>
          <button class="hw-cur" type="button" aria-expanded="false" data-p="all"><span class="hw-cur-t">${esc(curSubj ? curSubj.name : '选择科目与作业')}</span><span class="hw-cur-s">${esc(label(active))}</span><span class="car">▾</span></button>
          <button class="hw-sembtn" type="button" aria-expanded="false" data-p="sem" title="${esc(active.name)}">${esc(label(active))}<span class="car">▾</span></button>
          <span class="hw-sep" aria-hidden="true"></span>
          <div class="hw-chips">${active.subjects.map((s, i) =>
            `<button class="hw-chip${s === curSubj ? ' cur' : ''}" type="button" aria-expanded="false" data-p="s${i}">${esc(s.name)}${examTag(s)}</button>`).join('')}</div>
        </div>
        <div class="hw-panel" id="hw-p-all" hidden><div class="hw-panel-in">${allPanel}</div></div>
        <div class="hw-panel" id="hw-p-sem" hidden><div class="hw-panel-in">${semPanel}</div></div>
        ${active.subjects.map((s, i) => `<div class="hw-panel" id="hw-p-s${i}" hidden><div class="hw-panel-in"><p class="hw-sem">${esc(active.name)}</p><div class="hw-grid">${subjBox(s)}</div></div></div>`).join('')}`;
      const btns = [...nav.querySelectorAll('[data-p]')];
      const close = () => { btns.forEach(b => b.setAttribute('aria-expanded', 'false')); nav.querySelectorAll('.hw-panel').forEach(p => p.hidden = true); };
      btns.forEach(b => b.addEventListener('click', e => {
        e.stopPropagation();
        const open = b.getAttribute('aria-expanded') === 'true';
        close();
        if (!open) { b.setAttribute('aria-expanded', 'true'); document.getElementById('hw-p-' + b.dataset.p).hidden = false; }
      }));
      nav.querySelectorAll('[data-sem]').forEach(b => b.addEventListener('click', e => {
        e.stopPropagation();
        active = sems[+b.dataset.sem];
        render();
        if (window.__hwAfterRender) window.__hwAfterRender(nav);   // 讓繁簡切換重新套用到新內容
      }));
      nav.__close = close;
      reveal(nav);
    };
    render();
    document.addEventListener('click', e => { if (!nav.contains(e.target) && nav.__close) nav.__close(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && nav.__close) nav.__close(); });
  }

  /* ---------- 浮動標題列（手機／平板，寬度 ≤ 960px） ----------
     往下捲：標題列＋科目選單收起，讓出畫面；往上捲：立刻出現。
     靠近頁面頂端、或選單面板打開時，一律顯示。 */
  const header = document.querySelector('header');
  if (header) {
    const small = matchMedia('(max-width: 960px)');
    let lastY = window.scrollY, ticking = false;
    const panelOpen = () => nav && [...nav.querySelectorAll('.hw-panel')].some(p => !p.hidden);
    const update = () => {
      ticking = false;
      const y = window.scrollY, dy = y - lastY;
      if (!small.matches || y < 80 || panelOpen()) header.classList.remove('hw-hidden');
      else if (dy > 6) header.classList.add('hw-hidden');
      else if (dy < -6) header.classList.remove('hw-hidden');
      if (Math.abs(dy) > 6 || y < 80) lastY = y;
    };
    addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
    small.addEventListener?.('change', update);
    header.addEventListener('focusin', () => header.classList.remove('hw-hidden'));
  }

  /* ---------- 作業首頁（/content/homework/）的清單 ---------- */
  const idx = document.getElementById('hw-index');
  /* 作業專區首頁：年級 → 科目 → 作業清單，一次只顯示一個科目，資料再多頁面也不會無限變長 */
  if (idx) {
    const YEARS = ['一年级', '二年级', '三年级', '四年级', '五年级'];
    const yearNo = se => Number((/_y(\d)s/.exec(se.id) || [])[1]) || 0;
    const openYears = new Set(sems.map(yearNo));
    let curYear = Math.max(0, ...openYears);          // 預設最新的年級
    let curKey = '';                                   // 目前選的科目：學期代碼|科目代碼
    const key = (se, s) => se.id + '|' + (s.slug || s.name);
    const half = se => /s2$/.test(se.id) ? '下学期' : '上学期';   // 年級已在上方選好，這裡只標上／下學期
    const draw = () => {
      const inYear = sems.filter(se => yearNo(se) === curYear).slice().reverse();   // 上學期在前
      const all = inYear.flatMap(se => se.subjects.map(s => ({ se, s })));
      let cur = all.find(x => key(x.se, x.s) === curKey) || all.find(x => x.s.works.length) || all[0];
      if (cur) curKey = key(cur.se, cur.s);
      idx.innerHTML = `
        <div class="hwz-years" role="tablist">${YEARS.map((n, i) => {
          const y = i + 1, ok = openYears.has(y);
          return `<button type="button" role="tab" class="hwz-year" data-hwz-year="${y}" aria-selected="${y === curYear}" ${ok ? '' : 'disabled'}>${n}${ok ? '' : '<small>尚未开课</small>'}</button>`;
        }).join('')}</div>
        ${inYear.map(se => `<div class="hwz-semrow"><span class="hwz-sem">${half(se)}</span>${se.subjects.map(s =>
          `<button type="button" class="hwz-subj${s.works.length ? '' : ' none'}" data-hwz-subj="${esc(key(se, s))}" aria-pressed="${key(se, s) === curKey}">${esc(s.name)}<small>${s.works.length}</small></button>`).join('')}</div>`).join('')}
        <label class="hwz-select-wrap"><select class="hwz-select" aria-label="科目">${inYear.map(se => `<optgroup label="${half(se)}">${se.subjects.map(s =>
          `<option value="${esc(key(se, s))}" ${key(se, s) === curKey ? 'selected' : ''}>${esc(s.name)}（${s.works.length}）</option>`).join('')}</optgroup>`).join('')}</select></label>
        ${cur ? `<div class="hwz-panel">
          <div class="hwz-title" role="heading" aria-level="3">${esc(cur.s.name)}${examTag(cur.s)}<small>${esc(cur.se.name)}</small></div>
          ${cur.s.works.length ? `<div class="hwz-list">${cur.s.works.map(w => `<a class="hwz-work" href="${esc(w.url)}">${esc(w.title)}<span aria-hidden="true">→</span></a>`).join('')}</div>`
            : '<p class="hwz-empty">这个科目还没有作业。</p>'}
        </div>` : '<p class="hwz-empty">目前没有开放的学期。</p>'}`;
      idx.querySelectorAll('[data-hwz-year]').forEach(b => b.onclick = () => { curYear = Number(b.dataset.hwzYear); curKey = ''; draw(); });
      idx.querySelectorAll('[data-hwz-subj]').forEach(b => b.onclick = () => { curKey = b.dataset.hwzSubj; draw(); });
      const sel = idx.querySelector('.hwz-select'); if (sel) sel.onchange = () => { curKey = sel.value; draw(); };
      if (window.__hwAfterRender) window.__hwAfterRender(idx);   // 首頁會把簡體字轉成繁體
      reveal(idx);
    };
    draw();
  }
})();
