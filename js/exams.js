/* exams.js：模擬考題（作答、看結果、後台出題、全班統計）
   載入順序：core.js → pages.js → admin.js → editor.js → exams.js → app.js（順序不能改） */

const EXAM_TYPE = { single: '單選題', multi: '多選題', tf: '是非題', fill: '填空題', essay: '申論題' };
const BLANK_RE = /_{2,}|＿{1,}|（\s*）|\(\s*\)/g;
let examEditDirty = false;   // 出題頁有沒有尚未儲存的修改

const examsOf = courseId => (data.exams || []).filter(e => e.courseId == courseId)
  .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
const nl2br = s => esc(s).replace(/\n/g, '<br>');
const pctText = (s, m) => m ? `${Math.round(s / m * 1000) / 10}%` : '—';

/* 出題格式（後台說明、也可以複製給 NotebookLM／Claude 出題用） */
const EXAM_FORMAT = `一、單選題（每題 1 分）
1. 下列哪一項屬於「陰中之陽」？
A. 上午
B. 下午
C. 前半夜
D. 後半夜
答案：D
解析：後半夜屬陰中之陽。
圖卡：01-03

二、多選題
2. 下列屬於陽的有？
A. 上　B. 下　C. 外　D. 內
答案：AC

三、共用選項題
A. 心
B. 肝
C. 脾
D. 肺
E. 腎
3. 主疏泄的臟是
答案：B
4. 主運化的臟是
答案：C

四、是非題
5. 陰陽之間是對立統一的關係。
答案：對

五、填空題
6. 五行中木生＿＿，火生＿＿。
答案：火；土

六、申論題
7. 試述陰陽學說的基本內容。
參考答案：
（1）陰陽對立制約（2）陰陽互根互用
（3）陰陽消長平衡（4）陰陽相互轉化
評分要點：四點各 2.5 分。
配分：10`;

const EXAM_PROMPT = `請依照下面的格式出題，只輸出題目本身，不要加其他說明：
- 每題用「數字.」開頭；選項用「A.」「B.」開頭（可以放同一行）。
- 每題都要有「答案：」；多選題答案寫成 ACD；是非題寫「對」或「錯」。
- 填空題的空格用「＿＿」，多個空格的答案用「；」分開，同義答案用「/」分開（例如：目/眼）。
- 共用選項題：先列出 A～E 選項，底下每個小題只寫題目和答案。
- 申論題要有「參考答案：」，可加「評分要點：」和「配分：10」。
- 解析寫在「解析：」後面；解析或參考答案裡的分點請用（1）（2），不要用「1.」「2.」。
- 段落標題可寫「一、單選題（每題 2 分）」，會自動套用配分。
- （可省略）「圖卡：00-06」＝這題可對照的圖卡編號（章號-張號），多張用「、」分開；同學交卷後在解析下方可點開看大圖。

範例：
${EXAM_FORMAT}`;

/* ---------- 科目頁、後台清單 ---------- */
// 分類建議：全站共用分類（manifest.json 的 examCategories）
const OTHER_CATEGORY = '其他試題';
let examTab = {};   // 每個科目目前選的分類標籤

// 依分類標籤分組；沒有考卷的標籤不會出現。標籤順序依該標籤最早建立的考卷
// 依標準分類分組（舊名稱自動對到新分類）；順序依全站分類表，表外的分類接在後面，「其他試題」最後；沒有試題的分類不出現
function examGroups(courseId) {
  const groups = new Map();
  for (const e of examsOf(courseId)) {
    const k = examCatName(courseId, e.category) || OTHER_CATEGORY;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(e);
  }
  const order = examCatsOf(courseId).map(x => x.name);
  const rank = k => k === OTHER_CATEGORY ? 1e9 : (order.indexOf(k) + 1 || 1e6);
  return [...groups.entries()].sort((a, b) => rank(a[0]) - rank(b[0]))
    .map(([k, list]) => [k, list.slice().sort((x, y) => x.sortOrder - y.sortOrder || x.id - y.id)]);
}
// 試題名稱 → 章號、節號：「03 藏象」→ {ch:3, sec:null}；「03 藏象 - 全題」→ sec 0；「03 藏象 - 02 脾肝腎」→ sec 2
function examKey(e, c) {
  const parts = shortExamTitle(e, c).split(/\s+-\s+/);
  const m = /^\s*(\d+)/.exec(parts[0] || '');
  if (!m) return null;
  const rest = parts.slice(1).join(' - ');
  let sec = null;
  if (rest) { const n = /^\s*(\d+)/.exec(rest); sec = /^(全題|全章)/.test(rest.trim()) ? 0 : n ? Number(n[1]) : undefined; }
  return { ch: Number(m[1]), sec, chName: parts[0].replace(/^\s*\d+\s*/, ''), secName: rest.replace(/^\s*\d+\s*/, '') };
}
// 依章節表組出標準名稱與排序（排序＝章號×100＋節號）
function examCanon(courseId, ch, sec, fallbackCh = '', fallbackSec = '') {
  const syl = syllabusOf(courseId);
  const chap = sylChapter(courseId, ch);
  if (syl && !chap) return { err: `章號 ${pad2(ch)} 不在章節表上` };
  const chTitle = chap ? chap.title : fallbackCh;
  let title = `${pad2(ch)} ${chTitle}`.trim();
  if (sec === 0) title += ' - 全題';
  else if (sec > 0) {
    const s = sylSection(courseId, ch, sec);
    if (syl && !s && !fallbackSec) return { err: `第 ${pad2(ch)} 章沒有第 ${pad2(sec)} 節（請先更新章節表）` };
    title += ` - ${pad2(sec)} ${s ? s.title : fallbackSec}`;
  }
  return { title, sort: ch * 100 + (sec || 0) };
}

function examRowHtml(e, label) {
  return `
      <a class="pagerow exam-row" href="#exam/${e.id}" title="${esc(e.title)}">
        <span class="pr-title">${esc(label || e.title)}${/^全題/.test(label || '') ? ' <small class="ex-hint">整章一次作答，要分段請做下面各節</small>' : ''}${e.published ? '' : ' <span class="role off">草稿</span>'}</span>
        ${e.description ? `<span class="pr-desc">${esc(cut(e.description, 120))}</span>` : ''}
        <span class="pr-meta">${e.questionCount} 題 · 滿分 ${e.totalPoints} 分${e.myAttempts ? ` · 我作答 ${e.myAttempts} 次，最佳 ${e.myBest}%` : ' · 尚未作答'}</span>
      </a>`;
}

// 子項選單：把同一分類的考卷依「NN 章名 - NN 子項」分章。
// 名稱只有一段（例如「03 藏象」）就單獨一列；有子項的章收成可展開的選單。
// 章名開頭的章號，例如「03 藏象」→「03」
const examChapNo = name => (/^\s*(\d+)/.exec(name || '') || [])[1] || '';
function examChapters(list, c) {
  const map = new Map();
  for (const e of list) {
    const parts = shortExamTitle(e, c).split(/\s+-\s+/);
    const ch = parts[0];
    const sub = parts.length > 1 ? parts.slice(1).join(' - ') : '';
    if (!map.has(ch)) map.set(ch, []);
    map.get(ch).push({ e, sub });
  }
  return [...map.entries()].map(([chapter, items]) => ({ chapter, items, menu: items.length > 1 || items.some(i => i.sub) }));
}
// 試題清單依章分組：有子項的章顯示章名標題，子項縮排在下面；只有一份的章照常一列
function examGroupedHtml(chapters, rowFn) {
  return chapters.map(g => g.menu ? `
    <section class="exgrp">
      <div class="exgrp-head"><span class="exgrp-name">${esc(g.chapter)}</span><span class="exgrp-count">${g.items.length} 份</span></div>
      <div class="exgrp-list">${g.items.map(i => rowFn(i.e, i.sub || g.chapter)).join('')}</div>
    </section>` : rowFn(g.items[0].e, g.chapter)).join('');
}
const examChapOpen = new Set();   // 這次瀏覽時展開過的章（重新整理後收合）
const chapKey = (cid, cat, ch) => `${cid}|${cat}|${ch}`;

function examListHtml(list, c, cat) {
  return examChapters(list, c).map(g => g.menu ? `
      <details class="exchap" data-chap="${esc(chapKey(c.id, cat, g.chapter))}" ${examChapOpen.has(chapKey(c.id, cat, g.chapter)) ? 'open' : ''}>
        <summary><span class="exchap-name">${esc(g.chapter)}</span><span class="exchap-count">${g.items.length} 份</span></summary>
        <div class="pagelist exchap-list">${g.items.map(i => examRowHtml(i.e, i.sub || g.chapter)).join('')}</div>
      </details>`
    : examRowHtml(g.items[0].e, g.chapter)).join('');
}

// 同學端考卷瀏覽：分類（｜）→ 章節（內嵌小框）→ 考卷清單。科目頁與模擬考專區共用
const examFilter = {};   // 每個科目目前選的分類、章節
// 分類說明：全站分類表的 note，各科可在章節表 categoryNotes 改寫（例如中基的「課堂練習」寫明出自學習通）
const examCatNote = (courseId, cat) => { const n = examCatNoteOf(courseId, cat); return n ? `<div class="note-box ex-note"><span class="note-lab">出題說明</span>${n}</div>` : ''; };
function examBrowserHtml(c) {
  const groups = examGroups(c.id);
  if (!groups.length) return '<p class="empty-note">這個科目還沒有試題。</p>';
  const f = examFilter[c.id] || (examFilter[c.id] = { cat: '', ch: '' });
  if (!groups.some(g => g[0] === f.cat)) { f.cat = groups[0][0]; f.ch = ''; }
  const rows = groups.find(g => g[0] === f.cat)[1];
  const chapters = examChapters(rows, c);
  // 換分類時（或從圖卡「學習試題」進來）停在同一個章號
  if (f.want) { f.ch = (chapters.find(g => examChapNo(g.chapter) === f.want) || {}).chapter || ''; delete f.want; }
  if (f.ch && !chapters.some(g => g.chapter === f.ch)) f.ch = '';
  const shownChaps = f.ch ? chapters.filter(g => g.chapter === f.ch) : chapters;
  const showChaps = chapters.length > 1 || chapters.some(g => g.menu);
  return `
    <div class="exnav-cats" role="tablist" aria-label="分類">${groups.map(([name, r]) => `<button type="button" role="tab" class="ex-cat" data-xb-cat="${esc(name)}" data-course="${c.id}" aria-selected="${name === f.cat}">${esc(name)}<small>${r.length}</small></button>`).join('<span class="ex-sep" aria-hidden="true">｜</span>')}</div>
    ${examCatNote(c.id, f.cat)}
    ${showChaps ? `
    <div class="exnav-chaps" aria-label="章節">
      <span class="exnav-cap">${esc(f.cat)} › 章節</span>
      <button type="button" class="ex-ch" data-xb-ch="" data-course="${c.id}" aria-pressed="${!f.ch}">全部<small>${rows.length}</small></button>
      ${chapters.map(g => `<button type="button" class="ex-ch" data-xb-ch="${esc(g.chapter)}" data-course="${c.id}" aria-pressed="${g.chapter === f.ch}">${esc(g.chapter)}${g.items.length > 1 ? `<small>${g.items.length}</small>` : ''}</button>`).join('')}
    </div>` : ''}
    <div class="pagelist xb-list">${examGroupedHtml(shownChaps, examRowHtml)}</div>`;
}

function courseExamsHtml(c) {
  const manage = canEditCourseUI(c.id);
  if (!examGroups(c.id).length && !manage) return '';   // 沒有考卷就整區隱藏
  return `
  <h3 class="sec-title">試題${manage ? `<a class="more-btn sec-link" href="#admin/exams/${c.id}">管理試題<span class="arr" aria-hidden="true">›</span></a>` : ''}</h3>
  <div class="exnav">${examBrowserHtml(c)}</div>`;
}

// 分類標籤只切換同一個科目的區塊（模擬考專區同一頁有好幾個科目）
function bindExamTabs() {
  document.querySelectorAll('[data-exam-tab]').forEach(b => b.onclick = () => {
    const cid = b.dataset.course;
    examTab[cid] = b.dataset.examTab;
    document.querySelectorAll(`[data-exam-tab][data-course="${cid}"]`).forEach(x => x.setAttribute('aria-selected', String(x === b)));
    document.querySelectorAll(`[data-exam-panel][data-course="${cid}"]`).forEach(p => { p.hidden = p.dataset.examPanel !== b.dataset.examTab; });
  });
  document.querySelectorAll('details.exchap').forEach(d => d.addEventListener('toggle', () => examChapOpen[d.open ? 'add' : 'delete'](d.dataset.chap)));
  document.querySelectorAll('[data-zone-course]').forEach(b => b.onclick = () => { zoneCourseSel[siteYear] = Number(b.dataset.zoneCourse); render(); });
  document.querySelectorAll('[data-xb-cat]').forEach(b => b.onclick = () => { const was = examFilter[b.dataset.course]?.ch; examFilter[b.dataset.course] = { cat: b.dataset.xbCat, ch: '', want: examChapNo(was) }; render(); });
  document.querySelectorAll('[data-xb-ch]').forEach(b => b.onclick = () => { examFilter[b.dataset.course].ch = b.dataset.xbCh; render(); });
}

function examsAdminHtml() {
  const list = editableCourses();
  if (!list.length) return '<p class="empty">你目前沒有負責的科目。如需出題，請聯絡網站管理者把你設為科目負責人。</p>';
  pagesCourse = adminPickCourse(list);
  const c = getCourse(pagesCourse);
  const groups = examGroups(pagesCourse);
  const f = examAdminFilter[c.id] || (examAdminFilter[c.id] = { cat: '', ch: '' });
  if (!groups.some(g => g[0] === f.cat)) { f.cat = groups[0]?.[0] || ''; f.ch = ''; }
  const rows = (groups.find(g => g[0] === f.cat) || [, []])[1];
  const chapters = examChapters(rows, c);
  // 換分類時（或從圖卡「學習試題」進來）停在同一個章號
  if (f.want) { f.ch = (chapters.find(g => examChapNo(g.chapter) === f.want) || {}).chapter || ''; delete f.want; }
  if (f.ch && !chapters.some(g => g.chapter === f.ch)) f.ch = '';
  const shownChaps = f.ch ? chapters.filter(g => g.chapter === f.ch) : chapters;
  const adminRow = (e, label) => `
      <div class="adminrow">
        <div><b title="${esc(e.title)}">${esc(label)}</b>${e.published ? '<span class="role">公開</span>' : '<span class="role off">草稿</span>'}<br><small>排序 ${e.sortOrder} · ${e.questionCount} 題 · 滿分 ${e.totalPoints} 分<span class="hide-m"> · 更新：${esc(fmtTime(e.updatedAt))}</span></small></div>
        <div class="row-actions">
          <a class="btn secondary" href="#exam/${e.id}">作答</a>
          <a class="btn secondary" href="#examedit/${e.id}">編輯</a>
          <a class="btn secondary" href="#examstats/${e.id}">統計</a>
          <button type="button" class="btn secondary danger" data-exam-delete="${e.id}">刪除</button>
        </div>
      </div>`;
  const total = groups.reduce((n, g) => n + g[1].length, 0);
  return `
  ${adminCoursePicker(list, c.id, x => examGroups(x.id).reduce((n, g) => n + g[1].length, 0))}
  <div class="exnav">
    ${adminCourseTop(c, `<span class="exnav-actions">${syllabusOf(c.id) ? `<button type="button" class="btn secondary" id="tidy-toggle" aria-expanded="${tidyOpen}">套用命名規則</button>` : ''}<button type="button" class="btn secondary" id="bulk-toggle" aria-expanded="${bulkOpen}">批次上傳</button><a class="btn exnav-add" href="#examedit/new/${c.id}" data-new-cat="${esc(f.cat === OTHER_CATEGORY ? '' : f.cat)}" title="把題目整份貼上，網站會自動拆題、批改、統計">＋ 新增試題</a></span>`)}
    ${bulkOpen ? bulkPanelHtml(c, f.cat === OTHER_CATEGORY ? '' : f.cat) : ''}
    ${tidyOpen ? tidyPanelHtml(c) : ''}
    ${groups.length ? `
    <div class="exnav-cats" role="tablist" aria-label="分類">${groups.map(([name, r]) => `<button type="button" role="tab" class="ex-cat" data-ex-cat="${esc(name)}" aria-selected="${name === f.cat}">${esc(name)}<small>${r.length}</small></button>`).join('<span class="ex-sep" aria-hidden="true">｜</span>')}</div>
    <div class="exnav-chaps" aria-label="章節">
      <span class="exnav-cap">${esc(f.cat)} › 章節</span>
      <button type="button" class="ex-ch" data-ex-ch="" aria-pressed="${!f.ch}">全部<small>${rows.length}</small></button>
      ${chapters.map(g => `<button type="button" class="ex-ch" data-ex-ch="${esc(g.chapter)}" aria-pressed="${g.chapter === f.ch}">${esc(g.chapter)}${g.items.length > 1 ? `<small>${g.items.length}</small>` : ''}</button>`).join('')}
    </div>` : '<p class="exnav-empty">這個科目還沒有試題。按「＋ 新增試題」，把題目整份貼上，網站會自動拆題、批改、統計。</p>'}
  </div>
  <div class="adminlist exam-adminlist">
    ${examGroupedHtml(shownChaps, adminRow) || '<p class="empty-note">這個分類還沒有試題。按「＋ 新增試題」，把題目整份貼上。</p>'}
  </div>`;
}
const examAdminFilter = {};   // 每個科目目前選的分類、章節

// 後台考卷清單：標題去掉重複的「科目名稱 - 分類 - 」前綴，完整標題放在滑鼠提示
function shortExamTitle(e, c) {
  let t = String(e.title || '');
  const parts = t.split(/\s+-\s+/);
  if (parts.length > 1 && parts[0].trim() === c.title) parts.shift();
  if (parts.length > 1 && e.category && (parts[0].trim().startsWith(e.category) || examCatDef(c.id, parts[0].trim()))) parts.shift();
  return parts.join(' - ') || t;
}

let examNewCategory = '';   // 從某個分類按「新增」時，預先填好分類

/* ---------- 批次上傳（2026-10-30 命名規範）----------
   檔名：[科目代碼-]分類代碼-章號[-節號][-任意說明].txt
     例：full-03-01.txt（全章模擬考 第 03 章 第 01 節）、class-07.txt（課堂練習 第 07 章）、full-03-00.txt（第 03 章 全題）
   分類、章名、節名、排序都由網站依分類表與章節表自動決定；舊檔名（任意前綴-NN-章名[-NN-子項].txt）仍可用，分類取自下拉選單 */
let bulkOpen = false;
let bulkRows = [];
function bulkPanelHtml(c, cat) {
  const cats = examCatsOf(c.id);
  const syl = syllabusOf(c.id);
  return `
  <div class="panel prose bulk-panel">
    <div class="panel-head"><h3>批次上傳</h3><p>一次選多個 txt 檔，網站依檔名自動判斷分類、章節、名稱與排序；同一章節已有試題就更新內容（作答紀錄保留）。</p></div>
    <div class="note-box"><span class="note-lab">檔名規則</span>
      <code>分類代碼-章號[-節號].txt</code>，例如 <code>full-03-01.txt</code>＝全章模擬考 第 03 章第 01 節；<code>full-03-00.txt</code>＝第 03 章「全題」；<code>class-07.txt</code>＝課堂練習 第 07 章。<br>
      分類代碼：${cats.map(x => `<code>${esc(x.code)}</code> ${esc(x.name)}`).join('、')}。${syl ? '章名、節名由<strong>章節表</strong>自動帶出，檔名不用寫中文。' : '<strong>這個科目還沒有章節表</strong>，請用舊檔名（含章名）或先請網站管理者建立章節表。'}</div>
    <div class="bulk-fields">
      <div class="field"><label for="bulk-cat">分類（檔名沒有分類代碼時使用）</label>
        <select id="bulk-cat">${cats.map(x => `<option value="${esc(x.name)}" ${x.name === cat ? 'selected' : ''}>${esc(x.name)}（${esc(x.code)}）</option>`).join('')}</select></div>
      <div class="field"><label for="bulk-files">選擇 txt 檔（可多選）</label><input id="bulk-files" type="file" accept=".txt,text/plain" multiple></div>
    </div>
    <label class="check"><input type="checkbox" id="bulk-pub" checked> 新增的試題公開給同學作答</label>
    <div id="bulk-preview">${bulkTableHtml(c)}</div>
    <div id="bulk-msg"></div>
    <div class="ed-actions"><button type="button" class="btn" id="bulk-go" ${bulkRows.length && bulkRows.every(r => r.ok) ? '' : 'disabled'}>開始上傳</button></div>
  </div>`;
}
function bulkTableHtml(c) {
  if (!bulkRows.length) return '';
  const act = { create: '新增', update: '更新內容（作答紀錄保留）', rename: '原本的整章試題改名為「全題」' };
  return `<table class="bulk-table"><thead><tr><th>分類 · 試題名稱</th><th>排序</th><th>題數／總分</th><th>動作</th></tr></thead><tbody>${bulkRows.map(r => `
    <tr class="${r.ok ? '' : 'bad'}"><td><small>${esc(r.cat || '')}</small><br>${esc(r.title || '')}<br><small>${esc(r.file)}</small></td>
    <td>${esc(r.sort ?? '')}</td>
    <td>${r.ok ? (r.count != null ? `${r.count} 題／${r.total} 分` : '—') : `<span class="unassigned">${esc(r.err)}</span>`}</td>
    <td>${r.status ? esc(r.status) : act[r.action] || ''}</td></tr>`).join('')}</tbody></table>`;
}
// 檔名解析：回傳 { catName, ch, sec, chName, secName } 或 { err }
function bulkParseName(c, file, fallbackCat) {
  const parts = file.replace(/\.txt$/i, '').split('-').map(x => x.trim()).filter(Boolean);
  const cats = examCatsOf(c.id);
  const ci = parts.findIndex(x => cats.some(k => k.code === x.toLowerCase()));
  if (ci >= 0 && /^\d{1,3}$/.test(parts[ci + 1] || '')) {
    const cat = cats.find(k => k.code === parts[ci].toLowerCase());
    const ch = Number(parts[ci + 1]);
    const sec = /^\d{1,3}$/.test(parts[ci + 2] || '') ? Number(parts[ci + 2]) : null;
    return { catName: cat.name, ch, sec };
  }
  // 舊檔名：任意前綴-NN-章名[-NN-子項]
  const i = parts.findIndex(x => /^\d{1,3}$/.test(x));
  if (i < 0 || !parts[i + 1]) return { err: '檔名看不出分類與章節（例如 full-03-01.txt）' };
  const hasSub = /^\d{1,3}$/.test(parts[i + 2] || '') && parts[i + 3];
  return { catName: fallbackCat, ch: Number(parts[i]), sec: hasSub ? Number(parts[i + 2]) : null, chName: parts[i + 1], secName: hasSub ? parts[i + 3] : '' };
}
async function bulkPrepare(c, files) {
  const fallbackCat = document.getElementById('bulk-cat').value;
  const whole = x => x === 0 || x === null;   // 「整章一份」與「全題」視為同一份
  const sameKey = (e, catName, ch, sec) => { const k = examKey(e, c); return examCatName(c.id, e.category) === catName && k && k.ch === ch && (k.sec === sec || (whole(k.sec) && whole(sec))); };
  bulkRows = [];
  const renames = new Map();
  for (const f of [...files].sort((a, b) => a.name.localeCompare(b.name))) {
    const row = { file: f.name, ok: false };
    const n = bulkParseName(c, f.name, fallbackCat);
    if (n.err) { row.err = n.err; bulkRows.push(row); continue; }
    const canon = examCanon(c.id, n.ch, n.sec, n.chName, n.secName);
    row.cat = n.catName;
    if (canon.err) { row.err = canon.err; bulkRows.push(row); continue; }
    row.title = canon.title; row.sort = canon.sort;
    row.source = await f.text();
    const same = examsOf(c.id).find(e => sameKey(e, n.catName, n.ch, n.sec));
    if (same) { row.action = 'update'; row.targetId = same.id; }
    else row.action = 'create';
    // 新增某章的「節」時，網站上原本只有一份的整章試題自動改名為「全題」
    if (n.sec > 0) {
      const single = examsOf(c.id).find(e => { const k = examKey(e, c); return examCatName(c.id, e.category) === n.catName && k && k.ch === n.ch && k.sec === null; });
      if (single && !renames.has(single.id)) {
        const w = examCanon(c.id, n.ch, 0, n.chName);
        renames.set(single.id, { file: '（網站上原有的整章試題）', cat: n.catName, ok: true, action: 'rename', targetId: single.id, title: w.title, sort: w.sort, count: single.questionCount, total: single.totalPoints });
      }
    }
    try {
      const p = await api('/api/admin/exams/preview', { method: 'POST', body: { source: row.source } });
      if (p.errors.length) row.err = `格式有 ${p.errors.length} 個問題：${p.errors[0].message}`;
      else { row.ok = true; row.count = p.summary.questionCount; row.total = p.summary.total; }
    } catch (err) { row.err = err.message || '檢查失敗'; }
    bulkRows.push(row);
  }
  bulkRows.push(...renames.values());
  const dup = new Set();
  for (const r of bulkRows) { const k = `${r.cat}|${r.title}`; if (r.title && dup.has(k)) { r.ok = false; r.err = '和另一個檔案是同一個章節，請只留一個'; } dup.add(k); }
  bulkRows.sort((a, b) => String(a.cat).localeCompare(String(b.cat)) || (Number(a.sort) || 0) - (Number(b.sort) || 0));
}

/* ---------- 套用命名規則：把現有試題的分類、名稱、排序整理成規範（只改名稱與排序，不動題目與作答紀錄）---------- */
let tidyOpen = false;
let tidyRows = [];
function tidyCompute(c) {
  return examsOf(c.id).map(e => {
    const cat = examCatName(c.id, e.category) || e.category || '';
    const k = examKey(e, c);
    const row = { id: e.id, oldTitle: e.title, oldCat: e.category || '', oldSort: e.sortOrder, cat, title: e.title, sort: e.sortOrder };
    if (!k || k.sec === undefined) { row.note = '名稱看不出章節，保持原樣'; return row; }
    const canon = examCanon(c.id, k.ch, k.sec, k.chName, k.secName);
    if (canon.err) { row.note = canon.err + '，保持原樣'; return row; }
    row.title = canon.title; row.sort = canon.sort;
    return row;
  }).map(r => ({ ...r, changed: r.title !== r.oldTitle || r.cat !== r.oldCat || r.sort !== r.oldSort }))
    .sort((a, b) => a.cat.localeCompare(b.cat) || a.sort - b.sort);
}
function tidyPanelHtml(c) {
  const ch = tidyRows.filter(r => r.changed);
  return `
  <div class="panel prose bulk-panel">
    <div class="panel-head"><h3>套用命名規則</h3><p>依分類表與章節表，把這個科目所有試題的分類、名稱、排序整理成規範。<strong>只改名稱與排序</strong>，題目內容、公開狀態、作答紀錄都不變。</p></div>
    ${ch.length ? `<table class="bulk-table"><thead><tr><th>現在</th><th>整理後</th><th>排序</th></tr></thead><tbody>${ch.map(r => `
      <tr><td><small>${esc(r.oldCat)}</small><br>${esc(r.oldTitle)}</td><td><small>${esc(r.cat)}</small><br><b>${esc(r.title)}</b>${r.status ? `<br><small>${esc(r.status)}</small>` : ''}</td><td>${r.oldSort} → ${r.sort}</td></tr>`).join('')}</tbody></table>`
      : '<p class="msg ok">這個科目的試題都已符合命名規則。</p>'}
    ${tidyRows.filter(r => r.note).map(r => `<p class="meta-label">⚠ ${esc(r.oldTitle)}：${esc(r.note)}</p>`).join('')}
    <div id="tidy-msg"></div>
    <div class="ed-actions">${ch.length ? `<button type="button" class="btn" id="tidy-go">套用 ${ch.length} 份</button>` : ''}<button type="button" class="btn secondary" id="tidy-close">關閉</button></div>
  </div>`;
}

function bindExamsAdmin() {
  bindAdminPicker();
  const bt = document.getElementById('bulk-toggle');
  if (bt) bt.onclick = () => { bulkOpen = !bulkOpen; tidyOpen = false; if (!bulkOpen) bulkRows = []; render(); };
  const bf = document.getElementById('bulk-files');
  if (bf) bf.onchange = async () => {
    const c = getCourse(pagesCourse);
    document.getElementById('bulk-msg').innerHTML = '<div class="msg ok">檢查中…</div>';
    const keep = { cat: document.getElementById('bulk-cat').value, pub: document.getElementById('bulk-pub').checked };
    await bulkPrepare(c, bf.files);
    render();
    document.getElementById('bulk-cat').value = keep.cat; document.getElementById('bulk-pub').checked = keep.pub;
    const bad = bulkRows.filter(r => !r.ok).length;
    document.getElementById('bulk-msg').innerHTML = bad ? `<div class="msg error">${bad} 個檔案有問題，請修正後重新選擇。</div>` : `<div class="msg ok">${bulkRows.length} 個檔案都正確，確認分類、名稱與排序後按「開始上傳」。</div>`;
  };
  const go = document.getElementById('bulk-go');
  if (go) go.onclick = async () => {
    const c = getCourse(pagesCourse), pub = document.getElementById('bulk-pub').checked;
    if (!confirm(`要上傳 ${bulkRows.length} 份試題嗎？\n已有的試題：只改解析或對照圖卡時不會改版；題目、選項、答案、配分有改才會變成新版本（舊作答紀錄保留）。`)) return;
    go.disabled = true;
    let okN = 0, upd = 0, newV = 0;
    for (const r of bulkRows) {
      r.status = '上傳中…'; document.getElementById('bulk-preview').innerHTML = bulkTableHtml(c);
      try {
        let note = '';
        if (r.action === 'rename') await api(`/api/admin/exams/${r.targetId}`, { method: 'PUT', body: { title: r.title, category: r.cat, sortOrder: Number(r.sort) } });
        else if (r.action === 'update') { const x = await api(`/api/admin/exams/${r.targetId}`, { method: 'PUT', body: { source: r.source, title: r.title, category: r.cat, sortOrder: Number(r.sort) } }); upd++; if (x.newVersion) newV++; note = x.newVersion ? '（題目有改，已成新版本）' : '（作答紀錄不受影響）'; }
        else await api('/api/admin/exams', { method: 'POST', body: { title: r.title, category: r.cat, sortOrder: Number(r.sort), published: pub, source: r.source, description: '', courseId: c.id } });
        r.status = '✓ 完成' + note; okN++;
      } catch (err) { r.status = '✗ ' + (err.message || '失敗'); }
      document.getElementById('bulk-preview').innerHTML = bulkTableHtml(c);
    }
    const cat = bulkRows[0]?.cat || '';
    const failed = bulkRows.length - okN;
    bulkOpen = failed > 0; if (!failed) bulkRows = [];
    examAdminFilter[c.id] = { cat: cat || OTHER_CATEGORY, ch: '' };
    const verNote = upd ? `；更新 ${upd} 份，其中 ${newV ? `${newV} 份題目有改、已成新版本` : '沒有一份改版（同學的作答紀錄都不受影響）'}` : '';
    await reloadAfterChange((failed ? `完成 ${okN} 份，${failed} 份失敗（見下方表格）` : `已上傳 ${okN} 份試題`) + verNote);
  };
  const tt = document.getElementById('tidy-toggle');
  if (tt) tt.onclick = () => { tidyOpen = !tidyOpen; bulkOpen = false; tidyRows = tidyOpen ? tidyCompute(getCourse(pagesCourse)) : []; render(); };
  const tc = document.getElementById('tidy-close');
  if (tc) tc.onclick = () => { tidyOpen = false; tidyRows = []; render(); };
  const tg = document.getElementById('tidy-go');
  if (tg) tg.onclick = async () => {
    const list = tidyRows.filter(r => r.changed);
    if (!confirm(`要整理 ${list.length} 份試題的分類、名稱、排序嗎？\n題目內容與作答紀錄都不會改變。`)) return;
    tg.disabled = true;
    let ok = 0;
    for (const r of list) {
      try { await api(`/api/admin/exams/${r.id}`, { method: 'PUT', body: { title: r.title, category: r.cat, sortOrder: r.sort } }); r.status = '✓ 完成'; ok++; }
      catch (err) { r.status = '✗ ' + (err.message || '失敗'); }
    }
    const failed = list.length - ok;
    tidyOpen = failed > 0;
    await reloadAfterChange(failed ? `整理完成 ${ok} 份，${failed} 份失敗` : `已整理 ${ok} 份試題的名稱與排序`);
    if (tidyOpen) { tidyRows = tidyCompute(getCourse(pagesCourse)); render(); }
  };
  document.querySelectorAll('[data-ex-cat]').forEach(b => b.onclick = () => { examAdminFilter[pagesCourse] = { cat: b.dataset.exCat, ch: '' }; render(); });
  document.querySelectorAll('[data-ex-ch]').forEach(b => b.onclick = () => { examAdminFilter[pagesCourse].ch = b.dataset.exCh; render(); });
  document.querySelectorAll('[data-new-cat]').forEach(a => a.addEventListener('click', () => { examNewCategory = a.dataset.newCat; }));
  document.querySelectorAll('[data-exam-delete]').forEach(b => b.onclick = async () => {
    const e = data.exams.find(x => x.id == b.dataset.examDelete);
    if (!confirm(`確定刪除試題「${e.title}」？\n所有同學的作答紀錄也會一起刪除，無法復原。`)) return;
    b.disabled = true;
    try {
      await api(`/api/admin/exams/${e.id}`, { method: 'DELETE' });
      await reloadAfterChange(`已刪除「${e.title}」`);
    } catch (err) { b.disabled = false; handleError(err, null); }
  });
}

/* ---------- 共用：題目畫面 ---------- */
// mode：take 作答、result 看結果、preview 出題預覽
function questionHtml(q, groups, mode, ctx = {}) {
  const grp = q.group ? groups.find(g => g.id === q.group) : null;
  const opts = q.options && q.options.length ? q.options : grp ? grp.options : [];
  const res = ctx.results?.[q.id];
  const given = ctx.answers?.[q.id];
  const name = `a-${q.id}`;
  let badge = '';
  if (mode === 'result') {
    badge = q.type === 'essay'
      ? `<span class="q-badge essay">${res?.selfScored ? `自評 ${res.earned} 分` : '待自評'}</span>`
      : res?.correct ? '<span class="q-badge ok">✓ 答對</span>'
      : res?.earned > 0 ? `<span class="q-badge part">部分答對 ${res.earned} 分</span>` : '<span class="q-badge bad">✗ 答錯</span>';
  }
  const head = `<div class="q-top"><span class="q-no">${esc(q.label || q.no)}</span><span class="q-type">${EXAM_TYPE[q.type]}${q.type === 'multi' ? '（可複選）' : ''} · ${q.points} 分</span>${badge}</div>`;

  let body = '';
  if (q.type === 'single' || q.type === 'multi') {
    const input = q.type === 'single' ? 'radio' : 'checkbox';
    const correctSet = mode !== 'take' ? new Set([].concat(q.answer || [])) : new Set();
    const givenSet = new Set([].concat(given || []));
    const compact = grp && !(q.options && q.options.length);
    body = `<div class="q-opts ${compact ? 'compact' : ''}">${opts.map(o => {
      const cls = mode === 'take' ? '' : correctSet.has(o.key) ? 'is-answer' : givenSet.has(o.key) ? 'is-wrong' : '';
      const checked = givenSet.has(o.key) ? 'checked' : '';
      const tags = optTags(mode, correctSet.has(o.key), givenSet.has(o.key), compact);
      return `<label class="q-opt ${cls}"><input type="${input}" name="${name}" value="${o.key}" ${checked} ${mode === 'take' ? '' : 'disabled'}>
        <b>${o.key}</b>${compact ? '' : `<span>${esc(o.text)}</span>`}${tags}</label>`;
    }).join('')}</div>`;
  } else if (q.type === 'tf') {
    body = `<div class="q-opts compact">${[[true, '對 ○'], [false, '錯 ✕']].map(([v, t]) => {
      const cls = mode === 'take' ? '' : q.answer === v ? 'is-answer' : given === v ? 'is-wrong' : '';
      const tags = optTags(mode, q.answer === v, given === v, true);
      return `<label class="q-opt ${cls}"><input type="radio" name="${name}" value="${v}" ${given === v ? 'checked' : ''} ${mode === 'take' ? '' : 'disabled'}><b>${t}</b>${tags}</label>`;
    }).join('')}</div>`;
  } else if (q.type === 'fill') {
    const g = Array.isArray(given) ? given : [];
    const field = i => {
      const mark = mode === 'result' ? (res?.blanks?.[i] ? 'ok' : 'bad') : '';
      return `<input class="q-blank ${mark}" data-blank="${i}" name="${name}" value="${esc(g[i] || '')}" aria-label="第 ${i + 1} 格" ${mode === 'take' ? '' : 'readonly'} autocomplete="off">`;
    };
    const parts = q.stem.split(BLANK_RE);
    const inline = parts.length - 1 === q.blanks;
    const stem = inline ? parts.map((p, i) => nl2br(p) + (i < q.blanks ? field(i) : '')).join('') : nl2br(q.stem);
    const extra = inline ? '' : `<div class="q-blanks">${Array.from({ length: q.blanks }, (_, i) => `<label>第 ${i + 1} 格 ${field(i)}</label>`).join('')}</div>`;
    const answerLine = mode !== 'take' && q.answer ? `<div class="q-answer">正確答案：${q.answer.map(a => esc(a.join(' / '))).join('；')}</div>` : '';
    return `<div class="q-card" data-q="${q.id}">${head}<div class="q-stem">${stem}</div>${extra}${answerLine}${explainHtml(q, mode, ctx)}</div>`;
  } else if (q.type === 'essay') {
    body = `<textarea class="q-essay" name="${name}" rows="6" maxlength="5000" ${mode === 'take' ? '' : 'readonly'} placeholder="${mode === 'take' ? '在這裡寫下你的答案' : ''}">${esc(given || '')}</textarea>`;
    if (mode !== 'take') {
      body += `<div class="q-ref"><b>參考答案</b>${formatExplanation(q.reference || '')}${q.rubric ? `<b>評分要點</b>${formatExplanation(q.rubric)}` : ''}</div>`;
      if (mode === 'result' && ctx.canSelfScore) {
        const steps = []; for (let v = 0; v <= q.points; v += 0.5) steps.push(v);
        body += `<label class="q-self">我的自評分數
          <select data-self="${q.id}">${steps.map(v => `<option value="${v}" ${(res?.earned ?? 0) === v ? 'selected' : ''}>${v} 分</option>`).join('')}</select>
          ／ ${q.points} 分</label>`;
      }
    }
  }
  return `<div class="q-card" data-q="${q.id}">${head}<div class="q-stem">${nl2br(q.stem)}</div>${yourAnswerHtml(q, mode, given, res)}${body}${explainHtml(q, mode, ctx)}</div>`;
}

// 選項旁的標示：正確答案／你的選擇
function optTags(mode, isAnswer, isGiven, compact) {
  if (mode === 'take') return '';
  if (mode === 'preview') return isAnswer ? '<span class="opt-tag ok">✓ 正確答案</span>' : '';
  if (isAnswer && isGiven) return `<span class="opt-tag ok">✓ ${compact ? '你選對了' : '你的選擇・正確'}</span>`;
  if (isAnswer) return `<span class="opt-tag ok">✓ 正確答案</span>`;
  if (isGiven) return `<span class="opt-tag bad">✗ 你的選擇</span>`;
  return '';
}

// 成績頁題目下方：你的答案 vs 正確答案
function yourAnswerHtml(q, mode, given, res) {
  if (mode !== 'result' || !['single', 'multi', 'tf'].includes(q.type)) return '';
  const fmt = v => q.type === 'tf' ? (v === true ? '對' : v === false ? '錯' : '') : [].concat(v ?? []).join('');
  const mine = fmt(given);
  const right = fmt(q.answer);
  return `<div class="q-yours">你的答案：<b class="${res?.correct ? 'ok' : 'bad'}">${mine ? esc(mine) : '未作答'}</b>　正確答案：<b class="ok">${esc(right)}</b></div>`;
}

function explainHtml(q, mode, ctx = {}) {
  if (mode === 'take') return '';
  return (q.explanation ? `<div class="q-explain"><b>解析</b>${formatExplanation(q.explanation)}</div>` : '') + cardRefsHtml(q, mode, ctx);
}
// 對照圖卡：解析下方列出這題相關的圖卡（縮圖＋編號＋標題），點了在原頁面看大圖
function cardRefsHtml(q, mode, ctx) {
  if (!q.cards?.length || !ctx.courseId) return '';
  const chips = q.cards.map(id => {
    const x = findCard(ctx.courseId, id);
    if (!x) return mode === 'preview' ? `<span class="cref missing">${esc(id)}（網站上找不到這張圖卡）</span>` : '';
    return `<button type="button" class="cref" data-cref="${esc(id)}" data-course="${esc(ctx.courseId)}" title="看大圖（不會離開這一頁）">
      <img src="${esc(x.thumb)}" alt="" loading="lazy"><span><small>${esc(id)}</small>${esc(x.title)}</span></button>`;
  }).join('');
  return chips ? `<div class="q-cards"><b>對照圖卡</b><div class="cref-list">${chips}</div></div>` : '';
}

/* 解析排版：用顏色區分各段
   - 第一行的徽章（🚨🔥⚠️🎯）與「分類：」→ 彩色小標籤
   - 【解析】【易錯點】【高頻陷阱】【易混概念】… → 各自顏色的段落
   - 連續兩行以上含「｜」→ 表格；「・」開頭 → 條列 */
const XP_KIND = [[/易錯/, 'warn'], [/陷阱/, 'trap'], [/易混|對照|比較/, 'compare'], [/解析|說明|詳解/, 'main']];
const BADGE_RE = /(🚨★?|🔥|⚠️|🎯)\s*([^🚨🔥⚠️🎯／　\s]+)/gu;
function formatExplanation(text) {
  const lines = String(text).split('\n');
  let head = '';
  if (lines.length && !/^【/.test(lines[0]) && /分類：|難度：|🚨|🔥|⚠️|🎯/u.test(lines[0])) {
    const first = lines.shift();
    const chips = [];
    for (const m of first.matchAll(BADGE_RE)) {
      const cls = m[1].startsWith('🚨') ? 'hard' : m[1] === '🔥' ? 'hot' : m[1] === '⚠️' ? 'warn' : 'key';
      chips.push(`<span class="xp-chip ${cls}">${esc(m[1].replace('★', ''))} ${esc(m[2])}</span>`);
    }
    const lv = /難度：\s*(\S+)/.exec(first);
    if (lv) chips.push(`<span class="xp-chip ${/難/.test(lv[1]) ? 'hard' : 'key'}">難度：${esc(lv[1])}</span>`);
    const cat = /分類：\s*(.+?)\s*$/.exec(first);
    if (cat) chips.push(`<span class="xp-chip cat">${esc(cat[1])}</span>`);
    head = chips.length ? `<div class="xp-head">${chips.join('')}</div>` : `<p>${esc(first)}</p>`;
  }
  // 依【標題】分段
  const secs = [];
  let cur = { name: '', lines: [] };
  for (const l of lines) {
    const m = /^【([^】]{1,12})】\s*(.*)$/.exec(l);
    if (m) { if (cur.name || cur.lines.some(x => x.trim())) secs.push(cur); cur = { name: m[1], lines: m[2] ? [m[2]] : [] }; }
    else cur.lines.push(l);
  }
  if (cur.name || cur.lines.some(x => x.trim())) secs.push(cur);
  const body = secs.map(sec => {
    const kind = (XP_KIND.find(([re]) => re.test(sec.name)) || [, 'other'])[1];
    return `<div class="xp-sec ${sec.name ? kind : 'plain'}">${sec.name ? `<span class="xp-label">${esc(sec.name)}</span>` : ''}${xpBlocks(sec.lines)}</div>`;
  }).join('');
  return head + body;
}

function xpBlocks(lines) {
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) { i++; continue; }
    if (l.includes('｜')) {
      const rows = [];
      while (i < lines.length && lines[i].includes('｜')) rows.push(lines[i++].split('｜'));
      if (rows.length >= 2) {
        out.push(`<div class="xp-table-wrap"><table class="xp-table"><thead><tr>${rows[0].map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead>
          <tbody>${rows.slice(1).map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      } else out.push(`<p>${esc(rows[0].join('｜'))}</p>`);
      continue;
    }
    if (/^・/.test(l)) {
      const items = [];
      while (i < lines.length && /^・/.test(lines[i])) items.push(lines[i++].replace(/^・\s*/, ''));
      out.push(`<ul>${items.map(x => `<li>${esc(x)}</li>`).join('')}</ul>`);
      continue;
    }
    const para = [];
    while (i < lines.length && lines[i].trim() && !lines[i].includes('｜') && !/^・/.test(lines[i])) para.push(esc(lines[i++]));
    out.push(`<p>${para.join('<br>')}</p>`);
  }
  return out.join('');
}

// 依題目順序畫出來，遇到共用選項組先畫選項
function questionsHtml(questions, groups, mode, ctx) {
  let lastGroup = null;
  // 題型分段：題型改變時加段落標題（例如「單選題 70 題」），整份只有一種題型就不加
  const kind = q => q.group ? 'group' : q.type;
  const runs = []; for (const q of questions) { if (!runs.length || runs[runs.length - 1].k !== kind(q)) runs.push({ k: kind(q), n: 0, first: q.id }); runs[runs.length - 1].n++; }
  const secName = k => k === 'group' ? '共用選項題' : EXAM_TYPE[k] || '題目';
  const heads = runs.length > 1 ? Object.fromEntries(runs.map(r => [r.first, `<div class="q-sec"><span class="q-sec-name">${secName(r.k)}</span><span class="q-sec-count">${r.n} 題</span></div>`])) : {};
  return questions.map(q => {
    let pre = heads[q.id] || '';
    if (q.group && q.group !== lastGroup) {
      const g = groups.find(x => x.id === q.group);
      pre += `<div class="q-group"><b>共用選項</b>（第 ${esc(q.label || q.no)} 題起的題目共用）<ol type="A">${g.options.map(o => `<li><b>${o.key}.</b> ${esc(o.text)}</li>`).join('')}</ol></div>`;
    }
    lastGroup = q.group || null;
    return pre + questionHtml(q, groups, mode, ctx);
  }).join('');
}

/* ---------- 作答頁 #exam/編號 ---------- */
let examCurrent = null;
const examDraftKey = e => `tcm-exam-${e.id}-v${e.version}`;

function examPage() {
  return '<div id="exam-root"><p class="empty">試題載入中…</p></div>';
}

async function mountExam() {
  const root = document.getElementById('exam-root');
  const id = routeParts[1];
  let e;
  try { e = await api(`/api/exams/${encodeURIComponent(id)}`); }
  catch (err) { if (err.status === 401) return showLogin('登入已過期，請重新登入。'); root.innerHTML = `<div class="msg error">${esc(friendly(err))}</div>`; return; }
  if (!document.getElementById('exam-root')) return;
  examCurrent = e;
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(examDraftKey(e)) || '{}'); } catch {}
  const course = getCourse(e.courseId);
  root.innerHTML = `
    ${examCrumbs(e.id, e.courseId, e.title)}
    <div class="exam-head">
      <div class="eyebrow">${esc(course?.title || '')} · ${esc(examCatName(e.courseId, e.category) || OTHER_CATEGORY)}</div>
      <h2>${esc(e.title)}</h2>
      ${e.description ? `<p>${nl2br(e.description)}</p>` : ''}
      <p class="meta-label">共 ${e.questions.length} 題 · 滿分 ${e.totalPoints} 分 · 作答內容會自動暫存在這台電腦，交卷後才批改。</p>
      ${examCardsLink(e.id) ? `<div class="exam-actions">${examCardsLink(e.id)}</div>` : ''}
      ${e.published ? '' : '<div class="notice">這份試題是<b>草稿</b>，只有科目負責人看得到。到「編輯」勾選「公開」後同學才看得到。</div>'}
      ${e.myAttempts.length ? `<details class="my-attempts"><summary>我的作答紀錄（${e.myAttempts.length} 次）</summary>
        <ul>${e.myAttempts.map(a => `<li><a class="link" href="#attempt/${a.id}">${esc(fmtTime(a.createdAt))}</a>　${a.score} / ${a.maxScore} 分（${pctText(a.score, a.maxScore)}）${a.oldVersion ? '　<small>舊版考卷</small>' : ''}</li>`).join('')}</ul></details>` : ''}
    </div>
    <form id="exam-form" class="exam-form" autocomplete="off">
      ${questionsHtml(e.questions, e.groups, 'take', { answers: saved })}
      <div class="exam-bar"><span id="exam-progress"></span><button class="btn" type="submit">交卷</button></div>
      <div id="exam-msg"></div>
    </form>`;

  const form = document.getElementById('exam-form');
  const collect = () => {
    const out = {};
    for (const q of e.questions) {
      const els = [...form.querySelectorAll(`[name="a-${q.id}"]`)];
      if (q.type === 'single') { const c = els.find(x => x.checked); if (c) out[q.id] = c.value; }
      else if (q.type === 'multi') { const c = els.filter(x => x.checked).map(x => x.value); if (c.length) out[q.id] = c; }
      else if (q.type === 'tf') { const c = els.find(x => x.checked); if (c) out[q.id] = c.value === 'true'; }
      else if (q.type === 'fill') { const v = els.map(x => x.value); if (v.some(x => x.trim())) out[q.id] = v; }
      else if (q.type === 'essay') { const v = els[0]?.value || ''; if (v.trim()) out[q.id] = v; }
    }
    return out;
  };
  const update = () => {
    const a = collect();
    const n = Object.keys(a).length;
    document.getElementById('exam-progress').textContent = `已作答 ${n} / ${e.questions.length} 題`;
    try { localStorage.setItem(examDraftKey(e), JSON.stringify(a)); } catch {}
  };
  form.oninput = form.onchange = update;
  update();
  form.onsubmit = async ev => {
    ev.preventDefault();
    const answers = collect();
    const left = e.questions.length - Object.keys(answers).length;
    if (!confirm(left ? `還有 ${left} 題沒有作答，確定要交卷嗎？` : '確定要交卷嗎？')) return;
    const btn = form.querySelector('[type=submit]');
    btn.disabled = true; btn.textContent = '批改中…';
    try {
      const r = await api(`/api/exams/${e.id}/attempts`, { method: 'POST', body: { answers } });
      try { localStorage.removeItem(examDraftKey(e)); } catch {}
      try { data = sortCourses(await api('/api/content')); } catch {}
      location.hash = `attempt/${r.attemptId}`;
    } catch (err) {
      btn.disabled = false; btn.textContent = '交卷';
      handleError(err, document.getElementById('exam-msg'));
    }
  };
}

// 試題相關頁面的階層路線：首頁 › 學習試題 › 科目 › 分類 › 試題（› 成績 › 錯題練習）
function examCrumbs(examId, courseId, title, tail = []) {
  const c = getCourse(courseId);
  const e = (data.exams || []).find(x => x.id == examId);
  const name = e && c ? shortExamTitle(e, c) : title;
  return crumbsHtml([['學習試題', '#examzone'], c && [c.title, `#examzone/${c.id}`], e?.category && [examCatName(c.id, e.category), `#examzone/${c.id}`],
    tail.length ? [name, `#exam/${examId}`] : [name], ...tail]);
}

// 試題 → 同一章的圖卡（依試題名稱開頭的章號；那章還沒有圖卡就不顯示）
function examCardsLink(examId) {
  const e = (data.exams || []).find(x => x.id == examId);
  const c = e && getCourse(e.courseId);
  if (!c) return '';
  const no = examChapNo(shortExamTitle(e, c));
  const ch = no && (deckOf(c.id)?.chapters || []).find(x => x.no === no);
  // 另開分頁：作答、看成績的頁面留著，不會突然跳走
  return ch ? `<a class="btn secondary" href="#cards/${c.id}/${esc(ch.no)}" target="_blank" rel="noopener" title="另開分頁：第 ${esc(ch.no)} 章 ${esc(ch.title)}，${ch.cards.length} 張圖卡">看這章的圖卡 ↗</a>` : '';
}

/* ---------- 成績頁 #attempt/編號 ---------- */
function attemptPage() {
  return '<div id="attempt-root"><p class="empty">成績載入中…</p></div>';
}

async function mountAttempt() {
  const root = document.getElementById('attempt-root');
  let a;
  try { a = await api(`/api/attempts/${encodeURIComponent(routeParts[1])}`); }
  catch (err) { if (err.status === 401) return showLogin('登入已過期，請重新登入。'); root.innerHTML = `<div class="msg error">${esc(friendly(err))}</div>`; return; }
  if (!document.getElementById('attempt-root')) return;
  const essays = a.questions.filter(q => q.type === 'essay');
  const canSelfScore = a.mine && !a.oldVersion && essays.length > 0;
  const pending = essays.filter(q => !a.results[q.id]?.selfScored).length;
  const wrong = a.questions.filter(q => q.type !== 'essay' && !a.results[q.id]?.correct).length;
  root.innerHTML = `
    ${a.mine ? examCrumbs(a.examId, a.courseId, a.title, [['我的成績']]) : crumbsHtml([['管理後台', '#admin'], ['試題管理', `#admin/exams/${a.courseId}`], ['全班統計', `#examstats/${a.examId}`], [`${a.name || ''} 的作答`]])}
    <div class="exam-head">
      <div class="eyebrow">${a.mine ? '我的成績' : `${esc(a.name || '')} 的作答`}</div>
      <h2>${esc(a.title)}</h2>
      <div class="score-big"><strong id="att-score">${a.score}</strong> / ${a.maxScore} 分 <span id="att-pct">（${pctText(a.score, a.maxScore)}）</span></div>
      <p class="meta-label">交卷時間：${esc(fmtTime(a.createdAt))}${wrong ? ` · 客觀題答錯 ${wrong} 題` : ''}</p>
      ${a.oldVersion ? '<div class="notice">這是舊版試題的作答，題目後來有修改，以下答案與解析以目前版本為準，僅供參考。</div>' : ''}
      ${canSelfScore && pending ? `<div class="notice">有 ${pending} 題申論題請對照參考答案<b>自評分數</b>，按最下方「儲存自評」後會計入總分。</div>` : ''}
      <div class="exam-actions">
        ${a.mine ? `<a class="btn" href="#exam/${a.examId}">再做一次</a>` : ''}
        ${a.mine && !a.oldVersion && wrong ? `<a class="btn secondary" href="#retry/${a.id}">只練答錯的 ${wrong} 題</a>` : ''}
        ${examCardsLink(a.examId)}
        <label class="check"><input type="checkbox" id="only-wrong"> 只看答錯的題目</label>
      </div>
    </div>
    <div id="att-list">${questionsHtml(a.questions, a.groups, 'result', { answers: a.answers, results: a.results, canSelfScore, courseId: a.courseId })}</div>
    ${canSelfScore ? '<div class="exam-bar"><span>申論題自評完成後請儲存</span><button class="btn" type="button" id="self-save">儲存自評</button></div><div id="self-msg"></div>' : ''}`;

  document.getElementById('only-wrong').onchange = ev => {
    document.querySelectorAll('#att-list .q-card').forEach(card => {
      const q = a.questions.find(x => x.id === card.dataset.q);
      const right = q.type !== 'essay' && a.results[q.id]?.correct;
      card.hidden = ev.target.checked && right;
    });
    document.querySelectorAll('#att-list .q-group').forEach(g => { g.hidden = ev.target.checked; });
  };
  const save = document.getElementById('self-save');
  if (save) save.onclick = async () => {
    const selfScores = {};
    document.querySelectorAll('[data-self]').forEach(s => { selfScores[s.dataset.self] = Number(s.value); });
    save.disabled = true; save.textContent = '儲存中…';
    const msg = document.getElementById('self-msg');
    try {
      const r = await api(`/api/attempts/${a.id}`, { method: 'PUT', body: { selfScores } });
      a.results = r.results; a.score = r.score;
      document.getElementById('att-score').textContent = r.score;
      document.getElementById('att-pct').textContent = `（${pctText(r.score, a.maxScore)}）`;
      msg.innerHTML = `<div class="msg ok">已儲存自評，總分 ${r.score} / ${a.maxScore} 分。</div>`;
      essays.forEach(q => {
        const badge = document.querySelector(`.q-card[data-q="${q.id}"] .q-badge`);
        if (badge) badge.textContent = `自評 ${r.results[q.id]?.earned ?? 0} 分`;
      });
      try { data = sortCourses(await api('/api/content')); } catch {}
    } catch (err) { handleError(err, msg); }
    save.disabled = false; save.textContent = '儲存自評';
  };
}

/* ---------- 錯題練習 #retry/作答編號（不留紀錄、不算進統計） ---------- */
function retryPage() {
  return '<div id="retry-root"><p class="empty">載入中…</p></div>';
}

async function mountRetry() {
  const root = document.getElementById('retry-root');
  let a;
  try { a = await api(`/api/attempts/${encodeURIComponent(routeParts[1])}`); }
  catch (err) { if (err.status === 401) return showLogin('登入已過期，請重新登入。'); root.innerHTML = `<div class="msg error">${esc(friendly(err))}</div>`; return; }
  if (!document.getElementById('retry-root')) return;
  if (!a.mine || a.oldVersion) { root.innerHTML = '<p class="empty">只能練習自己最新版本試題的錯題。</p>'; return; }
  const qs = a.questions.filter(q => q.type !== 'essay' && a.results[q.id] && !a.results[q.id].correct);
  const groups = a.groups.filter(g => qs.some(q => q.group === g.id));
  // 作答畫面不能帶出答案
  const strip = q => { const { answer, explanation, reference, rubric, ...rest } = q; return rest; };
  const head = `
    ${examCrumbs(a.examId, a.courseId, a.title, [['我的成績', `#attempt/${a.id}`], ['錯題練習']])}
    <div class="exam-head">
      <div class="eyebrow">錯題練習</div>
      <h2>${esc(a.title)}</h2>
      <p class="meta-label">共 ${qs.length} 題，都是你上次答錯的題目。練習結果<b>不會留下紀錄</b>，也不算進成績統計，可以重複練。</p>
      ${examCardsLink(a.examId) ? `<div class="exam-actions">${examCardsLink(a.examId)}</div>` : ''}
    </div>`;
  if (!qs.length) { root.innerHTML = head + '<p class="empty">這次作答沒有答錯的客觀題，太棒了！</p>'; return; }

  const showForm = () => {
    root.innerHTML = head + `
      <form id="retry-form" class="exam-form" autocomplete="off">
        ${questionsHtml(qs.map(strip), groups, 'take', { answers: {} })}
        <div class="exam-bar"><span id="retry-progress">已作答 0 / ${qs.length} 題</span><button class="btn" type="submit">對答案</button></div>
        <div id="retry-msg"></div>
      </form>`;
    const form = document.getElementById('retry-form');
    const collect = () => {
      const out = {};
      for (const q of qs) {
        const els = [...form.querySelectorAll(`[name="a-${q.id}"]`)];
        if (q.type === 'single') { const c = els.find(x => x.checked); if (c) out[q.id] = c.value; }
        else if (q.type === 'multi') { const c = els.filter(x => x.checked).map(x => x.value); if (c.length) out[q.id] = c; }
        else if (q.type === 'tf') { const c = els.find(x => x.checked); if (c) out[q.id] = c.value === 'true'; }
        else if (q.type === 'fill') { const v = els.map(x => x.value); if (v.some(x => x.trim())) out[q.id] = v; }
      }
      return out;
    };
    form.oninput = form.onchange = () => { document.getElementById('retry-progress').textContent = `已作答 ${Object.keys(collect()).length} / ${qs.length} 題`; };
    form.onsubmit = async ev => {
      ev.preventDefault();
      const btn = form.querySelector('[type=submit]');
      btn.disabled = true; btn.textContent = '對答案中…';
      try {
        const r = await api(`/api/exams/${a.examId}/check`, { method: 'POST', body: { attemptId: a.id, answers: collect() } });
        const right = r.questions.filter(q => r.results[q.id]?.correct).length;
        root.innerHTML = head + `
          <div class="score-big"><strong>${right}</strong> / ${r.questions.length} 題答對</div>
          <div class="exam-actions">
            <button type="button" class="btn" id="retry-again">再練一次</button>
            <a class="btn secondary" href="#exam/${a.examId}">整份重新作答</a>
          </div>
          <div class="exam-form" style="margin-top:14px">${questionsHtml(r.questions, r.groups, 'result', { answers: r.given, results: r.results, courseId: a.courseId })}</div>`;
        document.getElementById('retry-again').onclick = () => { showForm(); window.scrollTo(0, 0); };
        window.scrollTo(0, 0);
      } catch (err) {
        btn.disabled = false; btn.textContent = '對答案';
        handleError(err, document.getElementById('retry-msg'));
      }
    };
  };
  showForm();
}

/* ---------- 出題頁 #examedit/new/科目編號、#examedit/考卷編號 ---------- */
function examEditPage() {
  return '<div id="examedit-root"><p class="empty">載入中…</p></div>';
}

async function mountExamEdit() {
  const root = document.getElementById('examedit-root');
  const isNew = routeParts[1] === 'new';
  let exam = { title: '', description: '', category: isNew ? examNewCategory : '', source: '', published: false, courseId: Number(routeParts[2]) };
  examNewCategory = '';
  if (!isNew) {
    try { exam = await api(`/api/admin/exams/${encodeURIComponent(routeParts[1])}`); }
    catch (err) { if (err.status === 401) return showLogin('登入已過期，請重新登入。'); root.innerHTML = `<div class="msg error">${esc(friendly(err))}</div>`; return; }
  }
  if (!document.getElementById('examedit-root')) return;
  const course = getCourse(exam.courseId);
  if (!course || !canEditCourseUI(course.id)) { root.innerHTML = '<p class="empty">你不是這個科目的負責人，不能出題。</p>'; return; }
  examEditDirty = false;
  root.innerHTML = `
    ${crumbsHtml([['管理後台', '#admin'], ['試題管理', `#admin/exams/${course.id}`], [isNew ? '新增試題' : '編輯試題']])}
    <div class="editor-head">
      <h2 class="section" style="margin:0;border:0;padding:0">${isNew ? '新增試題' : '編輯試題'} <small>${esc(semesterLabel(course.semesterCode))}｜${esc(course.title)}</small></h2>
    </div>
    <div class="panel prose editor-panel">
      <div class="panel-head"><h3>基本設定</h3><p>名稱、分類與排序決定這份試題在「學習試題」裡出現的位置。</p></div>
      <div class="field"><label for="xe-title">試題名稱</label><input id="xe-title" maxlength="200" value="${esc(exam.title)}" placeholder="例如：第一章 陰陽五行 模擬考"></div>
      <div class="field"><label for="xe-desc">說明（選填）</label><input id="xe-desc" maxlength="1000" value="${esc(exam.description)}"></div>
      <div class="field"><label for="xe-cat">分類標籤（科目頁會依標籤分頁顯示；可以從清單選，也可以自己打新的）</label>
        <input id="xe-cat" maxlength="30" list="xe-cat-list" value="${esc(exam.category || '')}" placeholder="例如：課堂練習">
        <datalist id="xe-cat-list">${[...new Set([...examCatsOf(course.id).map(x => x.name), ...examsOf(course.id).map(x => examCatName(course.id, x.category)).filter(Boolean)])].map(c => `<option value="${esc(c)}">`).join('')}</datalist>
        <small class="meta-label">留空會歸在「${OTHER_CATEGORY}」。</small></div>
      <div class="field"><label for="xe-sort">排序（數字小的排前面）</label>
        <input id="xe-sort" style="max-width:220px" type="number" min="0" max="100000" step="1" value="${exam.sortOrder ?? (Math.max(0, ...examsOf(course.id).map(x => x.sortOrder)) + 10)}">
        <small class="meta-label">建議用 10、20、30…，中間留空，之後要插入新試題比較方便。標籤的順序跟著該標籤裡排序最前的考卷。</small></div>
      <label class="check"><input type="checkbox" id="xe-pub" ${exam.published ? 'checked' : ''}> 公開給同學作答（不勾選就是草稿，只有科目負責人看得到）</label>
      ${isNew ? '' : '<div class="notice">修改題目內容後會變成<b>新版本</b>：同學舊的作答紀錄和分數會保留，但「題目統計」只計算新版本的作答。只改名稱、說明、公開設定不會變成新版本。</div>'}
      <div class="panel-head panel-head-sub"><h3>題目內容</h3><p>把整份題目貼上，按「檢查格式」確認網站拆題正確後再儲存。</p></div>
      <details class="fmt-help">
        <summary>出題格式說明（第一次使用請先看）</summary>
        <ul>
          <li>每題用「<b>1.</b>」「<b>2.</b>」開頭；選項用「<b>A.</b>」開頭，可以放在同一行。</li>
          <li>每題要有「<b>答案：</b>」。多選題寫 <b>ACD</b>；是非題寫「<b>對</b>」或「<b>錯</b>」。</li>
          <li>填空題的空格用「<b>＿＿</b>」；多個空格答案用「<b>；</b>」分開；同義答案用「<b>/</b>」分開（例如 目/眼）。</li>
          <li>共用選項題（B1 型）：先列出 A～E 選項，底下每個小題只寫題目和答案。</li>
          <li>申論題要有「<b>參考答案：</b>」，可加「評分要點：」、「配分：10」。同學交卷後對照參考答案自評。</li>
          <li>「<b>解析：</b>」選填，交卷後才會顯示。解析和參考答案裡的分點請用（1）（2），不要用「1.」。</li>
          <li>段落標題寫「一、單選題（每題 2 分）」會自動套用配分；沒寫時，申論題 10 分、其他 1 分。</li>
        </ul>
        <div class="fmt-actions">
          <button type="button" class="btn secondary" id="xe-sample">放入範例題目</button>
          <button type="button" class="btn secondary" id="xe-copy">複製「出題指令」給 NotebookLM／Claude</button>
        </div>
        <pre class="fmt-sample">${esc(EXAM_FORMAT)}</pre>
      </details>
      <div class="field"><label for="xe-src">題目（整份貼上）</label><textarea id="xe-src" class="exam-src" spellcheck="false" placeholder="把題目整份貼在這裡……">${esc(exam.source)}</textarea></div>
      <div id="xe-msg"></div>
      <div class="ed-actions">
        <button class="btn secondary" type="button" id="xe-check">檢查格式</button>
        <button class="btn" type="button" id="xe-save">儲存試題</button>
      </div>
      <div id="xe-preview"></div>
    </div>`;

  const src = document.getElementById('xe-src');
  const msg = document.getElementById('xe-msg');
  const dirty = () => { examEditDirty = true; };
  ['xe-title', 'xe-desc', 'xe-cat', 'xe-sort', 'xe-src'].forEach(id => { document.getElementById(id).oninput = dirty; });
  document.getElementById('xe-pub').onchange = dirty;
  document.getElementById('xe-sample').onclick = () => {
    if (src.value.trim() && !confirm('要用範例題目取代目前的內容嗎？')) return;
    src.value = EXAM_FORMAT; dirty();
  };
  document.getElementById('xe-copy').onclick = async () => {
    try { await navigator.clipboard.writeText(EXAM_PROMPT); msg.innerHTML = '<div class="msg ok">已複製出題指令。貼給 NotebookLM 或 Claude，並附上教材範圍，產出的題目可以直接貼回這裡。</div>'; }
    catch { msg.innerHTML = '<div class="msg error">瀏覽器不允許自動複製，請直接選取下方範例複製。</div>'; }
  };

  const showErrors = errs => errs.length
    ? `<div class="msg error"><b>有 ${errs.length} 個地方要修正：</b><ul class="err-list">${errs.slice(0, 30).map(x => `<li>${esc(x.message)}</li>`).join('')}</ul>${errs.length > 30 ? '<p>（只列出前 30 個）</p>' : ''}</div>` : '';

  document.getElementById('xe-check').onclick = async () => {
    const btn = document.getElementById('xe-check');
    btn.disabled = true; btn.textContent = '檢查中…'; msg.innerHTML = '';
    try {
      const p = await api('/api/admin/exams/preview', { method: 'POST', body: { source: src.value } });
      const counts = Object.entries(p.summary.count).map(([t, n]) => `${EXAM_TYPE[t]} ${n} 題`).join('、');
      msg.innerHTML = p.errors.length ? showErrors(p.errors)
        : `<div class="msg ok">格式正確：共 ${p.summary.questionCount} 題（${counts}），滿分 ${p.summary.total} 分。下方是同學交卷後看到的樣子（含答案）。</div>`;
      document.getElementById('xe-preview').innerHTML = p.questions.length
        ? `<h3 class="sem-title">預覽</h3><div class="exam-form">${questionsHtml(p.questions, p.groups, 'preview', { courseId: course.id })}</div>` : '';
    } catch (err) { handleError(err, msg); }
    btn.disabled = false; btn.textContent = '檢查格式';
  };

  document.getElementById('xe-save').onclick = async () => {
    const btn = document.getElementById('xe-save');
    const body = { title: document.getElementById('xe-title').value, description: document.getElementById('xe-desc').value,
                   category: document.getElementById('xe-cat').value,
                   ...(document.getElementById('xe-sort').value.trim() !== '' ? { sortOrder: Number(document.getElementById('xe-sort').value) } : {}),
                   published: document.getElementById('xe-pub').checked, source: src.value };
    if (!body.title.trim()) { msg.innerHTML = '<div class="msg error">請填寫試題名稱。</div>'; return; }
    btn.disabled = true; btn.textContent = '儲存中…'; msg.innerHTML = '';
    try {
      const res = await fetch(isNew ? '/api/admin/exams' : `/api/admin/exams/${exam.id}`, {
        method: isNew ? 'POST' : 'PUT', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(isNew ? { ...body, courseId: course.id } : body)
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 401) return showLogin('登入已過期，請重新登入。');
        msg.innerHTML = out.errors?.length ? showErrors(out.errors) : `<div class="msg error">${esc(out.error || '儲存失敗')}</div>`;
        btn.disabled = false; btn.textContent = '儲存試題';
        return;
      }
      examEditDirty = false;
      pagesCourse = course.id; adminType = 'exams';
      examAdminFilter[course.id] = { cat: examCatName(course.id, body.category) || OTHER_CATEGORY, ch: '' };   // 回到清單時切到剛存的分類
      try { data = sortCourses(await api('/api/content')); } catch {}
      adminFlash = `已儲存「${body.title.trim()}」${body.published ? '' : '（草稿，同學還看不到）'}`;
      location.hash = `admin/exams/${course.id}`;
    } catch (err) {
      btn.disabled = false; btn.textContent = '儲存試題';
      handleError(err, msg);
    }
  };
}

/* ---------- 統計頁 #examstats/編號 ---------- */
function examStatsPage() {
  return '<div id="examstats-root"><p class="empty">統計載入中…</p></div>';
}

async function mountExamStats() {
  const root = document.getElementById('examstats-root');
  let s;
  try { s = await api(`/api/admin/exams/${encodeURIComponent(routeParts[1])}/stats`); }
  catch (err) { if (err.status === 401) return showLogin('登入已過期，請重新登入。'); root.innerHTML = `<div class="msg error">${esc(friendly(err))}</div>`; return; }
  if (!document.getElementById('examstats-root')) return;
  const num = v => v == null ? '—' : `${v}%`;
  root.innerHTML = `
    ${crumbsHtml([['管理後台', '#admin'], ['試題管理', `#admin/exams/${s.courseId}`], ['全班統計']])}
    <h2 class="section">${esc(s.title)} <small>全班統計 · 第 ${s.version} 版</small></h2>
    <p class="meta-label">本頁只有擁有者、管理員和這個科目的負責人看得到。題目統計只計算目前版本的作答${s.allAttempts > s.attempts ? `（另有 ${s.allAttempts - s.attempts} 次舊版作答）` : ''}。</p>
    <div class="stats stats-row">
      <div class="stat"><strong>${s.students}</strong><span>作答人數</span></div>
      <div class="stat"><strong>${s.attempts}</strong><span>作答次數</span></div>
      <div class="stat"><strong>${num(s.average)}</strong><span>平均得分率</span></div>
      <div class="stat"><strong>${num(s.highest)}</strong><span>最高</span></div>
      <div class="stat"><strong>${num(s.lowest)}</strong><span>最低</span></div>
    </div>
    <h3 class="sem-title">每題答對率 <small>由低到高，答對率低的題目可以加強講解</small></h3>
    <div class="table-wrap"><table class="stat-table">
      <thead><tr><th>題</th><th>題型</th><th>題目</th><th>答案</th><th>答對率</th><th>作答分布</th></tr></thead>
      <tbody>${[...s.questions].sort((x, y) => (x.correctRate ?? 101) - (y.correctRate ?? 101)).map(q => `
        <tr><td>${esc(q.label || q.no)}</td><td>${EXAM_TYPE[q.type]}</td><td>${esc(q.stem)}</td><td>${esc(q.answer || '—')}</td>
          <td>${q.type === 'essay' ? `平均自評 ${q.avgEarned} / ${q.points}` : q.answered ? `<div class="rate-bar"><span style="width:${q.correctRate}%"></span></div>${q.correctRate}%（${q.correct}/${q.answered}）` : '—'}</td>
          <td>${Object.entries(q.choices).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${esc(k)}：${n}`).join('　') || '—'}</td></tr>`).join('')}</tbody>
    </table></div>
    <h3 class="sem-title">同學成績</h3>
    <div class="table-wrap"><table class="stat-table">
      <thead><tr><th>名稱</th><th>作答次數</th><th>最佳</th><th>最近一次</th><th></th></tr></thead>
      <tbody>${s.studentList.map(u => `
        <tr><td>${esc(u.name)}</td><td>${u.attempts}</td><td>${u.best}%</td><td>${u.latest}%　<small>${esc(fmtTime(u.latestAt))}</small></td>
          <td><a class="link" href="#attempt/${u.latestId}">看作答 →</a></td></tr>`).join('') || '<tr><td colspan="5">還沒有人作答。</td></tr>'}</tbody>
    </table></div>
    ${s.allAttempts ? `<p style="margin-top:20px"><button type="button" class="btn secondary danger" id="clear-attempts">清除所有作答紀錄</button>
      <span class="meta-label">例如自己測試完後，清掉測試的紀錄。</span></p>` : ''}`;
  const clear = document.getElementById('clear-attempts');
  if (clear) clear.onclick = async () => {
    if (!confirm(`確定清除「${s.title}」的全部 ${s.allAttempts} 次作答紀錄？\n同學的分數也會一起刪除，無法復原。`)) return;
    clear.disabled = true;
    try {
      await api(`/api/admin/exams/${s.id}/attempts`, { method: 'DELETE' });
      try { data = sortCourses(await api('/api/content')); } catch {}
      mountExamStats();
    } catch (err) { clear.disabled = false; handleError(err, null); }
  };
}

// 出題頁還沒儲存就要關閉分頁時提醒
window.addEventListener('beforeunload', e => {
  if (page === 'examedit' && examEditDirty) { e.preventDefault(); e.returnValue = ''; }
});
