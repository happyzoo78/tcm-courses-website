/* admin.js：管理後台、編輯表單、圖片處理、成員管理
   載入順序：core.js → pages.js → admin.js → app.js（順序不能改） */

/* =========================================================
   五、管理後台（登入後才能編輯，資料直接存進雲端資料庫）
   ========================================================= */
const TYPE_NAME = { courses: '課程', items: '圖卡', projects: '活動專案' };
const ROLE_NAME = { owner: '擁有者', admin: '管理員', editor: '編輯者', viewer: '觀看者' };

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
    ? `<div class="msg error">你正在 <b>LINE</b> 裡開啟網頁，Google 不允許在這裡登入。<br>
        <a class="btn" style="margin-top:8px" href="${location.origin}/?openExternalBrowser=1">改用手機瀏覽器開啟</a></div>`
    : inApp === 'other'
    ? `<div class="msg error">你正在 App 的內建瀏覽器裡開啟網頁，Google 不允許在這裡登入。請點右上角的「⋯」選單，選擇「在瀏覽器中開啟」。</div>`
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
      <p class="meta-label">還不能登入嗎？請把你的 Gmail 提供給網站管理者，加入名單後就可以使用。</p>
      <details class="pw-login">
        <summary>管理員密碼登入</summary>
        <div class="notice" style="margin-top:0">⚠️ 為保護帳號安全，<b>密碼連續輸錯 5 次，將暫停登入 15 分鐘</b>。</div>
        <form id="loginform">
          <div class="field"><label for="l-email">Email</label><input id="l-email" name="email" type="email" autocomplete="username" required></div>
          <div class="field"><label for="l-pw">密碼</label><input id="l-pw" name="password" type="password" autocomplete="current-password" required></div>
          <div id="loginmsg"></div>
          <button class="btn" type="submit">登入</button>
        </form>
      </details>
    </div>
  </div>`;
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
  <div class="panel prose" style="margin:6px 0 16px">
    <h3 style="margin-top:0">加入新成員</h3>
    <p class="meta-label" style="margin-top:0">請同學提供他要用來登入的 Gmail。加入後，對方按「使用 Google 帳號登入」就能進入網站。</p>
    <form id="memberform" class="member-form">
      <div class="field"><label for="m-email">Gmail</label><input id="m-email" name="email" type="email" required placeholder="例如 student@gmail.com"></div>
      <div class="field"><label for="m-name">名稱（選填）</label><input id="m-name" name="displayName" maxlength="100" placeholder="例如 王小明"></div>
      <div class="field"><label for="m-role">權限</label><select id="m-role" name="role">${roleOptions('viewer')}</select></div>
      <button class="btn" type="submit">加入名單</button>
    </form>
    <div id="memberformmsg"></div>
    <p class="meta-label">觀看者：只能看內容。編輯者：可以進後台新增、修改，但不能刪除。</p>
  </div>
  <div class="adminlist">
    ${members.map(m => {
      const locked = m.role === 'owner' || m.isSelf;
      const off = m.status !== 'active';
      return `
      <div class="adminrow">
        <div>
          <b>${esc(m.displayName)}</b><span class="role">${ROLE_NAME[m.role] || esc(m.role)}</span>${off ? '<span class="role off">已停用</span>' : ''}
          <br><small>${esc(m.email)} · 最後登入：${esc(fmtTime(m.lastLoginAt))}</small>
        </div>
        <div class="row-actions">
          ${locked ? '<small>（你）</small>' : `
            <select data-member-role="${m.id}" aria-label="變更權限">${roleOptions(m.role)}</select>
            <button type="button" class="btn secondary ${off ? '' : 'danger'}" data-member-status="${m.id}" data-to="${off ? 'active' : 'suspended'}">${off ? '恢復' : '停用'}</button>
            ${m.lastLoginAt ? '' : `<button type="button" class="btn secondary danger" data-member-delete="${m.id}">移除</button>`}`}
        </div>
      </div>`;
    }).join('')}
  </div>`;
}

async function loadMembers() {
  if (membersLoading) return;
  membersLoading = true;
  try {
    members = (await api('/api/admin/members')).members;
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

function pagesAdminHtml() {
  const list = editableCourses();
  if (!list.length) return '<p class="empty">你目前沒有負責的科目。如需上傳網頁，請聯絡網站管理者把你設為科目負責人。</p>';
  if (!list.some(c => c.id === pagesCourse)) pagesCourse = list[0].id;
  const c = getCourse(pagesCourse);
  const rows = pagesOf(pagesCourse);
  return `
  <div class="field" style="max-width:420px"><label for="pg-course">選擇科目</label>
    <select id="pg-course">${list.map(x => `<option value="${x.id}" ${x.id === pagesCourse ? 'selected' : ''}>${esc(semesterLabel(x.semesterCode))}｜${esc(x.title)}</option>`).join('')}</select>
  </div>
  <div class="panel prose" style="margin:6px 0 16px">
    <h3 style="margin-top:0">上傳新網頁到「${esc(c.title)}」</h3>
    <form id="pageform">
      <div class="field"><label for="pg-file">網頁檔（.html，上限約 1.9 MB）</label><input id="pg-file" name="file" type="file" accept=".html,.htm,text/html" required></div>
      <div class="field"><label for="pg-title">標題（留空會自動使用網頁本身的標題）</label><input id="pg-title" name="title" maxlength="200"></div>
      <div class="field"><label for="pg-desc">說明（選填）</label><textarea id="pg-desc" name="description" maxlength="1000"></textarea></div>
      <div id="pageformmsg"></div>
      <button class="btn" type="submit">上傳網頁</button>
    </form>
    <p class="meta-label">網頁上傳後只有登入的班級成員看得到。圖片請直接嵌在網頁檔裡（單一檔案）。</p>
  </div>
  <div class="adminlist">
    ${rows.map(p => `
      <div class="adminrow">
        <div><b>${esc(p.title)}</b><br><small>${fmtSize(p.size)} · 更新：${esc(fmtTime(p.updatedAt))}${p.updatedBy ? ' · ' + esc(p.updatedBy) : ''}</small></div>
        <div class="row-actions">
          <a class="btn secondary" href="${esc(p.url)}" target="_blank" rel="noopener">開啟</a>
          <button type="button" class="btn secondary" data-page-edit="${p.id}">編輯</button>
          <button type="button" class="btn secondary danger" data-page-delete="${p.id}">刪除</button>
        </div>
      </div>`).join('') || '<p class="empty">這個科目還沒有網頁。</p>'}
  </div>
  <div id="editor"></div>`;
}

function pageEditorHtml(p) {
  return `
  <div class="panel prose" style="margin-top:20px">
    <h2>編輯網頁</h2>
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
  return `
  <p class="meta-label">只有「開放中」的學期會顯示在首頁和課程總覽。新學期開始時，在這裡打開即可。</p>
  <div class="adminlist">
    ${[...data.semesters].sort((a, b) => a.sortOrder - b.sortOrder).map(s => `
      <div class="adminrow">
        <div><b>${esc(s.label)}</b>${s.visible ? '<span class="role">開放中</span>' : '<span class="role off">未開放</span>'}<br><small>${esc(s.code)} · ${coursesIn(s.code).length} 個科目</small></div>
        <div class="row-actions"><button type="button" class="btn secondary" data-sem="${esc(s.code)}" data-to="${s.visible ? '0' : '1'}">${s.visible ? '關閉' : '開放'}</button></div>
      </div>`).join('')}
  </div>`;
}

function adminPage() {
  if (!hasAdminAccess()) {
    return '<h2 class="section">管理後台</h2><p class="empty">你的帳號是「觀看者」，沒有後台權限。如需上傳資料，請聯絡網站管理者。</p>';
  }
  const tabs = {
    pages: '網頁',
    ...(admin.canWrite ? TYPE_NAME : {}),
    ...(admin.canManageCourses ? { semesters: '學期' } : {}),
    ...(admin.canManageMembers ? { members: '成員' } : {})
  };
  if (!tabs[adminType]) adminType = 'pages';

  const flash = adminFlash ? `<div class="msg ok">${esc(adminFlash)}</div>` : '';
  adminFlash = '';
  const isCourses = adminType === 'courses';
  const canAdd = isCourses ? admin.canManageCourses : admin.canWrite;
  const canEditRow = isCourses ? admin.canManageCourses : admin.canWrite;
  const rows = data[adminType] || [];
  let body;
  if (adminType === 'members') body = membersHtml();
  else if (adminType === 'pages') body = pagesAdminHtml();
  else if (adminType === 'semesters') body = semestersAdminHtml();
  else body = `
  ${canAdd ? `<button type="button" class="btn" id="add">＋ 新增${TYPE_NAME[adminType]}</button>` : isCourses ? '<p class="meta-label">新增或修改科目由擁有者、管理員負責。</p>' : ''}
  <div class="adminlist">
    ${rows.map(i => `
      <div class="adminrow">
        <div><b>${esc(i.title)}</b><br><small>${isCourses
          ? `${esc(semesterLabel(i.semesterCode))} · ${pagesOf(i.id).length} 份網頁 · 負責人：${i.owners?.length ? i.owners.map(o => esc(o.name)).join('、') : '未指派'}`
          : esc(i.date || '')}${adminType === 'items' ? ' · ' + esc(courseName(i.courseId)) : ''}</small></div>
        <div class="row-actions">
          ${canEditRow ? `<button type="button" class="btn secondary" data-edit="${i.id}">編輯</button>` : ''}
          ${admin.canDelete ? `<button type="button" class="btn secondary danger" data-delete="${i.id}">刪除</button>` : ''}
        </div>
      </div>`).join('') || '<p class="empty">尚無資料</p>'}
  </div>
  <div id="editor"></div>`;

  return `
  <div class="admin-bar">
    <h2 class="section" style="margin:0;border:0;padding:0">管理後台</h2>
    <div><span class="who">${esc(admin.displayName)}（${ROLE_NAME[admin.role] || admin.role}${(admin.ownedCourseIds || []).length ? '・科目負責人' : ''}）</span></div>
  </div>
  <div class="notice">在這裡新增、修改或刪除的內容，會<b>立即儲存到雲端資料庫</b>，所有成員都會看到。</div>
  ${flash}
  <div class="admin-tabs">
    ${Object.keys(tabs).map(t => `<button type="button" class="btn ${adminType === t ? '' : 'secondary'}" data-admin-type="${t}" aria-pressed="${adminType === t}">${tabs[t]}管理</button>`).join('')}
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
    ${admin.canManageMembers ? `<fieldset class="field owners"><legend>科目負責人（可上傳、修改、刪除這個科目的網頁）</legend>
      ${members ? members.filter(m => m.status === 'active' && m.role !== 'owner').map(m => `<label class="check"><input type="checkbox" name="owner" value="${m.id}" ${(i.owners || []).some(o => o.id === m.id) ? 'checked' : ''}> ${esc(m.displayName)} <small>${esc(m.email)}</small></label>`).join('') || '<p class="meta-label">名單上還沒有其他成員。</p>' : '<p class="meta-label">成員名單載入中…</p>'}
    </fieldset>` : ''}
    <div class="field"><label for="f-icon">封面文字（最多 10 字）</label><input id="f-icon" name="icon" maxlength="10" value="${esc(i.icon || '')}"></div>
    <div class="field"><label for="f-lessons">課堂數</label><input id="f-lessons" name="lessons" type="number" min="0" value="${i.lessons ?? 0}"></div>
    <div class="field"><label for="f-cards">圖卡數</label><input id="f-cards" name="cards" type="number" min="0" value="${i.cards ?? 0}"></div>
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
    data = await api('/api/content');
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
