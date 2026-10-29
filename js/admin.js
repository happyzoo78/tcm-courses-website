/* admin.js：管理後台、編輯表單、圖片處理、成員管理
   載入順序：core.js → pages.js → admin.js → app.js（順序不能改） */

/* =========================================================
   五、管理後台（登入後才能編輯，資料直接存進雲端資料庫）
   ========================================================= */
const TYPE_NAME = { courses: '科目', items: '圖卡', projects: '活動專案' };
const ROLE_NAME = { owner: '擁有者', admin: '管理員', editor: '編輯者', viewer: '一般會員' };
// 身分顯示：一般會員、編輯者被指派為科目負責人時，只顯示「科目負責人」（擁有者決定，名稱不重複）
function roleLabel(role, ownsCourses) {
  if ((role === 'viewer' || role === 'editor') && ownsCourses) return '科目負責人';
  return ROLE_NAME[role] || role;
}

// 偵測是否在 LINE、Facebook 等 App 的內建瀏覽器裡（Google 不允許在這些地方登入）
function inAppBrowser() {
  const ua = navigator.userAgent || '';
  if (/\bLine\//i.test(ua)) return 'line';
  if (/FBAN|FBAV|Instagram|MicroMessenger/i.test(ua)) return 'other';
  return null;
}

function loginGateHtml() {
  const inApp = inAppBrowser();
  const inAppMsg = inApp === 'line'
    ? `<div class="msg error">你正在 <b>LINE</b> 裡開啟網頁，Google 不允許在這裡登入（可改用下方 Email＋密碼登入）。<br>
        <a class="btn" style="margin-top:8px" href="${location.origin}/?openExternalBrowser=1">改用手機瀏覽器開啟</a></div>`
    : inApp === 'other'
    ? `<div class="msg error">你正在 App 的內建瀏覽器裡開啟網頁，Google 不允許在這裡登入。請點右上角的「⋯」選單，選擇「在瀏覽器中開啟」，或改用下方 Email＋密碼登入。</div>`
    : '';
  return `
  <div class="gate">
    <div class="panel prose login-box">
      <div class="eyebrow">福建台灣班 26 · 班級專用</div>
      <h2>歡迎來到2026福建中醫台灣班網站</h2>
      <p>本站內容僅供班級成員學習使用，請先登入。</p>
      ${inAppMsg}
      ${loginNotice ? `<div class="msg error">${esc(loginNotice)}</div>` : ''}
      <a class="google-btn" href="/api/auth/google/start" id="google-login"><span class="g">G</span> 使用 Google 帳號登入</a>
      <div class="login-or"><span>或用 Email＋密碼登入</span></div>
      <p class="meta-label" style="margin-top:0">沒有 Google 帳號、或人在大陸不能用 Google 時，請用管理者給你的密碼登入。</p>
      <form id="loginform" class="pw-login">
        <div class="field"><label for="l-email">Email</label><input id="l-email" name="email" type="email" autocomplete="username" required></div>
        <div class="field"><label for="l-pw">密碼</label><input id="l-pw" name="password" type="password" autocomplete="current-password" required></div>
        <div id="loginmsg"></div>
        <button class="btn" type="submit">登入</button>
        <p class="meta-label">為保護帳號安全，密碼連續輸錯 5 次會暫停登入 15 分鐘。忘記密碼請找網站管理者重設。</p>
      </form>
      <p class="meta-label">還不能登入嗎？請把你的 Email 提供給網站管理者，加入名單後就可以使用。</p>
    </div>
  </div>`;
}

// 產生好記又不易猜的臨時密碼：小寫字母＋數字 12 碼（去掉容易混淆的 0 o 1 l i）
function makeTempPassword() {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  const a = new Uint32Array(12); crypto.getRandomValues(a);
  return Array.from(a, n => chars[n % chars.length]).join('');
}

/* 成員管理（只有擁有者看得到） */
function fmtTime(s) {
  if (!s) return '尚未登入';
  const d = new Date(String(s).replace(' ', 'T') + 'Z');
  return isNaN(d) ? s : d.toLocaleString('zh-TW', { hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function membersHtml() {
  if (!members) return '<p class="empty">成員名單載入中…</p>';
  const roleOptions = r => ['viewer', 'editor'].map(x => `<option value="${x}" ${r === x ? 'selected' : ''}>${ROLE_NAME[x]}</option>`).join('');
  return `
  ${membersMeta.seenSupported ? `
  <div class="online-bar">
    <span class="online-dot on"></span><b>目前 ${members.filter(m => seenInfo(m).online).length} 人在線上</b>
    <span class="meta-label">（${ONLINE_MIN} 分鐘內有使用網站算線上；每分鐘自動更新）</span>
  </div>` : `<div class="notice">要顯示「上線狀態」，需要先在資料庫加一個欄位，請照 Claude 給的步驟操作一次。</div>`}
  <div class="panel prose" style="margin:6px 0 16px">
    <h3 style="margin-top:0">加入新成員</h3>
    <p class="meta-label" style="margin-top:0">請同學提供他要用來登入的 Email。Gmail 可以直接按「使用 Google 帳號登入」；沒有 Google 帳號、或人在大陸不能用 Google 的同學，請順便設一組臨時密碼。</p>
    <form id="memberform" class="member-form">
      <div class="field"><label for="m-email">Email</label><input id="m-email" name="email" type="email" required placeholder="例如 student@gmail.com"></div>
      <div class="field"><label for="m-name">名稱（選填）</label><input id="m-name" name="displayName" maxlength="100" placeholder="例如 王小明"></div>
      <div class="field"><label for="m-pw">臨時密碼（選填）</label><div class="pw-gen"><input id="m-pw" name="password" minlength="12" maxlength="128" autocomplete="off" placeholder="至少 12 字"><button type="button" class="btn secondary" id="m-pw-gen">產生</button></div></div>
      <div class="field"><label for="m-role">權限</label><select id="m-role" name="role">${roleOptions('viewer')}</select></div>
      <button class="btn" type="submit">加入名單</button>
    </form>
    <div id="memberformmsg"></div>
    <p class="meta-label">一般會員：只能看內容。編輯者：可以進後台新增、修改，但不能刪除。</p>
  </div>
  <div class="adminlist">
    ${[...members].sort((a, b) => (seenInfo(b).online - seenInfo(a).online) || String(b.lastSeenAt || '').localeCompare(String(a.lastSeenAt || ''))).map(m => {
      const locked = m.role === 'owner' || m.isSelf;
      const seen = seenInfo(m);
      const off = m.status !== 'active';
      return `
      <div class="adminrow">
        <div>
          ${membersMeta.seenSupported ? `<span class="online-dot ${seen.online ? 'on' : ''}" title="${esc(seen.text)}"></span>` : ''}<b>${esc(m.displayName)}</b><span class="role">${ROLE_NAME[m.role] || esc(m.role)}</span>${m.hasPassword ? '<span class="role" title="可以用 Email＋密碼登入">密碼</span>' : ''}${off ? '<span class="role off">已停用</span>' : ''}
          <br><small>${membersMeta.seenSupported ? `<span class="${seen.online ? 'seen-on' : ''}">${esc(seen.text)}</span> · ` : ''}${esc(m.email)} · 最後登入：${esc(fmtTime(m.lastLoginAt))}</small>
        </div>
        <div class="row-actions">
          ${m.isSelf ? '<a class="btn secondary" href="#account">改暱稱</a>' : locked ? '' : `
            <button type="button" class="btn secondary" data-member-rename="${m.id}">改名</button>
            <button type="button" class="btn secondary" data-member-pw="${m.id}">${m.hasPassword ? '重設密碼' : '設定密碼'}</button>
            <select data-member-role="${m.id}" aria-label="變更權限">${roleOptions(m.role)}</select>
            <button type="button" class="btn secondary ${off ? '' : 'danger'}" data-member-status="${m.id}" data-to="${off ? 'active' : 'suspended'}">${off ? '恢復' : '停用'}</button>
            ${m.lastLoginAt ? '' : `<button type="button" class="btn secondary danger" data-member-delete="${m.id}">移除</button>`}`}
        </div>
      </div>`;
    }).join('')}
  </div>`;
}

let membersMeta = { now: null, seenSupported: true, at: 0 };
const ONLINE_MIN = 5;   // 5 分鐘內有動作就算「線上」

// 上線狀態：線上／幾分鐘前／今天幾點／日期
function seenInfo(m) {
  if (!m.lastSeenAt) return { online: false, text: m.lastLoginAt ? '尚無紀錄' : '從未登入' };
  const t = Date.parse(String(m.lastSeenAt).replace(' ', 'T') + 'Z');
  const now = membersMeta.now ? Date.parse(String(membersMeta.now).replace(' ', 'T') + 'Z') + (Date.now() - membersMeta.at) : Date.now();
  const min = Math.max(0, Math.floor((now - t) / 60000));
  if (min < ONLINE_MIN) return { online: true, text: '線上' };
  if (min < 60) return { online: false, text: `${min} 分鐘前` };
  if (min < 24 * 60) return { online: false, text: `${Math.floor(min / 60)} 小時前` };
  return { online: false, text: fmtTime(m.lastSeenAt).slice(0, 10) };
}

async function loadMembers() {
  if (membersLoading) return;
  membersLoading = true;
  try {
    const r = await api('/api/admin/members');
    members = r.members; membersMeta = { now: r.now, seenSupported: r.seenSupported !== false, at: Date.now() };
  } catch (err) {
    membersLoading = false;
    members = [];
    return handleError(err, null);
  }
  membersLoading = false;
  render();
}

// 先取得最新名單再更新畫面，避免提示訊息一閃而過
async function reloadMembers(message) {
  adminFlash = message;
  members = null;
  await loadMembers();
}

/* 網頁管理：上傳整份 HTML 網頁到自己負責的科目 */
const MAX_PAGE_BYTES = 1_900_000;

// 後台共用：分層科目選單「年級 › 學期 › 科目」＋右側主要按鈕（講義管理、試題管理共用）
// 科目再多，每個下拉選單也只列「目前這一層」的選項；選過的科目會記在這台電腦，下次打開直接回到那裡
const ADMIN_COURSE_KEY = 'tcm-admin-course';
const adminLastInSem = {};   // 每個學期上次選的科目
function adminPickCourse(list) {
  if (list.some(c => c.id === pagesCourse)) return pagesCourse;
  let saved = 0;
  try { saved = Number(localStorage.getItem(ADMIN_COURSE_KEY)) || 0; } catch {}
  return list.some(c => c.id === saved) ? saved : list[0].id;
}
function setAdminCourse(id) {
  pagesCourse = Number(id) || 0;
  const c = getCourse(pagesCourse);
  if (c) adminLastInSem[c.semesterCode] = c.id;
  try { localStorage.setItem(ADMIN_COURSE_KEY, String(pagesCourse)); } catch {}
}
function adminCoursePicker(list, curId, selectId, actionHtml) {
  const cur = list.find(x => x.id === curId) || list[0];
  setAdminCourse(cur.id);
  const order = code => getSemester(code)?.sortOrder ?? 0;
  const semCodes = [...new Set(list.map(x => x.semesterCode))].sort((a, b) => order(a) - order(b) || a.localeCompare(b));
  const years = [...new Set(semCodes.map(yearOf))].sort((a, b) => a - b);
  const curYear = yearOf(cur.semesterCode);
  const semsInYear = semCodes.filter(s => yearOf(s) === curYear);
  const subjects = list.filter(x => x.semesterCode === cur.semesterCode);
  const semName = code => { const m = /s(\d)$/.exec(code || ''); return m ? (m[1] === '1' ? '上學期' : '下學期') : semesterLabel(code); };
  const lvl = (name, attr, opts, cls) => `
      <label class="apick${cls ? ' ' + cls : ''}" title="切換${name}"><span class="sr-only">${name}</span>
        <select ${attr}${opts.length < 2 && !cls ? ' disabled' : ''}>${opts.join('')}</select></label>`;
  return `
    <div class="exnav-top">
      <div class="apick-path" role="group" aria-label="選擇科目">
        ${lvl('年級', 'data-apick-year', years.map(y => `<option value="${y}" ${y === curYear ? 'selected' : ''}>${YEAR_NAMES[y - 1] || y + ' 年級'}</option>`))}
        <span class="apick-sep" aria-hidden="true">›</span>
        ${lvl('學期', 'data-apick-sem', semsInYear.map(s => `<option value="${esc(s)}" ${s === cur.semesterCode ? 'selected' : ''}>${esc(semName(s))}</option>`))}
        <span class="apick-sep" aria-hidden="true">›</span>
        ${lvl('科目', `id="${selectId}" data-apick-course`, subjects.map(x => `<option value="${x.id}" ${x.id === cur.id ? 'selected' : ''}>${esc(x.title)}</option>`), 'exnav-course')}
      </div>
      ${actionHtml}
    </div>`;
}
// 分層選單的切換（講義管理、試題管理都會呼叫）
function bindAdminPicker() {
  const list = editableCourses();
  const firstIn = codes => {
    for (const code of codes) {
      const keep = adminLastInSem[code];
      if (list.some(c => c.id === keep)) return keep;
      const c = list.find(x => x.semesterCode === code);
      if (c) return c.id;
    }
    return 0;
  };
  const semsOf = y => [...new Set(list.map(x => x.semesterCode))].filter(s => yearOf(s) === y)
    .sort((a, b) => (getSemester(a)?.sortOrder ?? 0) - (getSemester(b)?.sortOrder ?? 0) || a.localeCompare(b));
  document.querySelectorAll('[data-apick-year]').forEach(sel => sel.onchange = () => { setAdminCourse(firstIn(semsOf(Number(sel.value)))); render(); });
  document.querySelectorAll('[data-apick-sem]').forEach(sel => sel.onchange = () => { setAdminCourse(firstIn([sel.value])); render(); });
  document.querySelectorAll('[data-apick-course]').forEach(sel => sel.onchange = () => { setAdminCourse(sel.value); render(); });
}

function pagesAdminHtml() {
  const list = editableCourses();
  if (!list.length) return '<p class="empty">你目前沒有負責的科目。如需上傳講義，請聯絡網站管理者把你設為科目負責人。</p>';
  pagesCourse = adminPickCourse(list);
  const c = getCourse(pagesCourse);
  const rows = pagesOf(pagesCourse);
  return `
  <div class="exnav">
    ${adminCoursePicker(list, c.id, 'pg-course', `<a class="btn exnav-add" href="#editor/new/${c.id}" title="像 Word 一樣直接打字、插圖、做表格">✏️ 寫新講義</a>`)}
    <details class="exnav-more">
      <summary>或：上傳做好的講義網頁檔（.html）</summary>
      <form id="pageform">
        <div class="field"><label for="pg-file">網頁檔（.html，上限約 1.9 MB）</label><input id="pg-file" name="file" type="file" accept=".html,.htm,text/html" required></div>
        <div class="field"><label for="pg-title">標題（留空會自動使用網頁本身的標題）</label><input id="pg-title" name="title" maxlength="200"></div>
        <div class="field"><label for="pg-desc">說明（選填）</label><textarea id="pg-desc" name="description" maxlength="1000"></textarea></div>
        <div id="pageformmsg"></div>
        <button class="btn" type="submit">上傳講義</button>
        <p class="meta-label">講義上傳後只有登入的班級成員看得到。圖片請直接嵌在網頁檔裡（單一檔案）。</p>
      </form>
    </details>
  </div>
  <p class="meta-label">「${esc(c.title)}」共 ${rows.length} 份講義</p>
  <div class="adminlist">
    ${rows.map(p => `
      <div class="adminrow">
        <div><b>${esc(p.title)}</b>${p.editable ? '<span class="role">網站內編輯</span>' : ''}<br><small>${fmtSize(p.size)} · 更新：${esc(fmtTime(p.updatedAt))}${p.updatedBy ? ' · ' + esc(p.updatedBy) : ''}</small></div>
        <div class="row-actions">
          <a class="btn secondary" href="${esc(p.url)}" target="_blank" rel="noopener">開啟</a>
          ${p.editable ? `<a class="btn secondary" href="#editor/${p.id}">線上編輯</a>` : ''}
          <button type="button" class="btn secondary" data-page-edit="${p.id}">${p.editable ? '標題・排序' : '編輯'}</button>
          <button type="button" class="btn secondary danger" data-page-delete="${p.id}">刪除</button>
        </div>
      </div>`).join('') || '<p class="empty-note">這個科目還沒有講義。按「✏️ 寫新講義」或上傳講義網頁檔。</p>'}
  </div>
  <div id="editor"></div>`;
}

function pageEditorHtml(p) {
  return `
  <div class="panel prose" style="margin-top:20px">
    <h2>編輯講義</h2>
    <form id="pageeditform">
      <div class="field"><label for="pe-title">標題</label><input id="pe-title" name="title" required maxlength="200" value="${esc(p.title)}"></div>
      <div class="field"><label for="pe-desc">說明</label><textarea id="pe-desc" name="description" maxlength="1000">${esc(p.description || '')}</textarea></div>
      <div class="field"><label for="pe-sort">排序（數字小的排前面）</label><input id="pe-sort" name="sortOrder" type="number" min="0" value="${p.sortOrder}"></div>
      <div class="field"><label for="pe-file">換成新版網頁檔（選填，不選就保留原本的）</label><input id="pe-file" name="file" type="file" accept=".html,.htm,text/html"></div>
      <div id="pageeditmsg"></div>
      <button class="btn" type="submit">儲存</button>
      <button class="btn secondary" type="button" id="cancel">取消</button>
    </form>
  </div>`;
}

// 讀取使用者選的 .html 檔，先在瀏覽器檢查，避免傳到一半才失敗
async function readHtmlFile(file) {
  if (!/\.html?$/i.test(file.name)) throw new Error('請選擇 .html 結尾的網頁檔。');
  if (file.size > MAX_PAGE_BYTES) throw new Error(`網頁檔案太大：${fmtSize(file.size)}，上限約 1.9 MB。請把網頁裡的大圖片縮小後再試。`);
  const html = await file.text();
  if (!/<html[\s>]|<!doctype html/i.test(html)) throw new Error('這個檔案看起來不是網頁，請確認是 .html 檔。');
  return html;
}

/* 學期開放設定 */
function semestersAdminHtml() {
  const sems = [...data.semesters].sort((a, b) => a.sortOrder - b.sortOrder);
  return `
  <p class="meta-label">右側開關決定<b>同學看不看得到</b>這個學期的科目，以及科目裡的圖卡和試題。開關打開（綠色）＝同學看得到；關閉（灰色）＝只有管理者看得到。新學期開始時，把它打開即可。</p>
  <div class="sem-grid">
    ${YEAR_NAMES.map((n, i) => {
      const list = sems.filter(s => yearOf(s.code) === i + 1);
      if (!list.length) return '';
      return `
      <div class="sem-card">
        <div class="sem-card-title">${n}<small>${esc(list[0].code.slice(0, 4))}</small></div>
        ${list.map(s => `
        <div class="sem-line">
          <span>${/s1$/.test(s.code) ? '上學期' : '下學期'}<small>${coursesIn(s.code).length} 科</small></span>
          <button type="button" class="sem-switch" role="switch" aria-checked="${!!s.visible}" data-sem="${esc(s.code)}" data-to="${s.visible ? '0' : '1'}" aria-label="${esc(s.label)}：同學${s.visible ? '看得到' : '看不到'}" title="${s.visible ? '按一下：對同學隱藏' : '按一下：讓同學看得到'}">
            <span class="sem-state">${s.visible ? '同學看得到' : '同學看不到'}</span><span class="sw" aria-hidden="true"><span class="sw-knob"></span></span>
          </button>
        </div>`).join('')}
      </div>`;
    }).join('')}
  </div>`;
}

// 科目管理：直接在清單上指派科目負責人（不用進「編輯」）
let ownerOpen = 0;   // 目前展開指派面板的科目
function ownerPanelHtml(c) {
  if (!members) return '<div class="owner-panel"><p class="meta-label">成員名單載入中…</p></div>';
  const list = members.filter(m => m.status === 'active' && m.role !== 'owner');
  return `
  <form class="owner-panel" data-owner-form="${c.id}">
    <p class="owner-cap">「${esc(c.title)}」的負責人可以新增、修改、刪除這個科目的試題（可以勾選多位）</p>
    <div class="owner-list">
      ${list.map(m => `<label class="check"><input type="checkbox" name="owner" value="${m.id}" ${(c.owners || []).some(o => o.id === m.id) ? 'checked' : ''}> ${esc(m.displayName)} <small>${esc(m.email)}</small></label>`).join('') || '<p class="meta-label">名單上還沒有其他成員。請先到「成員管理」新增成員。</p>'}
    </div>
    <div class="owner-actions">
      <button type="submit" class="btn">儲存負責人</button>
      <button type="button" class="btn secondary" data-owner-close>取消</button>
      <span class="owner-msg" role="status"></span>
    </div>
  </form>`;
}
function bindOwnerPanels() {
  document.querySelectorAll('[data-owner-open]').forEach(b => b.onclick = () => {
    const id = Number(b.dataset.ownerOpen);
    ownerOpen = ownerOpen === id ? 0 : id;
    render();
    if (ownerOpen && !members && !membersLoading) loadMembers();
  });
  document.querySelectorAll('[data-owner-close]').forEach(b => b.onclick = () => { ownerOpen = 0; render(); });
  document.querySelectorAll('[data-owner-form]').forEach(f => f.onsubmit = async e => {
    e.preventDefault();
    const id = Number(f.dataset.ownerForm);
    const btn = f.querySelector('[type=submit]');
    const msg = f.querySelector('.owner-msg');
    const userIds = [...f.querySelectorAll('[name=owner]:checked')].map(x => Number(x.value));
    btn.disabled = true; btn.textContent = '儲存中…';
    try {
      await api(`/api/admin/courses/${id}/owners`, { method: 'PUT', body: { userIds } });
      ownerOpen = 0;
      await reloadAfterChange(`已更新「${getCourse(id)?.title || ''}」的負責人`);
    } catch (err) {
      btn.disabled = false; btn.textContent = '儲存負責人';
      handleError(err, msg);
    }
  });
}

function adminPage() {
  if (!hasAdminAccess()) {
    return '<h2 class="section">管理後台</h2><p class="empty">你的帳號是「一般會員」，沒有後台權限。如需上傳資料，請聯絡網站管理者。</p>';
  }
  // 分頁順序：學期 → 科目 → 圖卡 → 試題 → 成員
  // 「講義管理」目前沒有規劃，先隱藏（功能與資料都保留，要恢復時把 pages: '講義' 加回來）
  // 「活動專案管理」前台已移除，後台也不顯示（資料保留在資料庫）
  const tabs = {
    ...(admin.canManageCourses ? { semesters: '學期' } : {}),
    ...(admin.canWrite ? { courses: TYPE_NAME.courses, items: TYPE_NAME.items } : {}),
    exams: '試題',
    ...(admin.canManageMembers ? { members: '成員' } : {})
  };
  if (!tabs[adminType]) adminType = Object.keys(tabs)[0];

  const flash = adminFlash ? `<div class="msg ok">${esc(adminFlash)}</div>` : '';
  adminFlash = '';
  const isCourses = adminType === 'courses';
  const canAdd = isCourses ? admin.canManageCourses : admin.canWrite;
  const canEditRow = isCourses ? admin.canManageCourses : admin.canWrite;
  const rows = data[adminType] || [];
  let body;
  if (adminType === 'members') body = membersHtml();
  else if (adminType === 'pages') body = pagesAdminHtml();
  else if (adminType === 'exams') body = examsAdminHtml();
  else if (adminType === 'semesters') body = semestersAdminHtml();
  else {
  // 課程、圖卡依年級分頁，資料多了也不會無限變長
  let list = rows;
  let tabs = '';
  if (adminType === 'courses' || adminType === 'items') {
    const semOf = i => adminType === 'courses' ? i.semesterCode : getCourse(i.courseId)?.semesterCode;
    // 後台：每個年級都能點，小字顯示實際數量（不用「尚未開課」，避免誤會成學校課表）
    const withData = new Set(rows.map(i => yearOf(semOf(i))).filter(Boolean));
    const unit = adminType === 'courses' ? ' 科' : ' 張圖卡';
    tabs = yearTabsHtml(withData, y => rows.filter(i => yearOf(semOf(i)) === y).length + unit);
    list = rows.filter(i => yearOf(semOf(i)) === siteYear);
  }
  body = `
  ${tabs}
  ${canAdd ? `<button type="button" class="btn" id="add">＋ 新增${TYPE_NAME[adminType]}</button>` : isCourses ? '<p class="meta-label">新增或修改科目由擁有者、管理員負責。</p>' : ''}
  <div class="adminlist">
    ${list.map(i => `
      <div class="adminrow">
        <div><b>${esc(i.title)}</b><br><small>${isCourses
          ? `${esc(semesterLabel(i.semesterCode))}${pagesOf(i.id).length ? ` · ${pagesOf(i.id).length} 份講義` : ''} · 負責人：${i.owners?.length ? i.owners.map(o => esc(o.name)).join('、') : '<span class="unassigned">未指派</span>'}`
          : esc(i.date || '')}${adminType === 'items' ? ' · ' + esc(courseName(i.courseId)) : ''}</small></div>
        <div class="row-actions">
          ${isCourses && admin.canManageMembers ? `<button type="button" class="btn ${ownerOpen === i.id ? '' : 'secondary'}" data-owner-open="${i.id}" aria-expanded="${ownerOpen === i.id}">負責人</button>` : ''}
          ${canEditRow ? `<button type="button" class="btn secondary" data-edit="${i.id}">編輯</button>` : ''}
          ${admin.canDelete ? `<button type="button" class="btn secondary danger" data-delete="${i.id}">刪除</button>` : ''}
        </div>
        ${isCourses && ownerOpen === i.id ? ownerPanelHtml(i) : ''}
      </div>`).join('') || '<p class="empty-note">這個年級還沒有資料。</p>'}
  </div>
  <div id="editor"></div>`;
  }

  return `
  <div class="admin-bar">
    <h2 class="section" style="margin:0;border:0;padding:0">管理後台</h2>
    <div><span class="who">${esc(admin.displayName)}（${esc(roleLabel(admin.role, (admin.ownedCourseIds || []).length > 0))}）</span></div>
  </div>
  <div class="notice">在這裡新增、修改或刪除的內容，會<b>立即儲存到雲端資料庫</b>，所有成員都會看到。</div>
  ${flash}
  <div class="admin-tabs">
    ${Object.keys(tabs).map(t => `${t === 'members' && Object.keys(tabs).length > 1 ? '<span class="admin-tab-sep" aria-hidden="true">｜</span>' : ''}<button type="button" class="btn ${adminType === t ? '' : 'secondary'}" data-admin-type="${t}" aria-pressed="${adminType === t}">${tabs[t]}管理</button>`).join('')}
  </div>
  ${body}`;
}

function editorHtml(i) {
  i = i || {};
  const isCourse = adminType === 'courses';
  const courseFields = `
    <div class="field"><label for="f-sem">學期</label>
      <select id="f-sem" name="semesterCode">${[...data.semesters].sort((a, b) => a.sortOrder - b.sortOrder).map(s => `<option value="${esc(s.code)}" ${(i.semesterCode || visibleSemesters()[0]?.code) === s.code ? 'selected' : ''}>${esc(s.label)}</option>`).join('')}</select></div>
    <div class="field"><label for="f-slug">英文代碼（小寫英文與連字號，例如 medical-biology）</label><input id="f-slug" name="slug" maxlength="60" pattern="[a-z0-9]+(-[a-z0-9]+)*" value="${esc(i.slug || '')}"></div>
    ${admin.canManageMembers ? `<fieldset class="field owners"><legend>科目負責人（可上傳、修改、刪除這個科目的講義與試題）</legend>
      ${members ? members.filter(m => m.status === 'active' && m.role !== 'owner').map(m => `<label class="check"><input type="checkbox" name="owner" value="${m.id}" ${(i.owners || []).some(o => o.id === m.id) ? 'checked' : ''}> ${esc(m.displayName)} <small>${esc(m.email)}</small></label>`).join('') || '<p class="meta-label">名單上還沒有其他成員。</p>' : '<p class="meta-label">成員名單載入中…</p>'}
    </fieldset>` : ''}
    <div class="field"><label for="f-icon">封面文字（最多 10 字）</label><input id="f-icon" name="icon" maxlength="10" value="${esc(i.icon || '')}"></div>
    <div class="field"><label for="f-latest">最新課程名稱</label><input id="f-latest" name="latest" maxlength="200" value="${esc(i.latest || '')}"></div>`;
  const entryFields = `
    ${adminType === 'items' ? `
    <div class="field"><label for="f-course">所屬科目</label>
      <select id="f-course" name="courseId">${data.courses.map(c => `<option value="${c.id}" ${i.courseId == c.id ? 'selected' : ''}>${esc(c.title)}</option>`).join('')}</select>
    </div>` : ''}
    <div class="field"><label for="f-date">日期</label><input id="f-date" name="date" type="date" value="${esc(i.date || new Date().toISOString().slice(0, 10))}"></div>
    <div class="field"><label for="f-desc">內容介紹</label><textarea id="f-desc" name="description">${esc(i.description || '')}</textarea></div>
    <div class="field"><label for="f-img">圖片（PNG、JPG、WebP、GIF；大張照片會自動壓縮）</label><input id="f-img" name="image" type="file" accept="image/png,image/jpeg,image/webp,image/gif"></div>
    ${i.image ? `<img src="${esc(i.image)}" alt="" style="max-height:120px;border-radius:6px">
    <label class="check"><input type="checkbox" name="removeImage"> 移除目前的圖片</label>
    <p class="meta-label">未重新上傳將保留原圖。</p>` : ''}`;
  return `
  <div class="panel prose" style="margin-top:20px">
    <h2>${i.id ? '編輯' : '新增'}${TYPE_NAME[adminType]}</h2>
    <form id="editform">
      <div class="field"><label for="f-title">標題</label><input id="f-title" name="title" required maxlength="200" value="${esc(i.title || '')}"></div>
      ${isCourse ? courseFields : entryFields}
      <div id="formmsg"></div>
      <button class="btn" type="submit">儲存資料</button>
      <button class="btn secondary" type="button" id="cancel">取消</button>
    </form>
  </div>`;
}

/* 圖片處理：大於 600 KB 或邊長超過 1600 像素的照片，自動縮小並轉成 JPG */
const MAX_IMAGE_BYTES = 600 * 1024;
const MAX_IMAGE_SIDE = 1600;

const readAsDataURL = blob => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => reject(new Error('讀取圖片失敗'));
  r.readAsDataURL(blob);
});

async function prepareImage(file) {
  if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) {
    throw new Error('只支援 PNG、JPG、WebP、GIF 圖片。');
  }
  if (file.type === 'image/gif') { // 動圖無法壓縮，只檢查大小
    if (file.size > MAX_IMAGE_BYTES) throw new Error('GIF 動圖請小於 600 KB。');
    return readAsDataURL(file);
  }
  let bitmap;
  try { bitmap = await createImageBitmap(file); } catch { throw new Error('無法讀取這張圖片，請換一張試試。'); }
  const { width, height } = bitmap;
  if (file.size <= MAX_IMAGE_BYTES && Math.max(width, height) <= MAX_IMAGE_SIDE) {
    bitmap.close?.();
    return readAsDataURL(file);
  }
  let scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(width, height));
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  for (let attempt = 0; attempt < 6; attempt++) {
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    ctx.fillStyle = '#ffffff';               // 透明背景改成白色
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.85, 0.75, 0.65]) {
      const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', quality));
      if (blob && blob.size <= MAX_IMAGE_BYTES) { bitmap.close?.(); return readAsDataURL(blob); }
    }
    scale *= 0.75;
  }
  bitmap.close?.();
  throw new Error('圖片太大，無法壓縮到 600 KB 以內。');
}

// 儲存或刪除後：重新讀取最新資料並更新畫面
async function reloadAfterChange(message) {
  adminFlash = message;
  try {
    data = sortCourses(await api('/api/content'));
    loadState = 'ready';
  } catch (err) {
    if (err.status === 401) return showLogin('登入已過期，請重新登入。');
    adminFlash = message + '（但重新載入失敗，請重新整理頁面）';
  }
  render();
}

// 處理錯誤：登入過期就回到登入畫面，其他錯誤顯示在指定位置
function handleError(err, box) {
  if (err.status === 401) return showLogin('登入已過期，請重新登入。');
  if (box) box.innerHTML = `<div class="msg error">${esc(friendly(err))}</div>`;
  else alert(friendly(err));
}

async function showEditor(i) {
  if (adminType === 'courses' && admin.canManageMembers && !members) {
    try { members = (await api('/api/admin/members')).members; } catch (err) { return handleError(err, null); }
  }
  const box = document.getElementById('editor');
  box.innerHTML = editorHtml(i);
  box.scrollIntoView({ behavior: 'smooth', block: 'start' });
  document.getElementById('cancel').onclick = () => { box.innerHTML = ''; };

  const form = document.getElementById('editform');
  form.onsubmit = async e => {
    e.preventDefault();
    const btn = form.querySelector('[type=submit]');
    const msg = document.getElementById('formmsg');
    msg.innerHTML = '';
    btn.disabled = true;
    btn.textContent = '儲存中…';
    try {
      const body = {};
      for (const [k, v] of new FormData(form).entries()) {
        if (k !== 'image' && k !== 'removeImage' && k !== 'owner') body[k] = v;
      }
      const file = form.elements.image?.files[0];
      if (file) {
        btn.textContent = '處理圖片中…';
        body.image = await prepareImage(file);
        btn.textContent = '儲存中…';
      } else if (form.elements.removeImage?.checked) {
        body.image = '';
      }
      let id = i?.id;
      if (id) await api(`/api/admin/${adminType}/${id}`, { method: 'PUT', body });
      else id = (await api(`/api/admin/${adminType}`, { method: 'POST', body })).id;
      if (adminType === 'courses' && admin.canManageMembers && members && id) {
        const userIds = [...form.querySelectorAll('[name=owner]:checked')].map(x => Number(x.value));
        await api(`/api/admin/courses/${id}/owners`, { method: 'PUT', body: { userIds } });
      }
      await reloadAfterChange(`已儲存「${body.title}」`);
    } catch (err) {
      btn.disabled = false;
      btn.textContent = '儲存資料';
      handleError(err, msg);
    }
  };
}
