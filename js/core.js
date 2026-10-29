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
  } catch { extraFiles = []; }
}

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
const itemsOf = courseId => data.items.filter(i => i.courseId == courseId);
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
   ========================================================= */
const PAGES = ['home', 'courses', 'course', 'items', 'projects', 'detail', 'about', 'admin', 'account', 'editor', 'exam', 'attempt', 'retry', 'examedit', 'examstats', 'examzone'];
let page = 'home', filter = 'all', query = '', adminType = 'pages', detailTarget = ['item', 0], courseTarget = 0;
let pagesCourse = 0;
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
const yearOf = code => Number((/_y(\d)s/.exec(code || '') || [])[1]) || 0;
// 學期短名稱：2026_y1s1 → 2026 一上
function shortSemLabel(code) {
  const m = /^(\d{4})_y(\d)s(\d)$/.exec(code || '');
  return m ? `${m[1]} ${'一二三四五'[m[2] - 1] || m[2]}${m[3] === '1' ? '上' : '下'}` : semesterLabel(code);
}
// 年級分頁；openYears＝可以點的年級（前台：同學看得到的年級）
// sub(y)：有給時每個年級都可以點，小字改顯示 sub(y) 的內容（後台用，例如「0 張圖卡」）
function yearTabsHtml(openYears, sub) {
  if (sub) {
    // 還沒選過年級時，停在有資料的最新年級（都沒有就一年級）
    if (!siteYear) siteYear = openYears.size ? Math.max(...openYears) : 1;
    openYears = new Set([1, 2, 3, 4, 5]);
  }
  if (!openYears.has(siteYear)) siteYear = Math.max(0, ...openYears);
  return `
  <div class="year-tabs" role="tablist" aria-label="年級">
    ${YEAR_NAMES.map((n, i) => {
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
    return `<div class="subj-row"><span class="subj-sem">${/s2$/.test(sm.code) ? '下學期' : '上學期'}</span>
      ${list.map(x => `<button type="button" class="subj-chip${count(x) ? '' : ' none'}" ${attr}="${x.id}" aria-pressed="${x.id === curId}">${esc(x.title)}<small>${count(x)}</small></button>`).join('')}</div>`;
  }).join('');
  // 手機：改用下拉選單（系統原生，好點、不會被切掉）
  const select = `<label class="subj-select-wrap"><span class="sr-only">科目</span>
    <select class="subj-select" data-subj-select="${attr}">${sems.map(sm => {
      const list = coursesIn(sm.code);
      return list.length ? `<optgroup label="${/s2$/.test(sm.code) ? '下學期' : '上學期'}">${list.map(x => `<option value="${x.id}" ${x.id === curId ? 'selected' : ''}>${esc(x.title)}（${count(x)}）</option>`).join('')}</optgroup>` : '';
    }).join('')}</select></label>`;
  return `<div class="subj-chips-wrap">${rows}</div>${select}`;
}

/* 首頁、關於我們的底圖（原創向量圖，顏色跟著深淺色主題）：
   八卦太極環、懸壺（葫蘆）、銀針三枚、藥碾、人參（掌狀複葉＋紅果） */
const HERO_ART = `<svg class="hero-art" viewBox="0 0 640 300" preserveAspectRatio="xMaxYMax slice" aria-hidden="true">
  <defs>
    <radialGradient id="ha-glow" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="var(--gold)" stop-opacity=".22"/><stop offset="1" stop-color="var(--gold)" stop-opacity="0"/></radialGradient>
    <g id="ha-leaf"><path d="M0 0 C6 -10 6 -26 0 -36 C-6 -26 -6 -10 0 0 Z"/></g>
    <g id="ha-palm"><use href="#ha-leaf"/><use href="#ha-leaf" transform="rotate(-38) scale(.8)"/><use href="#ha-leaf" transform="rotate(38) scale(.8)"/><use href="#ha-leaf" transform="rotate(-74) scale(.55)"/><use href="#ha-leaf" transform="rotate(74) scale(.55)"/></g>
  </defs>
  <!-- 八卦太極環 -->
  <g transform="translate(450 138)">
    <circle r="150" fill="url(#ha-glow)"/>
    <circle r="112" fill="none" stroke="var(--gold)" stroke-opacity=".30" stroke-width="1.2"/>
    <circle r="92" fill="none" stroke="var(--gold)" stroke-opacity=".22" stroke-width="1"/>
    <g stroke="var(--gold)" stroke-opacity=".38" stroke-width="3" stroke-linecap="butt">
      ${[[1,1,1],[1,1,0],[1,0,1],[1,0,0],[0,0,0],[0,0,1],[0,1,0],[0,1,1]].map((t, i) => `<g transform="rotate(${i * 45}) translate(0 -102)">${t.map((y, j) => y ? `<line x1="-9" y1="${j * 5 - 5}" x2="9" y2="${j * 5 - 5}"/>` : `<line x1="-9" y1="${j * 5 - 5}" x2="-2.5" y2="${j * 5 - 5}"/><line x1="2.5" y1="${j * 5 - 5}" x2="9" y2="${j * 5 - 5}"/>`).join('')}</g>`).join('')}
    </g>
    <g transform="rotate(-20)" opacity=".42">
      <circle r="44" fill="var(--surface)" stroke="var(--ink)" stroke-opacity=".35" stroke-width="1"/>
      <path d="M0 -44 A44 44 0 0 1 0 44 A22 22 0 0 1 0 0 A22 22 0 0 0 0 -44 Z" fill="var(--accent)"/>
      <circle cy="-22" r="6" fill="var(--accent)"/>
      <circle cy="22" r="6" fill="var(--surface)"/>
    </g>
  </g>
  <!-- 銀針三枚 -->
  <g stroke-linecap="round" opacity=".7">
    ${[[372, 196, 48], [386, 200, 40], [400, 206, 32]].map(([x, y, r]) => `<g transform="translate(${x} ${y}) rotate(${r})"><line x1="0" y1="0" x2="0" y2="96" stroke="var(--muted)" stroke-width="1.2"/><rect x="-2.6" y="-26" width="5.2" height="26" rx="2" fill="none" stroke="var(--gold)" stroke-width="1.4"/><line x1="-2.6" y1="-20" x2="2.6" y2="-17" stroke="var(--gold)" stroke-width="1"/><line x1="-2.6" y1="-13" x2="2.6" y2="-10" stroke="var(--gold)" stroke-width="1"/><line x1="-2.6" y1="-6" x2="2.6" y2="-3" stroke="var(--gold)" stroke-width="1"/></g>`).join('')}
  </g>
  <!-- 懸壺（葫蘆） -->
  <g transform="translate(600 0)">
    <line x1="0" y1="0" x2="0" y2="40" stroke="var(--gold)" stroke-opacity=".6" stroke-width="1.4"/>
    <path d="M0 40 C8 40 12 46 12 53 C12 60 7 64 5 67 C18 71 26 82 26 94 C26 110 14 118 0 118 C-14 118 -26 110 -26 94 C-26 82 -18 71 -5 67 C-7 64 -12 60 -12 53 C-12 46 -8 40 0 40 Z" fill="var(--red)" fill-opacity=".30" stroke="var(--red)" stroke-opacity=".55" stroke-width="1.2"/>
    <path d="M-6 66 Q0 69 6 66" fill="none" stroke="var(--gold)" stroke-opacity=".8" stroke-width="2.4"/><path d="M0 118 L0 128 M-3 128 L3 128 M-4 128 C-6 138 -4 146 -2 150 M4 128 C6 138 4 146 2 150" fill="none" stroke="var(--red)" stroke-opacity=".5" stroke-width="1.2"/>
    <path d="M-15 84 C-18 94 -15 104 -9 110" fill="none" stroke="var(--surface)" stroke-opacity=".5" stroke-width="2"/>
  </g>
  <!-- 藥碾 -->
  <g transform="translate(380 266)" opacity=".75">
    <path d="M0 0 L150 0 C142 18 120 30 75 30 C30 30 8 18 0 0 Z" fill="var(--ink)" fill-opacity=".12" stroke="var(--ink)" stroke-opacity=".30" stroke-width="1.2"/>
    <path d="M18 2 C30 16 120 16 132 2" fill="none" stroke="var(--ink)" stroke-opacity=".22" stroke-width="1"/>
    <circle cx="75" cy="-2" r="20" fill="var(--surface)" fill-opacity=".6" stroke="var(--ink)" stroke-opacity=".35" stroke-width="1.4"/>
    <circle cx="75" cy="-2" r="4" fill="var(--ink)" fill-opacity=".35"/>
    <line x1="22" y1="-2" x2="128" y2="-2" stroke="var(--ink)" stroke-opacity=".35" stroke-width="3" stroke-linecap="round"/>
  </g>
  <!-- 人參：掌狀複葉＋紅果 -->
  <g transform="translate(560 300)">
    <path d="M0 0 C-4 -50 -2 -96 6 -140" fill="none" stroke="var(--accent)" stroke-opacity=".6" stroke-width="2"/>
    <path d="M2 -96 C-16 -104 -32 -108 -48 -104" fill="none" stroke="var(--accent)" stroke-opacity=".55" stroke-width="1.6"/>
    <path d="M3 -96 C20 -106 36 -108 54 -100" fill="none" stroke="var(--accent)" stroke-opacity=".55" stroke-width="1.6"/>
    <g fill="var(--accent)" fill-opacity=".34">
      <use href="#ha-palm" transform="translate(-48 -104) rotate(-60)"/>
      <use href="#ha-palm" transform="translate(54 -100) rotate(60)"/>
      <use href="#ha-palm" transform="translate(4 -112) scale(.9)"/>
    </g>
    ${[[6,-146],[0,-152],[12,-152],[6,-158],[-2,-160],[14,-160],[6,-166]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="4" fill="var(--red)" fill-opacity=".65"/>`).join('')}
  </g>
</svg>`;
