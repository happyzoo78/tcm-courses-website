/* core.js：資料讀取、登入狀態、共用小工具、網址與頁面狀態
   載入順序：core.js → pages.js → admin.js → app.js（順序不能改） */

/* =========================================================
   一、資料來源：Cloudflare D1 雲端資料庫（透過 /api/content 讀取）
   ========================================================= */
let data = { courses: [], items: [], projects: [], semesters: [], pages: [] };
let loadState = 'loading';   // loading 載入中 | ready 完成 | error 失敗 | login 需要登入
let loadError = '';
let admin = null;            // 目前登入的使用者（含權限）；null＝未登入
let adminFlash = '';         // 管理後台的提示訊息（例如「已儲存」）
let loginNotice = '';
let resetToken = '';         // 信裡「設定新密碼」連結帶的代碼（#reset/代碼）        // 登入畫面上要顯示的提示
let members = null;          // 成員名單（只有擁有者會載入）
let membersLoading = false;

// 呼叫後端 API 的共用函式：自動處理 JSON 與錯誤訊息
async function api(path, options = {}) {
  const opts = { method: 'GET', credentials: 'same-origin', ...options, headers: {} };
  if (options.body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(options.body);
  }
  let res;
  try {
    res = await fetch(path, opts);
  } catch {
    throw Object.assign(new Error('網路連線失敗，請檢查網路後再試一次。'), { status: 0 });
  }
  let body = null;
  try { body = await res.json(); } catch {}
  if (!res.ok) {
    throw Object.assign(new Error(body?.error || `伺服器錯誤（${res.status}）`), { status: res.status });
  }
  return body;
}

// 把伺服器的錯誤轉成看得懂的中文
function friendly(err) {
  if (err.status === 401) return '登入已過期，請重新登入。';
  if (err.status === 403) return '你的帳號沒有這項權限。';
  if (err.status === 413) return '資料太大，請改用較小的圖片。';
  if (err.status === 429) return '登入失敗次數太多，請 15 分鐘後再試。';
  if (err.status >= 500 && !/[一-鿿]/.test(err.message)) return '伺服器暫時無法處理，請稍後再試。';
  return err.message;
}

// 回到登入畫面（例如登入過期、登出）
function showLogin(notice = '') {
  admin = null;
  data = { courses: [], items: [], projects: [], semesters: [], pages: [] };
  members = null;
  loginNotice = notice;
  loadState = 'login';
  render();
}

// Claude 代為上傳到 content/courses/ 的網頁清單（manifest.json）；讀不到就當作沒有
let extraFiles = [];
async function loadExtraFiles() {
  try {
    const res = await fetch('/content/courses/manifest.json', { credentials: 'same-origin', cache: 'no-store' });
    const j = res.ok ? await res.json() : null;
    extraFiles = Array.isArray(j?.files) ? j.files.filter(f => f && f.path && f.title) : [];
    examCatRegistry = Array.isArray(j?.examCategories) ? j.examCategories.filter(x => x && x.code && x.name) : [];
    await Promise.all([
      loadDecks(Array.isArray(j?.decks) ? j.decks.filter(d => d && d.path) : []),
      loadSyllabi(Array.isArray(j?.syllabi) ? j.syllabi.filter(d => d && d.path) : [])
    ]);
  } catch { extraFiles = []; }
}

// 依章節整理的圖卡集（manifest.json 的 decks → 各科 cards.json）；讀不到的就略過
let decks = [];
async function loadDecks(list) {
  const got = await Promise.all(list.map(async d => {
    try {
      const res = await fetch(d.path, { credentials: 'same-origin', cache: 'no-store' });
      const j = res.ok ? await res.json() : null;
      if (!j || !Array.isArray(j.chapters)) return null;
      const base = d.path.replace(/[^/]*$/, '');
      const v = encodeURIComponent(j.version || '');
      const chapters = j.chapters.filter(ch => ch && ch.no && Array.isArray(ch.groups)).map(ch => {
        const groups = ch.groups.map(g => ({ name: g.name || '', note: g.note || '',
          cards: (g.cards || []).filter(x => x && x.id).map(x => ({ ...x, tags: x.tags || [],
            img: `${base}${x.id}.webp?v=${v}`, thumb: `${base}thumb/${x.id}.webp?v=${v}` })) })).filter(g => g.cards.length);
        const cards = groups.flatMap(g => g.cards);
        const cover = cards.find(x => x.id === ch.cover) || cards[0];
        return { ...ch, groups, cards, cover };
      }).filter(ch => ch.cards.length);
      return { ...d, title: j.title || '', version: j.version || '', chapters };
    } catch { return null; }
  }));
  decks = got.filter(Boolean);
}
/* ---------- 試題分類與章節表（全站共用規範，2026-10-30） ----------
   分類：manifest.json 的 examCategories（課堂練習／期末重點／全章模擬考…），各科可在章節表 categories 增加自己的分類
   章節表：各科 syllabus.json，試題與圖卡都只認章號；章名、節名從表上帶出 */
let examCatRegistry = [];
let syllabi = [];
async function loadSyllabi(list) {
  const got = await Promise.all(list.map(async d => {
    try {
      const res = await fetch(d.path, { credentials: 'same-origin', cache: 'no-store' });
      const j = res.ok ? await res.json() : null;
      return j && Array.isArray(j.chapters) ? { ...d, ...j, chapters: j.chapters.filter(ch => ch && ch.no) } : null;
    } catch { return null; }
  }));
  syllabi = got.filter(Boolean);
}
const matchCourseFile = (list, courseId) => {
  const c = getCourse(courseId);
  return c ? list.find(d => d.semester === c.semesterCode && ((c.slug && d.course === c.slug) || d.courseTitle === c.title)) || null : null;
};
const syllabusOf = courseId => matchCourseFile(syllabi, courseId);
// 這個科目可用的分類（全站共用＋該科自訂），依顯示順序
// 分類表的 scope："bank"＝只用在執醫考題，沒寫＝一般科目
function examCatsOf(courseId) {
  const extra = (syllabusOf(courseId)?.categories || []).filter(x => x && x.code && x.name);
  const bank = isBankCourse(getCourse(courseId));
  return [...examCatRegistry.filter(x => (x.scope === 'bank') === bank && !extra.some(y => y.code === x.code)), ...extra];
}
// 把資料庫裡的分類名稱（含舊名稱）對到標準分類；對不到就回傳 null
function examCatDef(courseId, name) {
  const n = String(name || '').trim();
  return examCatsOf(courseId).find(x => x.name === n || x.code === n || (x.aliases || []).includes(n)) || null;
}
const examCatName = (courseId, name) => examCatDef(courseId, name)?.name || String(name || '').trim();
function examCatNoteOf(courseId, name) {
  const d = examCatDef(courseId, name);
  if (!d) return '';
  return syllabusOf(courseId)?.categoryNotes?.[d.code] || d.note || '';
}
// 章節表查章、節（章號、節號都用兩位數字字串）
const pad2 = n => String(n).padStart(2, '0');
const sylChapter = (courseId, no) => (syllabusOf(courseId)?.chapters || []).find(ch => ch.no === pad2(no)) || null;
const sylSection = (courseId, no, sec) => (sylChapter(courseId, no)?.sections || []).find(x => x.no === pad2(sec)) || null;

// 某科目的圖卡集（依學期＋英文代碼對應，代碼對不上時用科目名稱）
const deckOf = courseId => {
  const c = getCourse(courseId);
  if (!c) return null;
  return decks.find(d => d.semester === c.semesterCode && ((c.slug && d.course === c.slug) || d.courseTitle === c.title)) || null;
};
const deckCardCount = courseId => (deckOf(courseId)?.chapters || []).reduce((n, ch) => n + ch.cards.length, 0);

async function loadContent() {
  try {
    const [d] = await Promise.all([api('/api/content'), loadExtraFiles()]);
    data = sortCourses(d);
    loadState = 'ready';
  } catch (err) {
    if (err.status === 401) return showLogin('登入已過期，請重新登入。');
    loadState = 'error';
    loadError = friendly(err);
  }
  render();
}

// Google 登入後跳回本站時，網址會帶著結果；讀取後把網址清乾淨
const LOGIN_ERRORS = {
  not_allowed: e => `這個 Google 帳號（${e}）還沒有被加入名單。請把這個 Gmail 提供給網站管理者，加入後再登入。`,
  suspended: () => '這個帳號已被停用。如有疑問，請聯絡網站管理者。',
  cancelled: () => '已取消 Google 登入。',
  expired: () => '登入逾時，請再按一次「使用 Google 帳號登入」。',
  google: () => 'Google 登入失敗，請再試一次。',
  not_configured: () => 'Google 登入尚未設定完成，目前請使用管理員密碼登入。',
  server: () => '伺服器暫時無法處理，請稍後再試。'
};
function readLoginResult() {
  const url = new URL(location.href);
  const code = url.searchParams.get('login_error');
  const ok = url.searchParams.get('login') === 'ok';
  if (code) loginNotice = (LOGIN_ERRORS[code] || LOGIN_ERRORS.google)(url.searchParams.get('email') || '');
  if (code || ok || url.searchParams.has('openExternalBrowser')) {
    let hash = location.hash;
    if (ok) { // 回到登入前所在的頁面
      try { hash = sessionStorage.getItem('tcm-return') || hash; sessionStorage.removeItem('tcm-return'); } catch {}
    }
    history.replaceState(null, '', location.pathname + hash);
  }
}

// 開啟網站時：先確認登入狀態，有登入才載入內容
async function boot() {
  // 從信裡的連結進來：直接顯示「設定新密碼」，不用先登入
  const rt = /^#reset\/([A-Za-z0-9_-]{30,60})$/.exec(location.hash);
  if (rt) { resetToken = rt[1]; admin = null; loadState = 'login'; return render(); }
  loadState = 'loading';
  render();
  try {
    admin = (await api('/api/me')).admin;
  } catch (err) {
    loadState = 'error';
    loadError = friendly(err);
    return render();
  }
  if (!admin) return showLogin(loginNotice);
  loginNotice = '';
  readHash();
  await loadContent();
}

/* 太極圖：自己繪製，顏色跟著網站配色（手機不會變成彩色 emoji） */
const TAIJI = '<svg class="taiji" viewBox="0 0 100 100" aria-hidden="true">'
  + '<circle class="yang" cx="50" cy="50" r="47"/>'
  + '<path class="yin" d="M50 3 A47 47 0 0 1 50 97 A23.5 23.5 0 0 1 50 50 A23.5 23.5 0 0 0 50 3 Z"/>'
  + '<circle class="yin" cx="50" cy="26.5" r="7"/><circle class="yang" cx="50" cy="73.5" r="7"/>'
  + '<circle class="ring" cx="50" cy="50" r="47"/></svg>';

/* 小工具 */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cut = (s, n) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n) + '…' : s; };
const getCourse = id => data.courses.find(c => c.id == id);
// 階層路線（麵包屑）：首頁 › 學習科目 › 中醫基礎理論圖卡總目錄 › 第 00 章 緒論
// list＝[[文字, 網址], …]，最後一項是目前所在頁面（不加連結）
function crumbsHtml(list) {
  const all = [['首頁', '#home'], ...list.filter(Boolean)];
  return `<nav class="crumbs" aria-label="目前位置"><ol>${all.map(([t, h], i) => i === all.length - 1
    ? `<li aria-current="page">${esc(t)}</li>`
    : `<li><a href="${esc(h)}">${esc(t)}</a></li>`).join('')}</ol></nav>`;
}
const courseName = id => getCourse(id)?.title || '未分類';
const byDateDesc = (a, b) => String(b.date || '').localeCompare(String(a.date || ''));

/* 中醫執業醫師考試科目：同一學期裡排在最前面，依下面的順序
   比對科目名稱（去掉空白、簡體字也能對上）。要調整就改這張表 */
const EXAM_SUBJECTS = [
  ['中醫基礎理論', '中医基础理论'],
  ['中醫診斷學', '中医诊断学'],
  ['中藥學', '中药学'],
  ['方劑學', '方剂学'],
  ['針灸學', '针灸学'],
  ['四大經典', '四大经典', '黃帝內經', '黄帝内经', '內經', '内经', '傷寒論', '伤寒论', '金匱要略', '金匮要略', '溫病學', '温病学'],
  ['西醫診斷學', '西医诊断学', '診斷學基礎', '诊断学基础'],
  ['西醫內科學', '西医内科学'],
  ['西醫傳染病學', '西医传染病学', '傳染病學', '传染病学'],
  ['中醫內科學', '中医内科学'],
  ['中醫外科學', '中医外科学'],
  ['中醫婦科學', '中医妇科学'],
  ['中醫兒科學', '中医儿科学']
];
function examRank(title) {
  const t = String(title || '').replace(/\s+/g, '');
  const i = EXAM_SUBJECTS.findIndex(names => names.includes(t));
  return i < 0 ? Infinity : i;
}
const isExamSubject = c => examRank(c.title) !== Infinity;
// 考科在前（依上表順序），其他科目依建立順序
function sortCourses(d) {
  d.courses = [...(d.courses || [])].sort((a, b) => {
    const ra = examRank(a.title), rb = examRank(b.title);
    return ra === rb ? a.id - b.id : (ra === Infinity ? 1 : rb === Infinity ? -1 : ra - rb);
  });
  return d;
}

/* 學期、科目、網頁 */
const getSemester = code => (data.semesters || []).find(s => s.code === code);
const semesterLabel = code => getSemester(code)?.label || code || '';
// 開放中的學期，新的在前
const visibleSemesters = () => (data.semesters || []).filter(s => s.visible).sort((a, b) => b.sortOrder - a.sortOrder);
const coursesIn = code => data.courses.filter(c => c.semesterCode === code);
const pagesOf = courseId => (data.pages || []).filter(p => p.courseId == courseId)
  .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
// 某科目在 content/courses/ 裡的網頁（依學期代碼＋英文代碼對應）
const filesOf = courseId => {
  const c = getCourse(courseId);
  if (!c || !c.slug) return [];
  return extraFiles.filter(f => f.semester === c.semesterCode && f.course === c.slug);
};
// 資料庫單張圖卡（後台「圖卡管理」）前台暫時隱藏（擁有者 2026-10-30）：科目頁「其他圖卡」、首頁圖卡架／最新更新／圖卡數都不顯示。
// 要恢復顯示，把 false 改成 true。後台照常可以管理。
const SHOW_DB_ITEMS = false;
const itemsOf = courseId => SHOW_DB_ITEMS ? data.items.filter(i => i.courseId == courseId) : [];
const publishedExamsOf = courseId => (data.exams || []).filter(e => e.courseId == courseId && e.published);
// 目前的帳號能不能管理某個科目的網頁（擁有者、管理員、該科目負責人）
const canEditCourseUI = id => !!admin && (admin.canManageCourses || (admin.ownedCourseIds || []).includes(Number(id)));
const editableCourses = () => data.courses.filter(c => canEditCourseUI(c.id));
// 能不能進管理後台：編輯者以上，或是任一科目的負責人
const hasAdminAccess = () => !!admin && (admin.canWrite || (admin.ownedCourseIds || []).length > 0);
const fmtSize = n => n >= 1048576 ? (n / 1048576).toFixed(2) + ' MB' : Math.max(1, Math.round((n || 0) / 1024)) + ' KB';

/* =========================================================
   三、頁面狀態與網址（網址會跟著頁面改變，可用「上一頁」）
   #home  #account  #editor/new/科目編號  #editor/網頁編號
   #exam/考卷編號  #attempt/作答編號  #examedit/new/科目編號  #examedit/考卷編號  #examstats/考卷編號  #courses  #course/科目編號  #items/科目編號  #projects  #about  #admin
   #detail/item/編號  #detail/project/編號
   #cards/科目編號（圖卡總目錄）  #cards/科目編號/章號（章節圖卡）  #examzone/科目編號/章號（學習試題直接跳到該章）
   ========================================================= */
const PAGES = ['home', 'courses', 'course', 'cards', 'items', 'projects', 'detail', 'about', 'admin', 'account', 'editor', 'exam', 'attempt', 'retry', 'examedit', 'examstats', 'examzone'];
let page = 'home', filter = 'all', query = '', adminType = 'pages', detailTarget = ['item', 0], courseTarget = 0;
let pagesCourse = 0;
let accountFrom = '#home';      // 進入「我的帳號」前所在的頁面（返回按鈕用）
let editorTarget = ['new', 0];
let routeParts = [];             // 目前網址拆開後的各段（模擬考題頁面使用）   // 網站內編輯器：['new', 科目編號] 或 ['page', 網頁編號]   // 後台「網頁管理」目前選的科目
const app = document.getElementById('app');

function readHash() {
  const parts = decodeURIComponent(location.hash.slice(1)).split('/');
  page = PAGES.includes(parts[0]) ? parts[0] : 'home';
  routeParts = parts;
  if (page === 'items') filter = parts[1] || 'all';
  if (page === 'course') courseTarget = parts[1];
  if (page === 'editor') editorTarget = parts[1] === 'new' ? ['new', parts[2]] : ['page', parts[1]];
  if (page === 'admin' && parts[1]) { adminType = parts[1]; if (parts[2]) pagesCourse = Number(parts[2]) || 0; }
  if (page === 'detail') detailTarget = [parts[1] === 'project' ? 'project' : 'item', parts[2]];
}


/* =========================================================
   全站共用導覽元件（設計語言統一）
   第一層 年級：year-tab（文字＋底線；後台在後台分頁之下改為方塊）
   第二層 科目：subj-chip（圓角膠囊，前面標學期）
   第三層 分類：ex-cat（文字＋底線，用「｜」隔開）
   第四層 章節：ex-ch（膠囊，放在內嵌小框 exnav-chaps 裡）
   ========================================================= */
const YEAR_NAMES = ['一年級', '二年級', '三年級', '四年級', '五年級'];
let siteYear = 0;   // 目前選的年級，各頁共用；0＝自動選最新的
// 執醫考題：不屬於任何學期的獨立題庫，資料庫裡是一個特別的「學期」zy_bank，在年級分頁裡當第 6 個分頁（只在學習試題、後台出現）
const BANK_SEM = 'zy_bank', BANK_YEAR = 6, BANK_NAME = '執醫考題';
const yearOf = code => code === BANK_SEM ? BANK_YEAR : Number((/_y(\d)s/.exec(code || '') || [])[1]) || 0;
const isBankCourse = c => !!c && c.semesterCode === BANK_SEM;
const latestRegularYear = years => Math.max(0, ...[...years].filter(y => y !== BANK_YEAR)) || Math.max(0, ...years);
// 學期短名稱：2026_y1s1 → 2026 一上
function shortSemLabel(code) {
  const m = /^(\d{4})_y(\d)s(\d)$/.exec(code || '');
  if (code === BANK_SEM) return BANK_NAME;
  return m ? `${m[1]} ${'一二三四五'[m[2] - 1] || m[2]}${m[3] === '1' ? '上' : '下'}` : semesterLabel(code);
}
// 年級分頁；openYears＝可以點的年級（前台：同學看得到的年級）
// sub(y)：有給時每個年級都可以點，小字改顯示 sub(y) 的內容（後台用，例如「0 張圖卡」）
// bank：多一個「執醫考題」分頁（學習試題、後台用）
function yearTabsHtml(openYears, sub, bank = false) {
  if (sub) {
    // 還沒選過年級時，停在有資料的最新年級（都沒有就一年級）
    if (!siteYear) siteYear = openYears.size ? latestRegularYear(openYears) || 1 : 1;
    openYears = new Set([1, 2, 3, 4, 5, ...(bank ? [BANK_YEAR] : [])]);
  }
  if (!bank) openYears = new Set([...openYears].filter(y => y !== BANK_YEAR));
  if (!openYears.has(siteYear)) siteYear = latestRegularYear(openYears);
  const names = bank ? [...YEAR_NAMES, BANK_NAME] : YEAR_NAMES;
  return `
  <div class="year-tabs" role="tablist" aria-label="年級">
    ${names.map((n, i) => {
      const y = i + 1, open = openYears.has(y);
      const note = sub ? sub(y) : (open ? '' : '尚未開放');
      return `<button type="button" role="tab" class="year-tab" data-site-year="${y}" aria-selected="${y === siteYear}" ${open ? '' : 'disabled title="同學目前看不到這個年級（可到後台「學期管理」打開）"'}>${n}${note ? `<small>${esc(note)}</small>` : ''}</button>`;
    }).join('')}
  </div>`;
}
// 目前年級的學期（上學期在前）
const semestersOfYear = (sems, y) => sems.filter(s => yearOf(s.code) === y).sort((a, b) => a.sortOrder - b.sortOrder);
// 科目膠囊列：每個學期一列
function subjChipsHtml(sems, curId, count, attr) {
  const rows = sems.map(sm => {
    const list = coursesIn(sm.code);
    if (!list.length) return '';
    return `<div class="subj-row"><span class="subj-sem">${sm.code === BANK_SEM ? '考科' : /s2$/.test(sm.code) ? '下學期' : '上學期'}</span>
      ${list.map(x => `<button type="button" class="subj-chip${count(x) ? '' : ' none'}" ${attr}="${x.id}" aria-pressed="${x.id === curId}">${esc(x.title)}<small>${count(x)}</small></button>`).join('')}</div>`;
  }).join('');
  // 手機：改用下拉選單（系統原生，好點、不會被切掉）
  const select = `<label class="subj-select-wrap"><span class="sr-only">科目</span>
    <select class="subj-select" data-subj-select="${attr}">${sems.map(sm => {
      const list = coursesIn(sm.code);
      return list.length ? `<optgroup label="${sm.code === BANK_SEM ? '考科' : /s2$/.test(sm.code) ? '下學期' : '上學期'}">${list.map(x => `<option value="${x.id}" ${x.id === curId ? 'selected' : ''}>${esc(x.title)}（${count(x)}）</option>`).join('')}</optgroup>` : '';
    }).join('')}</select></label>`;
  return `<div class="subj-chips-wrap">${rows}</div>${select}`;
}

/* 首頁、關於我們的底圖（原創向量圖，顏色跟著深淺色主題）：
   八卦太極環、懸壺（葫蘆）、銀針三枚、藥碾、人參（掌狀複葉＋紅果） */
// 科目卡封面底圖：原創水墨山水（遠山、霧、朱紅日、枝椏、飛鳥），依科目左右翻轉、換日的位置，只當淡淡的底
const COVER_ART = (() => {
  const mtn = (d, op, id) => `<path d="${d}" fill="url(#${id})" opacity="${op}"/>`;
  return i => {
    const k = ((i % 4) + 4) % 4, flip = k % 2 === 1, sunX = [150, 58, 132, 70][k], sunY = [52, 44, 70, 60][k];
    const u = `ink${k}`;
    return `<svg class="cover-art" viewBox="0 0 200 240" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
  <defs>
    <linearGradient id="${u}a" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--ink-wash)" stop-opacity=".85"/><stop offset=".55" stop-color="var(--ink-wash)" stop-opacity=".35"/><stop offset="1" stop-color="var(--ink-wash)" stop-opacity="0"/></linearGradient>
    <linearGradient id="${u}b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--ink-wash)" stop-opacity=".55"/><stop offset="1" stop-color="var(--ink-wash)" stop-opacity="0"/></linearGradient>
    <filter id="${u}m" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="1.4"/></filter>
    <radialGradient id="${u}s"><stop offset="0" stop-color="#c4553f" stop-opacity=".75"/><stop offset=".7" stop-color="#c4553f" stop-opacity=".55"/><stop offset="1" stop-color="#c4553f" stop-opacity="0"/></radialGradient>
  </defs>
  <circle cx="${sunX}" cy="${sunY}" r="18" fill="url(#${u}s)"/>
  <g transform="${flip ? 'translate(200 0) scale(-1 1)' : ''}">
    <g filter="url(#${u}m)">
      ${mtn('M-10 240 L-10 150 C10 140 22 118 38 112 C50 108 56 128 70 132 C86 136 96 104 112 98 C126 94 134 120 150 126 C166 132 180 116 210 120 L210 240 Z', '.45', u + 'b')}
      ${mtn('M-10 240 L-10 176 C14 172 30 150 48 146 C62 143 70 164 86 170 C104 176 118 150 136 146 C150 143 160 166 176 170 C190 173 200 164 210 166 L210 240 Z', '.75', u + 'a')}
    </g>
    <path d="M30 147 C34 160 33 175 36 190 M134 147 C130 162 132 178 128 196" fill="none" stroke="var(--ink-wash)" stroke-width=".6" opacity=".35"/>
    <g fill="none" stroke="var(--ink-wash)" stroke-linecap="round" opacity=".7">
      <path d="M210 70 C186 74 170 82 152 98" stroke-width="2.2"/><path d="M180 77 C176 66 178 58 172 50" stroke-width="1.2"/><path d="M164 88 C156 84 148 86 140 82" stroke-width="1.1"/><path d="M152 98 C146 104 142 104 136 108" stroke-width=".9"/>
    </g>
    <g fill="#c4553f" opacity=".45"><circle cx="172" cy="50" r="2.2"/><circle cx="141" cy="82" r="2"/><circle cx="160" cy="92" r="1.6"/><circle cx="182" cy="62" r="1.8"/></g>
    <g fill="none" stroke="var(--ink-wash)" stroke-width=".9" stroke-linecap="round" opacity=".55"><path d="M70 92 q4 -4 8 0 q4 -4 8 0"/><path d="M92 82 q3 -3 6 0 q3 -3 6 0"/></g>
  </g>
</svg>`;
  };
})();
// 首頁／關於本站大圖：原創水墨山水（與科目卡封面同一套語言）。左側淡出，不壓到標題文字
const HERO_ART = `<svg class="hero-art" viewBox="0 0 640 300" preserveAspectRatio="xMaxYMax slice" aria-hidden="true">
  <defs>
    <linearGradient id="hw-fade" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".35" stop-color="#fff" stop-opacity=".9"/><stop offset="1" stop-color="#fff"/></linearGradient>
    <mask id="hw-mask"><rect width="640" height="300" fill="url(#hw-fade)"/></mask>
    <linearGradient id="hw-m1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--ink-wash)" stop-opacity=".9"/><stop offset=".6" stop-color="var(--ink-wash)" stop-opacity=".35"/><stop offset="1" stop-color="var(--ink-wash)" stop-opacity="0"/></linearGradient>
    <linearGradient id="hw-m2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--ink-wash)" stop-opacity=".55"/><stop offset="1" stop-color="var(--ink-wash)" stop-opacity="0"/></linearGradient>
    <linearGradient id="hw-m3" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--ink-wash)" stop-opacity=".3"/><stop offset="1" stop-color="var(--ink-wash)" stop-opacity="0"/></linearGradient>
    <radialGradient id="hw-sun"><stop offset="0" stop-color="#c4553f" stop-opacity=".8"/><stop offset=".7" stop-color="#c4553f" stop-opacity=".6"/><stop offset="1" stop-color="#c4553f" stop-opacity="0"/></radialGradient>
    <filter id="hw-blur" x="-5%" y="-10%" width="110%" height="120%"><feGaussianBlur stdDeviation="2"/></filter>
  </defs>
  <g mask="url(#hw-mask)">
    <circle cx="470" cy="78" r="30" fill="url(#hw-sun)"/>
    <g filter="url(#hw-blur)">
      <path d="M-20 300 L-20 190 C60 186 120 184 170 172 C170 172 200 140 236 132 C262 126 276 152 300 156 C330 160 350 118 382 110 C410 103 428 140 456 146 C486 152 506 120 540 116 C570 112 600 140 660 136 L660 300 Z" fill="url(#hw-m3)"/>
      <path d="M-20 300 L-20 224 C60 220 120 214 186 206 C186 206 214 176 250 170 C276 166 292 192 318 198 C350 205 372 160 404 152 C430 146 446 182 474 188 C504 194 524 168 556 164 C590 160 620 186 660 182 L660 300 Z" fill="url(#hw-m2)"/>
      <path d="M-20 300 L-20 256 C80 254 160 250 240 240 C240 240 262 214 292 210 C316 207 330 230 352 236 C380 243 398 206 426 200 C450 195 464 226 490 232 C516 238 536 214 562 210 C590 206 612 226 660 222 L660 300 Z" fill="url(#hw-m1)"/>
    </g>
    <path d="M300 156 C304 176 302 196 306 214 M404 152 C400 172 404 192 398 214 M556 164 C552 184 556 204 550 224" fill="none" stroke="var(--ink-wash)" stroke-width=".8" opacity=".35"/>
    <g fill="none" stroke="var(--ink-wash)" stroke-linecap="round" opacity=".75">
      <path d="M660 22 C620 30 590 44 560 70 C548 80 540 84 528 88" stroke-width="3"/>
      <path d="M612 34 C606 20 610 10 600 0" stroke-width="1.6"/><path d="M584 52 C572 46 560 48 548 42" stroke-width="1.4"/>
      <path d="M560 70 C556 82 558 92 552 102" stroke-width="1.2"/><path d="M528 88 C518 90 512 96 504 96" stroke-width="1"/>
    </g>
    <g fill="#c4553f" opacity=".5"><circle cx="600" cy="2" r="3"/><circle cx="548" cy="42" r="2.6"/><circle cx="552" cy="102" r="2.4"/><circle cx="504" cy="96" r="2.2"/><circle cx="622" cy="26" r="2.4"/><circle cx="574" cy="58" r="2"/></g>
    <g fill="none" stroke="var(--ink-wash)" stroke-width="1.1" stroke-linecap="round" opacity=".6"><path d="M352 96 q5 -5 10 0 q5 -5 10 0"/><path d="M380 84 q4 -4 8 0 q4 -4 8 0"/><path d="M336 110 q3 -3 6 0 q3 -3 6 0"/></g>
  </g>
</svg>`;
