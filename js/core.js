/* core.js：資料讀取、登入狀態、共用小工具、網址與頁面狀態
   載入順序：core.js → pages.js → admin.js → app.js（順序不能改） */

/* =========================================================
   一、資料來源：Cloudflare D1 雲端資料庫（透過 /api/content 讀取）
   ========================================================= */
let data = { courses: [], items: [], projects: [] };
let loadState = 'loading';   // loading 載入中 | ready 完成 | error 失敗 | login 需要登入
let loadError = '';
let admin = null;            // 目前登入的使用者（含權限）；null＝未登入
let adminFlash = '';         // 管理後台的提示訊息（例如「已儲存」）
let loginNotice = '';        // 登入畫面上要顯示的提示
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
  data = { courses: [], items: [], projects: [] };
  members = null;
  loginNotice = notice;
  loadState = 'login';
  render();
}

async function loadContent() {
  try {
    data = await api('/api/content');
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

/* =========================================================
   三、頁面狀態與網址（網址會跟著頁面改變，可用「上一頁」）
   #home  #courses  #items/科目編號  #projects  #about  #admin
   #detail/item/編號  #detail/project/編號
   ========================================================= */
const PAGES = ['home', 'courses', 'items', 'projects', 'detail', 'about', 'admin'];
let page = 'home', filter = 'all', query = '', adminType = 'items', detailTarget = ['item', 0];
const app = document.getElementById('app');

function readHash() {
  const parts = decodeURIComponent(location.hash.slice(1)).split('/');
  page = PAGES.includes(parts[0]) ? parts[0] : 'home';
  if (page === 'items') filter = parts[1] || 'all';
  if (page === 'detail') detailTarget = [parts[1] === 'project' ? 'project' : 'item', parts[2]];
}
