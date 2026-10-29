/* editor.js：在網站裡寫網頁（像 Word 一樣的編輯器，使用開源的 Quill 2.0.3）
   載入順序：core.js → pages.js → admin.js → editor.js → app.js（順序不能改）
   寫好的網頁跟上傳的網頁存在同一個地方（/p/編號），只是多了「線上編輯」的標記。 */

const EDITOR_MARK = '<!--tcm-editor v1-->';
const CONTENT_START = '<!--tcm-content-start-->';
const CONTENT_END = '<!--tcm-content-end-->';

let quill = null;            // 編輯器本體
let editorState = null;      // { courseId, pageId, savedHtml, loading, error }
let editorDirty = false;     // 有沒有尚未儲存的修改
let draftTimer = null;

// 第一次打開編輯器時才下載 Quill（約 200 KB），平常瀏覽網站不會載入
let quillLoading = null;
function loadQuill() {
  if (window.Quill) return Promise.resolve();
  if (quillLoading) return quillLoading;
  quillLoading = new Promise((resolve, reject) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = '/css/vendor/quill.snow.css';
    document.head.appendChild(css);
    const js = document.createElement('script');
    js.src = '/js/vendor/quill.js';
    js.onload = () => resolve();
    js.onerror = () => { quillLoading = null; reject(new Error('編輯器載入失敗，請檢查網路後重新整理。')); };
    document.head.appendChild(js);
  });
  return quillLoading;
}

const draftKey = () => editorState.pageId ? `tcm-draft-page-${editorState.pageId}` : `tcm-draft-new-${editorState.courseId}`;
function readDraft() { try { return JSON.parse(localStorage.getItem(draftKey()) || 'null'); } catch { return null; } }
function clearDraft() { try { localStorage.removeItem(draftKey()); } catch {} }
function saveDraft() {
  if (!quill || !editorDirty) return;
  try {
    localStorage.setItem(draftKey(), JSON.stringify({
      title: document.getElementById('ed-title')?.value || '',
      description: document.getElementById('ed-desc')?.value || '',
      body: quill.root.innerHTML,
      at: new Date().toISOString()
    }));
  } catch {} // 草稿太大存不下時就不存，不影響正式儲存
}

// 網址 #editor/new/科目編號 或 #editor/網頁編號
function editorPage() {
  const [mode, id] = editorTarget;
  const pageRow = mode === 'page' ? data.pages.find(p => p.id == id) : null;
  const courseId = mode === 'new' ? Number(id) : pageRow?.courseId;
  const course = getCourse(courseId);
  if (!course || (mode === 'page' && !pageRow)) return '<p class="empty">找不到這份講義或科目。</p><a class="btn secondary" href="#admin/pages">回網頁管理</a>';
  if (!canEditCourseUI(courseId)) return '<p class="empty">你不是這個科目的負責人，不能在這裡寫講義。</p>';

  return `
  <div class="editor-head">
    <a class="btn secondary back" href="#admin/pages/${courseId}" id="ed-back">← 回講義管理</a>
    <h2 class="section" style="margin:0;border:0;padding:0">${pageRow ? '線上編輯講義' : '寫新講義'} <small>${esc(semesterLabel(course.semesterCode))}｜${esc(course.title)}</small></h2>
  </div>
  <div class="panel prose editor-panel">
    <div class="field"><label for="ed-title">標題</label><input id="ed-title" maxlength="200" required value="${esc(pageRow?.title || '')}" placeholder="例如：第三章 細胞膜 重點整理"></div>
    <div class="field"><label for="ed-desc">說明（選填，會顯示在科目頁的清單上）</label><input id="ed-desc" maxlength="1000" value="${esc(pageRow?.description || '')}"></div>
    <div id="ed-toolbar">
      <span class="ql-formats">
        <select class="ql-header" title="段落樣式"><option value="1">大標題</option><option value="2">中標題</option><option value="3">小標題</option><option selected>內文</option></select>
      </span>
      <span class="ql-formats">
        <button class="ql-bold" title="粗體"></button><button class="ql-italic" title="斜體"></button>
        <button class="ql-underline" title="底線"></button><button class="ql-strike" title="刪除線"></button>
      </span>
      <span class="ql-formats">
        <select class="ql-color" title="文字顏色"></select><select class="ql-background" title="螢光筆"></select>
      </span>
      <span class="ql-formats">
        <button class="ql-list" value="ordered" title="編號清單"></button><button class="ql-list" value="bullet" title="項目符號"></button>
        <button class="ql-indent" value="-1" title="減少縮排"></button><button class="ql-indent" value="+1" title="增加縮排"></button>
        <select class="ql-align" title="對齊"></select>
      </span>
      <span class="ql-formats">
        <button class="ql-blockquote" title="引用框"></button><button class="ql-link" title="連結"></button>
        <button class="ql-image" title="插入圖片"></button><button class="ql-clean" title="清除格式"></button>
      </span>
      <span class="ql-formats ed-table-tools">
        <button type="button" class="ed-tbtn" data-table="insert" title="插入 3×3 表格">＋表格</button>
        <button type="button" class="ed-tbtn" data-table="row" title="在下方加一列">＋列</button>
        <button type="button" class="ed-tbtn" data-table="col" title="在右邊加一欄">＋欄</button>
        <button type="button" class="ed-tbtn" data-table="delrow" title="刪除這一列">－列</button>
        <button type="button" class="ed-tbtn" data-table="delcol" title="刪除這一欄">－欄</button>
        <button type="button" class="ed-tbtn" data-table="deltable" title="刪除整個表格">刪表格</button>
      </span>
    </div>
    <div id="ed-body" class="ed-body"><p class="empty">編輯器載入中…</p></div>
    <p class="meta-label" id="ed-size"></p>
    <div id="ed-msg"></div>
    <div class="ed-actions">
      <button class="btn" type="button" id="ed-save" disabled>儲存講義</button>
      <button class="btn secondary" type="button" id="ed-preview" disabled>預覽</button>
    </div>
    <p class="meta-label">圖片會自動縮小後放進網頁裡；整份網頁上限約 1.9 MB（大約可放 3～6 張照片）。編輯時每隔幾秒會在這台電腦上暫存草稿，不小心關掉也找得回來。</p>
  </div>`;
}

// 畫面出現後才建立編輯器
async function mountEditor() {
  const box = document.getElementById('ed-body');
  if (!box) return;
  const [mode, id] = editorTarget;
  const pageRow = mode === 'page' ? data.pages.find(p => p.id == id) : null;
  editorState = { courseId: mode === 'new' ? Number(id) : pageRow.courseId, pageId: pageRow?.id || null };
  editorDirty = false;
  quill = null;
  const msg = document.getElementById('ed-msg');

  let body = '';
  try {
    await loadQuill();
    if (pageRow) {
      const res = await fetch(pageRow.url, { credentials: 'same-origin' });
      if (res.status === 401) return showLogin('登入已過期，請重新登入。');
      const html = await res.text();
      if (!html.includes(EDITOR_MARK)) throw new Error('這份是上傳的講義網頁，不能在網站裡編輯。請回講義管理，用「編輯」換成新版檔案。');
      body = html.slice(html.indexOf(CONTENT_START) + CONTENT_START.length, html.indexOf(CONTENT_END));
      body = body.replace(/^\s*<div class="ql-content">/, '').replace(/<\/div>\s*$/, '');
    }
  } catch (err) {
    box.innerHTML = '';
    msg.innerHTML = `<div class="msg error">${esc(err.message)}</div>`;
    return;
  }
  if (!document.getElementById('ed-body')) return; // 使用者已經離開這一頁

  box.innerHTML = '';
  quill = new Quill(box, {
    theme: 'snow',
    bounds: '#ed-body',   // 連結輸入框不會超出編輯區
    placeholder: '從這裡開始打字……可以直接從 Word 或網頁複製貼上',
    modules: {
      table: true,
      toolbar: { container: '#ed-toolbar', handlers: { image: insertImage } },
      history: { delay: 1000, maxStack: 200, userOnly: true }
    }
  });
  if (body) quill.clipboard.dangerouslyPasteHTML(body, 'silent');

  // 有暫存的草稿就問要不要恢復
  const draft = readDraft();
  if (draft && draft.body && draft.body !== quill.root.innerHTML) {
    const when = new Date(draft.at).toLocaleString('zh-TW', { hour12: false });
    if (confirm(`找到 ${when} 尚未儲存的草稿，要恢復嗎？\n按「取消」會刪除這份草稿。`)) {
      document.getElementById('ed-title').value = draft.title;
      document.getElementById('ed-desc').value = draft.description;
      quill.clipboard.dangerouslyPasteHTML(draft.body, 'silent');
      editorDirty = true;
    } else {
      clearDraft();
    }
  }
  quill.history.clear();

  const markDirty = () => { editorDirty = true; updateSize(); };
  quill.on('text-change', markDirty);
  document.getElementById('ed-title').oninput = markDirty;
  document.getElementById('ed-desc').oninput = markDirty;
  clearInterval(draftTimer);
  draftTimer = setInterval(saveDraft, 5000);

  document.querySelectorAll('[data-table]').forEach(b => b.onclick = () => tableAction(b.dataset.table));
  const save = document.getElementById('ed-save');
  const preview = document.getElementById('ed-preview');
  save.disabled = preview.disabled = false;
  save.onclick = saveEditorPage;
  preview.onclick = () => {
    const w = window.open('', '_blank');
    if (!w) return alert('瀏覽器擋住了新視窗，請允許本站開啟彈出視窗。');
    w.document.open(); w.document.write(buildPageHtml()); w.document.close();
  };
  updateSize();
  if (!pageRow) document.getElementById('ed-title').focus();
}

function tableAction(kind) {
  const table = quill.getModule('table');
  quill.focus();
  try {
    if (kind === 'insert') return table.insertTable(3, 3);
    const [t] = table.getTable();
    if (!t) return alert('請先把游標點在表格裡面。');
    if (kind === 'row') table.insertRowBelow();
    if (kind === 'col') table.insertColumnRight();
    if (kind === 'delrow') table.deleteRow();
    if (kind === 'delcol') table.deleteColumn();
    if (kind === 'deltable') table.deleteTable();
  } catch { alert('請先把游標點在表格裡面。'); }
}

// 插入圖片：自動縮小（沿用後台圖卡的壓縮規則）
function insertImage() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/png,image/jpeg,image/webp,image/gif';
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    const msg = document.getElementById('ed-msg');
    msg.innerHTML = '<div class="msg">圖片處理中…</div>';
    try {
      const src = await prepareImage(file);
      const range = quill.getSelection(true);
      quill.insertEmbed(range.index, 'image', src, 'user');
      quill.setSelection(range.index + 1, 0);
      msg.innerHTML = '';
    } catch (err) {
      msg.innerHTML = `<div class="msg error">${esc(err.message)}</div>`;
    }
  };
  input.click();
}

const pageBytes = () => new TextEncoder().encode(buildPageHtml()).length;
function updateSize() {
  const el = document.getElementById('ed-size');
  if (!el || !quill) return;
  const n = pageBytes();
  el.textContent = `目前大小：${fmtSize(n)}／上限約 1.9 MB`;
  el.classList.toggle('over', n > 1_900_000);
}

// 把編輯內容包成一份完整、跟網站同風格的網頁
function buildPageHtml() {
  const course = getCourse(editorState.courseId);
  const title = document.getElementById('ed-title').value.trim() || '未命名網頁';
  const body = quill.getSemanticHTML().replace(/&nbsp;/g, ' ');
  const today = new Date().toLocaleDateString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit' });
  return `<!doctype html>
${EDITOR_MARK}
<html lang="zh-Hant"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark"><meta name="robots" content="noindex, nofollow">
<title>${esc(title)}｜${esc(course.title)}｜2026福建中醫台灣班網站</title>
<style>
:root{--bg:#f3ede1;--surface:#fbf7ef;--surface-2:#efe6d4;--ink:#2b2f2a;--muted:#5f5a4c;--line:#ddd0b8;--accent:#3d5e50;--red:#973d2f}
@media (prefers-color-scheme:dark){:root{--bg:#1b1f1d;--surface:#232926;--surface-2:#2b322e;--ink:#e6e0d2;--muted:#b4ab98;--line:#3c4540;--accent:#9cbfa8;--red:#e09a8c}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font-family:"PingFang TC","Microsoft JhengHei","Noto Sans TC",sans-serif;font-size:17px;line-height:1.85}
.top{display:flex;flex-wrap:wrap;gap:6px 16px;justify-content:space-between;align-items:center;padding:12px 20px;background:var(--surface);border-bottom:1px solid var(--line);font-size:15px}
.top a{color:var(--accent);text-decoration:none;font-weight:600}.top .site{color:var(--muted)}
main{max-width:860px;margin:0 auto;padding:28px 20px 40px}
.kicker{margin:0;color:var(--accent);font-size:14px;letter-spacing:2px}
h1{font-family:"Noto Serif TC", "Noto Serif CJK TC", "Source Han Serif TC", "Songti TC", "STSong", "Songti SC", "SimSun", "PMingLiU", serif;font-size:30px;line-height:1.4;margin:6px 0 4px}
.meta{margin:0 0 22px;color:var(--muted);font-size:14px}
.ql-content{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:22px 26px;overflow-wrap:anywhere}
.ql-content h1,.ql-content h2,.ql-content h3{font-family:"Noto Serif TC", "Noto Serif CJK TC", "Source Han Serif TC", "Songti TC", "STSong", "Songti SC", "SimSun", "PMingLiU", serif;line-height:1.45;margin:1.3em 0 .5em}
.ql-content h1{font-size:26px;border-bottom:2px solid var(--line);padding-bottom:4px}.ql-content h2{font-size:22px;color:var(--accent)}.ql-content h3{font-size:19px}
.ql-content>:first-child{margin-top:0}.ql-content p{margin:.5em 0}
.ql-content blockquote{margin:1em 0;padding:8px 16px;border-left:4px solid var(--accent);background:var(--surface-2);border-radius:0 8px 8px 0}
.ql-content img{max-width:100%;height:auto;border-radius:8px}
.ql-content a{color:var(--accent)}
.ql-content table{border-collapse:collapse;width:100%;margin:1em 0;display:block;overflow-x:auto;border:1px solid var(--line)!important}
.ql-content td,.ql-content th{border:1px solid var(--line)!important;padding:6px 10px;vertical-align:top;min-width:4em;height:2.4em}
.ql-content tr:first-child td{background:var(--surface-2);font-weight:600}
.ql-content .ql-align-center{text-align:center}.ql-content .ql-align-right{text-align:right}.ql-content .ql-align-justify{text-align:justify}
${[1, 2, 3, 4, 5, 6, 7, 8].map(n => `.ql-content .ql-indent-${n}{padding-left:${n * 2}em}`).join('')}
footer{max-width:860px;margin:0 auto;padding:0 20px 30px;color:var(--muted);font-size:14px}
@media (max-width:600px){h1{font-size:24px}.ql-content{padding:16px}main{padding:20px 14px 32px}}
@media print{.top,footer{display:none}body{background:#fff;color:#000}.ql-content{border:0;padding:0}}
</style></head>
<body>
<div class="top"><a href="/#course/${course.id}">← 回到「${esc(course.title)}」</a><span class="site">2026福建中醫台灣班網站</span></div>
<main>
<p class="kicker">${esc(semesterLabel(course.semesterCode))}｜${esc(course.title)}</p>
<h1>${esc(title)}</h1>
<p class="meta">${esc(admin.displayName)} · 最後更新 ${esc(today)}</p>
${CONTENT_START}<div class="ql-content">${body}</div>${CONTENT_END}
</main>
<footer>本頁內容僅供班級成員學習使用，請勿轉貼或外流，並尊重教材著作權。</footer>
</body></html>`;
}

async function saveEditorPage() {
  const btn = document.getElementById('ed-save');
  const msg = document.getElementById('ed-msg');
  const title = document.getElementById('ed-title').value.trim();
  msg.innerHTML = '';
  if (!title) { msg.innerHTML = '<div class="msg error">請填寫標題。</div>'; document.getElementById('ed-title').focus(); return; }
  if (quill.getLength() <= 1) { msg.innerHTML = '<div class="msg error">內容是空的，請先寫一些內容。</div>'; return; }
  const html = buildPageHtml();
  if (new TextEncoder().encode(html).length > 1_900_000) {
    msg.innerHTML = '<div class="msg error">網頁超過 1.9 MB，請刪掉幾張圖片，或把內容拆成兩頁。</div>';
    return;
  }
  btn.disabled = true;
  btn.textContent = '儲存中…';
  const body = { title, description: document.getElementById('ed-desc').value, html };
  try {
    let id = editorState.pageId;
    if (id) await api(`/api/admin/pages/${id}`, { method: 'PUT', body });
    else id = (await api('/api/admin/pages', { method: 'POST', body: { ...body, courseId: editorState.courseId } })).id;
    clearDraft();
    editorDirty = false;
    clearInterval(draftTimer);
    pagesCourse = editorState.courseId;
    adminType = 'pages';
    // 先讀最新清單，再切回網頁管理（切換時會顯示提示訊息）
    try { data = sortCourses(await api('/api/content')); } catch (err) { if (err.status === 401) return showLogin('登入已過期，請重新登入。'); }
    adminFlash = `已儲存「${title}」，網址：${location.origin}/p/${id}`;
    location.hash = `admin/pages/${editorState.courseId}`;
  } catch (err) {
    btn.disabled = false;
    btn.textContent = '儲存講義';
    handleError(err, msg);
  }
}

// 離開編輯器前提醒（關閉分頁、重新整理）
window.addEventListener('beforeunload', e => {
  if (page === 'editor' && editorDirty) { saveDraft(); e.preventDefault(); e.returnValue = ''; }
});
