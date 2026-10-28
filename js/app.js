/* app.js：畫面更新、按鈕綁定、深色模式、網站啟動（最後載入）
   載入順序：core.js → pages.js → admin.js → app.js（順序不能改） */

/* =========================================================
   六、畫面更新與按鈕綁定
   ========================================================= */
const VIEWS = { home: homePage, courses: coursesPage, course: coursePage, items: itemsPage, projects: projectsPage, detail: detailPage, about: aboutPage, admin: adminPage, account: accountPage, editor: editorPage,
  exam: examPage, attempt: attemptPage, retry: retryPage, examedit: examEditPage, examstats: examStatsPage };

function render() {
  document.body.classList.toggle('signed-out', !admin);
  document.getElementById('admin-link').hidden = !hasAdminAccess();
  document.getElementById('logout-top').hidden = !admin;
  document.getElementById('account-link').hidden = !admin;

  if (loadState === 'login') {
    app.innerHTML = loginGateHtml();
  } else if (loadState === 'loading') {
    app.innerHTML = '<p class="empty">資料載入中…</p>';
  } else if (loadState === 'error') {
    app.innerHTML = `<div class="msg error">無法載入資料：${esc(loadError)}</div><button type="button" class="btn" id="retry">重新載入</button>`;
  } else {
    app.innerHTML = VIEWS[page]();
  }
  // 導覽列目前位置
  const navKey = ['editor', 'examedit', 'examstats'].includes(page) ? 'admin' : ['exam', 'attempt', 'retry'].includes(page) ? 'courses' : (page === 'items' || page === 'course') ? 'courses' : page === 'detail' ? (detailTarget[0] === 'project' ? 'projects' : 'courses') : page;
  document.querySelectorAll('[data-nav]').forEach(a => {
    if (a.dataset.nav === navKey) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  bind();
}

function bind() {
  const retry = document.getElementById('retry');
  if (retry) retry.onclick = () => boot();

  // Google 登入前，記下目前所在的頁面，登入後回到這裡
  const gl = document.getElementById('google-login');
  if (gl) gl.onclick = () => { try { sessionStorage.setItem('tcm-return', location.hash); } catch {} };

  // 搜尋：只更新圖卡區，不重畫整頁（輸入不會跳掉）
  const s = document.getElementById('search');
  if (s) s.oninput = () => { query = s.value; document.getElementById('itemgrid').innerHTML = itemGridHtml(); };

  const f = document.getElementById('coursefilter');
  if (f) f.onchange = () => { location.hash = 'items/' + f.value; };

  // 登入
  const lf = document.getElementById('loginform');
  if (lf) lf.onsubmit = async e => {
    e.preventDefault();
    const btn = lf.querySelector('[type=submit]');
    const msg = document.getElementById('loginmsg');
    btn.disabled = true;
    btn.textContent = '登入中…';
    msg.innerHTML = '';
    try {
      await api('/api/login', { method: 'POST', body: { email: lf.elements.email.value, password: lf.elements.password.value } });
      await boot();
    } catch (err) {
      btn.disabled = false;
      btn.textContent = '登入';
      msg.innerHTML = `<div class="msg error">${esc(err.status === 401 ? 'Email 或密碼錯誤。請注意：連續輸錯 5 次將暫停登入 15 分鐘。' : friendly(err))}</div>`;
    }
  };

  document.querySelectorAll('[data-admin-type]').forEach(b => b.onclick = () => {
    adminType = b.dataset.adminType;
    if (adminType === 'members') members = null; // 每次進入都讀取最新名單
    render();
  });

  // 成員管理
  if (page === 'admin' && adminType === 'members' && admin?.canManageMembers && !members && !membersLoading) loadMembers();

  const mf = document.getElementById('memberform');
  if (mf) mf.onsubmit = async e => {
    e.preventDefault();
    const btn = mf.querySelector('[type=submit]');
    const msg = document.getElementById('memberformmsg');
    msg.innerHTML = '';
    btn.disabled = true;
    const body = Object.fromEntries(new FormData(mf).entries());
    try {
      await api('/api/admin/members', { method: 'POST', body });
      reloadMembers(`已將 ${body.email.trim().toLowerCase()} 加入名單`);
    } catch (err) {
      btn.disabled = false;
      handleError(err, msg);
    }
  };

  document.querySelectorAll('[data-member-role]').forEach(sel => sel.onchange = async () => {
    const m = members.find(x => x.id == sel.dataset.memberRole);
    sel.disabled = true;
    try {
      await api(`/api/admin/members/${m.id}`, { method: 'PUT', body: { role: sel.value } });
      reloadMembers(`已將「${m.displayName}」改為${ROLE_NAME[sel.value]}`);
    } catch (err) {
      sel.disabled = false;
      sel.value = m.role;
      handleError(err, null);
    }
  });

  document.querySelectorAll('[data-member-status]').forEach(b => b.onclick = async () => {
    const m = members.find(x => x.id == b.dataset.memberStatus);
    const to = b.dataset.to;
    if (to === 'suspended' && !confirm(`確定停用「${m.displayName}」？\n停用後對方會立即被登出，無法再看到網站內容。之後可以再按「恢復」。`)) return;
    b.disabled = true;
    try {
      await api(`/api/admin/members/${m.id}`, { method: 'PUT', body: { status: to } });
      reloadMembers(to === 'suspended' ? `已停用「${m.displayName}」` : `已恢復「${m.displayName}」`);
    } catch (err) {
      b.disabled = false;
      handleError(err, null);
    }
  });

  document.querySelectorAll('[data-member-delete]').forEach(b => b.onclick = async () => {
    const m = members.find(x => x.id == b.dataset.memberDelete);
    if (!confirm(`確定把「${m.email}」從名單移除？`)) return;
    b.disabled = true;
    try {
      await api(`/api/admin/members/${m.id}`, { method: 'DELETE' });
      reloadMembers(`已移除 ${m.email}`);
    } catch (err) {
      b.disabled = false;
      handleError(err, null);
    }
  });

  bindPagesAdmin();
  if (page === 'editor' && loadState === 'ready') mountEditor();
  bindExamsAdmin();
  bindExamTabs();
  if (loadState === 'ready') {
    if (page === 'exam') mountExam();
    if (page === 'attempt') mountAttempt();
    if (page === 'retry') mountRetry();
    if (page === 'examedit') mountExamEdit();
    if (page === 'examstats') mountExamStats();
  }

  document.querySelectorAll('[data-sem]').forEach(b => b.onclick = async () => {
    const sem = getSemester(b.dataset.sem);
    b.disabled = true;
    try {
      await api(`/api/admin/semesters/${encodeURIComponent(sem.code)}`, { method: 'PUT', body: { visible: b.dataset.to === '1' } });
      await reloadAfterChange(`已${b.dataset.to === '1' ? '開放' : '關閉'}「${sem.label}」`);
    } catch (err) {
      b.disabled = false;
      handleError(err, null);
    }
  });

  // 我的帳號：改暱稱
  const af = document.getElementById('accountform');
  if (af) af.onsubmit = async e => {
    e.preventDefault();
    const btn = af.querySelector('[type=submit]');
    const msg = document.getElementById('accountmsg');
    msg.innerHTML = '';
    btn.disabled = true;
    btn.textContent = '儲存中…';
    try {
      const res = await api('/api/account', { method: 'PUT', body: { displayName: af.elements.displayName.value } });
      admin.displayName = res.displayName;
      await reloadAfterChange(`暱稱已改為「${res.displayName}」`);
    } catch (err) {
      btn.disabled = false;
      btn.textContent = '儲存暱稱';
      handleError(err, msg);
    }
  };

  // 擁有者幫成員改名稱
  document.querySelectorAll('[data-member-rename]').forEach(b => b.onclick = async () => {
    const m = members.find(x => x.id == b.dataset.memberRename);
    const name = prompt(`請輸入「${m.email}」的新名稱（最多 30 字）：`, m.displayName);
    if (name === null || name.trim() === m.displayName) return;
    b.disabled = true;
    try {
      await api(`/api/admin/members/${m.id}`, { method: 'PUT', body: { displayName: name.trim().slice(0, 30) } });
      await reloadMembers(`已將名稱改為「${name.trim().slice(0, 30)}」`);
    } catch (err) {
      b.disabled = false;
      handleError(err, null);
    }
  });

  const add = document.getElementById('add');
  if (add) add.onclick = () => showEditor(null);

  document.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => {
    showEditor(data[adminType].find(x => x.id == b.dataset.edit));
  });

  document.querySelectorAll('[data-delete]').forEach(b => b.onclick = async () => {
    const id = Number(b.dataset.delete);
    if (adminType === 'courses' && (data.items.some(x => x.courseId === id) || pagesOf(id).length)) {
      alert('請先刪除或調整此科目裡的網頁和圖卡。');
      return;
    }
    const row = data[adminType].find(x => x.id === id);
    if (!confirm(`確定刪除「${row?.title || ''}」？刪除後無法復原。`)) return;
    b.disabled = true;
    try {
      await api(`/api/admin/${adminType}/${id}`, { method: 'DELETE' });
      await reloadAfterChange(`已刪除「${row?.title || ''}」`);
    } catch (err) {
      b.disabled = false;
      handleError(err, null);
    }
  });
}

// 網頁管理的按鈕
function bindPagesAdmin() {
  const sel = document.getElementById('pg-course');
  if (sel) sel.onchange = () => { pagesCourse = Number(sel.value); render(); };

  const pf = document.getElementById('pageform');
  if (pf) pf.onsubmit = async e => {
    e.preventDefault();
    const btn = pf.querySelector('[type=submit]');
    const msg = document.getElementById('pageformmsg');
    msg.innerHTML = '';
    btn.disabled = true;
    btn.textContent = '上傳中…';
    try {
      const html = await readHtmlFile(pf.elements.file.files[0]);
      const res = await api('/api/admin/pages', { method: 'POST', body: {
        courseId: pagesCourse, title: pf.elements.title.value, description: pf.elements.description.value, html } });
      await reloadAfterChange(`已上傳，網址：${location.origin}${res.url}`);
      const added = data.pages.find(x => x.id === res.id);
      if (added) { adminFlash = `已上傳「${added.title}」，網址：${location.origin}${res.url}`; render(); }
    } catch (err) {
      btn.disabled = false;
      btn.textContent = '上傳網頁';
      handleError(err, msg);
    }
  };

  document.querySelectorAll('[data-page-edit]').forEach(b => b.onclick = () => {
    const p = data.pages.find(x => x.id == b.dataset.pageEdit);
    const box = document.getElementById('editor');
    box.innerHTML = pageEditorHtml(p);
    box.scrollIntoView({ block: 'start' });
    document.getElementById('cancel').onclick = () => { box.innerHTML = ''; };
    const form = document.getElementById('pageeditform');
    form.onsubmit = async e => {
      e.preventDefault();
      const sbtn = form.querySelector('[type=submit]');
      const msg = document.getElementById('pageeditmsg');
      msg.innerHTML = '';
      sbtn.disabled = true;
      sbtn.textContent = '儲存中…';
      try {
        const body = { title: form.elements.title.value, description: form.elements.description.value, sortOrder: Number(form.elements.sortOrder.value) };
        const file = form.elements.file.files[0];
        if (file) body.html = await readHtmlFile(file);
        await api(`/api/admin/pages/${p.id}`, { method: 'PUT', body });
        await reloadAfterChange(`已儲存「${body.title}」${file ? '（已換成新版網頁）' : ''}`);
      } catch (err) {
        sbtn.disabled = false;
        sbtn.textContent = '儲存';
        handleError(err, msg);
      }
    };
  });

  document.querySelectorAll('[data-page-delete]').forEach(b => b.onclick = async () => {
    const p = data.pages.find(x => x.id == b.dataset.pageDelete);
    if (!confirm(`確定刪除網頁「${p.title}」？刪除後無法復原，網址也會失效。`)) return;
    b.disabled = true;
    try {
      await api(`/api/admin/pages/${p.id}`, { method: 'DELETE' });
      await reloadAfterChange(`已刪除「${p.title}」`);
    } catch (err) {
      b.disabled = false;
      handleError(err, null);
    }
  });
}

// 頁首的「登出」按鈕
const logoutTop = document.getElementById('logout-top');
logoutTop.onclick = async () => {
  logoutTop.disabled = true;
  try { await api('/api/logout', { method: 'POST' }); } catch {}
  logoutTop.disabled = false;
  showLogin('');
};

// 網址改變時切換頁面
let lastHash = location.hash;
window.addEventListener('hashchange', () => {
  // 編輯器還有沒儲存的內容時，先確認
  if (page === 'editor' && editorDirty) {
    if (!confirm('網頁還沒儲存，確定要離開嗎？\n（草稿會暫存在這台電腦，下次打開編輯器可以恢復）')) {
      history.replaceState(null, '', lastHash || '#home');
      return;
    }
    saveDraft();
    editorDirty = false;
  }
  if (page === 'examedit' && examEditDirty) {
    if (!confirm('考卷還沒儲存，確定要離開嗎？')) {
      history.replaceState(null, '', lastHash || '#home');
      return;
    }
    examEditDirty = false;
  }
  if (page === 'editor') clearInterval(draftTimer);
  lastHash = location.hash;
  const prev = page;
  readHash();
  if (page !== 'items') query = '';
  render();
  if (page !== prev || page === 'detail') window.scrollTo(0, 0);
});

/* =========================================================
   七、深色 / 淺色模式
   預設跟隨裝置設定；按下按鈕後會記住你的選擇
   ========================================================= */
const ICON_SUN = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.5"/><path d="M12 1.5v2.5M12 20v2.5M4.6 4.6l1.8 1.8M17.6 17.6l1.8 1.8M1.5 12H4M20 12h2.5M4.6 19.4l1.8-1.8M17.6 6.4l1.8-1.8"/></svg>';
const ICON_MOON = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';
const themeBtn = document.getElementById('theme');
const sysDark = window.matchMedia('(prefers-color-scheme: dark)');
const isDark = () => {
  const t = document.documentElement.dataset.theme;
  return t ? t === 'dark' : sysDark.matches;
};
function updateThemeButton() {
  const dark = isDark();
  themeBtn.innerHTML = dark ? ICON_SUN + '<span class="label"> 淺色模式</span>' : ICON_MOON + '<span class="label"> 深色模式</span>';
  themeBtn.setAttribute('aria-label', dark ? '切換為淺色模式' : '切換為深色模式');
}
themeBtn.onclick = () => {
  const next = isDark() ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('tcm-theme', next); localStorage.removeItem('tcm-dark'); } catch {}
  updateThemeButton();
};
sysDark.addEventListener?.('change', updateThemeButton);

/* 啟動 */
updateThemeButton();
readLoginResult();
readHash();
boot();
