/* =========================================================
   作業專區・共用科目選單（所有作業頁共用這一個檔案）
   ---------------------------------------------------------
   ★ 以後新增科目或作業，只要改下面的 HW_DATA 就好，
     不用改任何作業頁面。
   - 學期：open: true 才會顯示；新的學期放在最前面
   - 科目：name 科目名稱、slug 資料夾英文名、works 作業清單
   - 作業：title 作業名稱、url 網址（以 /content/homework/ 開頭）
   ========================================================= */
const HW_DATA = [
  {
    id: '2026_y1s1', name: '2026 一年級上學期', open: true,
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
  /* 下學期開學後，複製上面整段改成：
  { id: '2026_y1s2', name: '2026 一年級下學期', open: true, subjects: [ ... ] },
  並放在最前面（新的學期排最上方）。 */
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
  const sem = sems[0];
  const isCur = w => here === norm(w.url);
  const curSubj = sem && sem.subjects.find(s => s.works.some(isCur));

  /* ---------- 樣式 ---------- */
  const css = `
  .hw-menu { border-top: 1px solid var(--line); background: var(--surface); }
  .hw-row { max-width: 1240px; margin: 0 auto; padding: 6px 20px; display: flex; align-items: center; gap: 8px; min-height: 46px; }
  .hw-all { flex: none; display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 8px; border: 1px solid var(--accent); background: var(--accent); color: var(--accent-ink); font: inherit; font-size: 14.5px; font-weight: 700; cursor: pointer; }
  .hw-chips { display: flex; gap: 6px; overflow-x: auto; scrollbar-width: none; min-width: 0; }
  .hw-chips::-webkit-scrollbar { display: none; }
  .hw-chip { flex: none; padding: 6px 12px; border-radius: 999px; border: 1px solid var(--line); background: var(--bg); color: var(--ink); font: inherit; font-size: 14.5px; font-weight: 600; cursor: pointer; white-space: nowrap; }
  .hw-chip:hover { background: var(--surface-2); }
  .hw-chip.cur { border-color: var(--accent); color: var(--accent); }
  .hw-chip[aria-expanded="true"] { background: var(--accent-soft); color: var(--accent-soft-ink); border-color: var(--accent); }
  .hw-panel { position: absolute; left: 0; right: 0; background: var(--surface); border-bottom: 1px solid var(--line); box-shadow: var(--shadow); max-height: 70vh; overflow: auto; }
  .hw-panel[hidden] { display: none; }
  .hw-panel-in { max-width: 1240px; margin: 0 auto; padding: 14px 20px 18px; }
  .hw-sem { font-size: 13px; font-weight: 700; color: var(--muted); letter-spacing: .1em; margin: 0 0 8px; }
  .hw-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 10px; }
  .hw-subj { padding: 10px 12px; border: 1px solid var(--line); border-radius: 10px; background: var(--bg); }
  .hw-subj h4 { margin: 0 0 6px; font-size: 16px; color: var(--accent); }
  .hw-subj ul { list-style: none; margin: 0; padding: 0; }
  .hw-subj li { margin: 2px 0; }
  .hw-subj a { display: block; padding: 5px 8px; border-radius: 6px; color: var(--ink); text-decoration: none; font-size: 15px; }
  .hw-subj a:hover { background: var(--surface-2); }
  .hw-subj a[aria-current="page"] { background: var(--accent); color: var(--accent-ink); font-weight: 700; }
  .hw-empty { padding: 5px 8px; color: var(--muted); font-size: 14px; }
  .hw-home { display: inline-block; margin-top: 12px; font-weight: 700; color: var(--accent); text-decoration: none; }
  html { scroll-padding-top: 128px !important; }
  .toc { top: 128px !important; max-height: calc(100vh - 148px) !important; }
  @media (max-width: 720px) {
    .hw-row { padding: 6px 14px; }
    .hw-all .t { display: none; }
    html { scroll-padding-top: 120px !important; }
  }
  @media print { .hw-menu { display: none !important; } }`;
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  /* ---------- 選單內容 ---------- */
  const workList = s => s.works.length
    ? '<ul>' + s.works.map(w => `<li><a href="${esc(w.url)}"${isCur(w) ? ' aria-current="page"' : ''}>${esc(w.title)}</a></li>`).join('') + '</ul>'
    : '<div class="hw-empty">尚无作业</div>';
  const subjBox = s => `<div class="hw-subj"><h4>${esc(s.name)}</h4>${workList(s)}</div>`;
  const allPanel = sems.map(se => `<p class="hw-sem">${esc(se.name)}</p><div class="hw-grid">${se.subjects.map(subjBox).join('')}</div>`).join('')
    + `<a class="hw-home" href="/content/homework/">→ 作业专区首页</a>`;

  const nav = document.getElementById('hw-menu');
  if (nav && sem) {
    nav.innerHTML = `
      <div class="hw-row">
        <button class="hw-all" type="button" aria-expanded="false" data-p="all">☰<span class="t"> 科目选单</span></button>
        <div class="hw-chips">${sem.subjects.map((s, i) =>
          `<button class="hw-chip${s === curSubj ? ' cur' : ''}" type="button" aria-expanded="false" data-p="s${i}">${esc(s.name)}</button>`).join('')}</div>
      </div>
      <div class="hw-panel" id="hw-p-all" hidden><div class="hw-panel-in">${allPanel}</div></div>
      ${sem.subjects.map((s, i) => `<div class="hw-panel" id="hw-p-s${i}" hidden><div class="hw-panel-in"><p class="hw-sem">${esc(sem.name)}</p><div class="hw-grid">${subjBox(s)}</div></div></div>`).join('')}`;
    const btns = [...nav.querySelectorAll('[data-p]')];
    const close = () => { btns.forEach(b => b.setAttribute('aria-expanded', 'false')); nav.querySelectorAll('.hw-panel').forEach(p => p.hidden = true); };
    btns.forEach(b => b.addEventListener('click', e => {
      e.stopPropagation();
      const open = b.getAttribute('aria-expanded') === 'true';
      close();
      if (!open) { b.setAttribute('aria-expanded', 'true'); document.getElementById('hw-p-' + b.dataset.p).hidden = false; }
    }));
    document.addEventListener('click', e => { if (!nav.contains(e.target)) close(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  }

  /* ---------- 作業首頁（/homework/）的清單 ---------- */
  const idx = document.getElementById('hw-index');
  if (idx) idx.innerHTML = sems.map(se => `<h3 class="hw-idx-sem">${esc(se.name)}</h3><div class="hw-grid hw-idx">${se.subjects.map(subjBox).join('')}</div>`).join('');
})();
