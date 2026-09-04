// 登录状态存哪里由"记住密码"勾选框决定：勾了存 localStorage（关浏览器也不用重登），
// 不勾存 sessionStorage（关掉标签页/浏览器就清空，不会留在别人打开的同一台设备上）。
// admin.html / member.html 用的是同一套逻辑，三处必须保持一致，否则互相读不到登录状态。
const authStorage = {
  getItem: (key) => localStorage.getItem(key) ?? sessionStorage.getItem(key),
  setItem: (key, value) => {
    (localStorage.getItem('rememberLogin') === '1' ? localStorage : sessionStorage).setItem(key, value);
  },
  removeItem: (key) => {
    localStorage.removeItem(key);
    sessionStorage.removeItem(key);
  },
};
const db = supabase.createClient(
  'https://wmatsdnpbpcltuoynyrh.supabase.co',
  'sb_publishable_gw7gfFtSHHJR6SbDUpCTwA_HNcktgEl',
  { auth: { storage: authStorage } }
);

// 手机网络偶尔抖动会导致单次请求失败，失败时自动重试几次，避免某个板块的内容永久空白
async function fetchWithRetry(queryFn, retries = 2, delayMs = 800) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const { data, error } = await queryFn();
    if (!error) return data;
    if (attempt < retries) await new Promise(r => setTimeout(r, delayMs));
  }
  return null;
}

// 账号入口：识别当前登录人是管理员还是会员，决定导航栏那个按钮点了之后去哪，
// 也用来决定"知音通道"预约表单要不要显示
let currentAccountRole = null; // 'admin' | 'member' | null（未登录或还没有角色记录）
let currentMemberId = null;
let loginFailCount = 0;

async function refreshAccountNav() {
  const link = document.getElementById('navAccountLink');
  if (!link) return;
  const { data: { user } } = await db.auth.getUser();
  if (!user) { currentAccountRole = null; currentMemberId = null; link.textContent = '登录'; updateBookingSectionVisibility(); return; }
  const { data: profile } = await db.from('profiles').select('role, member_id').eq('id', user.id).maybeSingle();
  currentAccountRole = profile ? profile.role : null;
  currentMemberId = profile ? profile.member_id : null;
  link.textContent = currentAccountRole === 'admin' ? '管理中心' : currentAccountRole === 'member' ? '知音中心' : '登录';
  updateBookingSectionVisibility();
}

function updateBookingSectionVisibility() {
  const prompt = document.getElementById('bookingLoginPrompt');
  const revealBtn = document.getElementById('bookingRevealBtn');
  if (!prompt || !revealBtn) return;
  const isMember = currentAccountRole === 'member';
  prompt.style.display = isMember ? 'none' : '';
  revealBtn.style.display = isMember ? '' : 'none';
  // 登录状态变化（比如切换账号）时把预约弹窗一起收起来，不留着一个引用着上一个账号的
  // 表单开在那——比如刚提交完退出登录，弹窗还开着容易让人以为还能继续操作
  if (!isMember) closeBookingModal();
}

function openBookingModal() {
  const modal = document.getElementById('bookingModal');
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  bwkAnchor = bwkMonday(new Date());
  renderBwkWeek();
}

function closeBookingModal() {
  const modal = document.getElementById('bookingModal');
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
}

async function submitBookingRequest(event) {
  event.preventDefault();
  const statusEl = document.getElementById('bookingFormStatus');
  if (!currentMemberId) { statusEl.style.color = '#e7a39c'; statusEl.textContent = '请先登录会员账号'; return false; }
  const datetime = document.getElementById('datetime').value.trim();
  const slot = document.getElementById('slot').value;
  if (!datetime || !slot) { statusEl.style.color = '#e7a39c'; statusEl.textContent = '请先在上方选择到访时段'; return false; }
  const note = document.getElementById('note').value.trim();
  const { error } = await db.from('booking_requests').insert({ member_id: currentMemberId, preferred_time: datetime + ' · ' + slot, note });
  if (error) { statusEl.style.color = '#e7a39c'; statusEl.textContent = '提交失败：' + error.message; return false; }
  statusEl.style.color = '#cfe0b8';
  statusEl.textContent = '已收到您的预约申请，我们会尽快与您确认。';
  document.getElementById('realBookingForm').reset();
  resetBwkPicker();
  return false;
}

// 首页预约表单选时段：简化版"周表"，跟后台周视图一个道理（一排七天），但只给客人看
// "这天还有哪几段真的空着"——具体行程、关闭标记这些后台细节都不显示，点一个空档
// 直接选定"哪天+几点到几点"，不用先选日期、再单独选时段两步分开来
let bwkAnchor = bwkMonday(new Date()); // 当前显示这一周的周一
let bwkSelected = null; // { y, m, d, label }
const BWK_WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];

function bwkMonday(d) {
  const monday = new Date(d);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return monday;
}

// 营业时间是 9:30-23:30——跟后台日历默认显示窗口的 8:30 不是一回事，那只是后台自己
// 看行程时习惯往前多留半小时方便看，不代表真的 8:30 就开门营业
const BOOKING_BUSINESS_START_SLOT = 19; // 9:30 = 9.5*2
const BOOKING_BUSINESS_END_SLOT = 47;   // 23:30 = 23.5*2
function bwkFormatSlot(slotIdx) {
  return `${String(Math.floor(slotIdx / 2)).padStart(2, '0')}:${slotIdx % 2 ? '30' : '00'}`;
}

function bwkShiftWeek(dir) {
  const next = new Date(bwkAnchor);
  next.setDate(next.getDate() + dir * 7);
  if (next < bwkMonday(new Date())) return; // 不能翻到已经完全过去的那一周
  bwkAnchor = next;
  renderBwkWeek();
}

async function renderBwkWeek() {
  const grid = document.getElementById('bwkGrid');
  const todayMonday = bwkMonday(new Date());
  document.getElementById('bwkPrevBtn').disabled = bwkAnchor.getTime() <= todayMonday.getTime();

  const weekEnd = new Date(bwkAnchor); weekEnd.setDate(weekEnd.getDate() + 7);
  const lastDay = new Date(weekEnd); lastDay.setDate(lastDay.getDate() - 1);
  document.getElementById('bwkRangeLabel').textContent =
    `${bwkAnchor.getMonth() + 1}月${bwkAnchor.getDate()}日 - ${lastDay.getMonth() + 1}月${lastDay.getDate()}日`;

  grid.innerHTML = '<div class="bwk-loading">查询空档中…</div>';
  const { data, error } = await db.rpc('get_tea_busy_ranges', {
    p_start: bwkAnchor.toISOString(), p_end: weekEnd.toISOString(),
  });
  if (error) {
    grid.innerHTML = '<div class="bwk-loading">查询失败，请稍后重试，或直接在备注里说明期望时间</div>';
    return;
  }

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const now = new Date();
  let html = '';
  for (let i = 0; i < 7; i++) {
    const day = new Date(bwkAnchor); day.setDate(day.getDate() + i);
    const isPast = day < today;
    const isToday = day.getTime() === today.getTime();
    const dayStart = day, dayEnd = new Date(day); dayEnd.setDate(dayEnd.getDate() + 1);

    let chipsHtml;
    if (isPast) {
      chipsHtml = '<div class="bwk-day-empty">已过去</div>';
    } else {
      const busy = new Array(48).fill(false);
      (data || []).forEach(r => {
        const s = new Date(r.start_at), e = new Date(r.end_at);
        const sSlot = Math.max(0, Math.floor((s - dayStart) / 60000 / 30));
        const eSlot = Math.min(48, Math.ceil((e - dayStart) / 60000 / 30));
        for (let k = Math.max(0, sSlot); k < Math.min(48, eSlot); k++) busy[k] = true;
      });
      if (isToday) {
        const nowSlot = Math.ceil((now.getHours() * 60 + now.getMinutes()) / 30);
        for (let k = 0; k < Math.min(48, nowSlot); k++) busy[k] = true;
      }
      const runs = [];
      let runStart = null;
      for (let k = BOOKING_BUSINESS_START_SLOT; k <= BOOKING_BUSINESS_END_SLOT; k++) {
        const open = k < BOOKING_BUSINESS_END_SLOT && !busy[k];
        if (open && runStart === null) runStart = k;
        else if (!open && runStart !== null) { runs.push([runStart, k]); runStart = null; }
      }
      chipsHtml = runs.length === 0
        ? '<div class="bwk-day-empty">约满</div>'
        : runs.map(([s0, s1]) => {
            const label = `${bwkFormatSlot(s0)}-${bwkFormatSlot(s1)}`;
            const isSel = bwkSelected && bwkSelected.y === day.getFullYear() && bwkSelected.m === day.getMonth() && bwkSelected.d === day.getDate() && bwkSelected.label === label;
            return `<button type="button" class="bwk-chip${isSel ? ' selected' : ''}" data-y="${day.getFullYear()}" data-m="${day.getMonth()}" data-d="${day.getDate()}" data-label="${label}" onclick="bwkSelectChip(this)">${label}</button>`;
          }).join('');
    }

    html += `
      <div class="bwk-day${isToday ? ' today' : ''}${isPast ? ' past' : ''}">
        <div class="bwk-day-head"><span>${BWK_WEEKDAYS[i]}</span><b>${day.getMonth() + 1}/${day.getDate()}</b></div>
        <div class="bwk-day-chips">${chipsHtml}</div>
      </div>`;
  }
  grid.innerHTML = html;
}

function bwkSelectChip(btn) {
  const y = Number(btn.dataset.y), m = Number(btn.dataset.m), d = Number(btn.dataset.d), label = btn.dataset.label;
  bwkSelected = { y, m, d, label };
  const dateLabel = `${m + 1}月${d}日 周${BWK_WEEKDAYS[(new Date(y, m, d).getDay() + 6) % 7]}`;
  document.getElementById('datetime').value = dateLabel;
  document.getElementById('slot').value = label;
  const selEl = document.getElementById('bwkSelectedLabel');
  selEl.textContent = `已选：${dateLabel} ${label}`;
  selEl.classList.add('picked');
  document.querySelectorAll('.bwk-chip').forEach(chip => {
    chip.classList.toggle('selected', chip === btn);
  });
}

function resetBwkPicker() {
  bwkSelected = null;
  bwkAnchor = bwkMonday(new Date());
  document.getElementById('datetime').value = '';
  document.getElementById('slot').value = '';
  const selEl = document.getElementById('bwkSelectedLabel');
  selEl.textContent = '尚未选择时段';
  selEl.classList.remove('picked');
  renderBwkWeek();
}

function onNavAccountClick(event) {
  event.preventDefault();
  if (currentAccountRole === 'admin') { location.href = 'admin.html'; return; }
  if (currentAccountRole === 'member') { location.href = 'member.html'; return; }
  openAccountModal();
}

function openAccountModal() {
  switchAccountTab('login');
  const modal = document.getElementById('accountModal');
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
}

function closeAccountModal() {
  const modal = document.getElementById('accountModal');
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
}

// 忘记密码不放在可见的 tab 里，免得会员手滑点进去就申请一次重置密钥；
// 只有连续登录失败 3 次，错误提示里才会给出这个入口（见 doAccountLogin）
function switchAccountTab(tab) {
  document.querySelectorAll('.account-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.getElementById('loginForm').style.display = tab === 'login' ? '' : 'none';
  document.getElementById('registerForm').style.display = tab === 'register' ? '' : 'none';
  document.getElementById('forgotForm').style.display = tab === 'forgot' ? '' : 'none';
  document.getElementById('acctLoginError').textContent = '';
  document.getElementById('acctRegisterError').textContent = '';
  document.getElementById('acctForgotError').textContent = '';
  if (tab === 'login') loginFailCount = 0;
}

function revealForgotPassword() {
  switchAccountTab('forgot');
}

// 登录/注册允许填邮箱或手机号，系统按有没有 "@" 自动判断。手机号在 Supabase 里
// 没法直接当邮箱用，所以包装成一个固定后缀的"假邮箱"存进去——客人自己完全看不到这层，
// 她们眼里从头到尾都是"手机号 + 密码"。真邮箱原样使用。
function accountToAuthEmail(input) {
  const v = input.trim();
  if (v.includes('@')) return v;
  return v.replace(/\D/g, '') + '@member.zuowangmingshe.local';
}

// 密钥注册后是否立刻建好会员身份，取决于 Supabase 是否要求邮箱确认：
// 免确认的话 signUp 直接带回 session，当场兑换密钥；要确认的话就先记住这个密钥，
// 等她点完确认链接、回来登录成功那一刻再补上兑换。
async function redeemPendingOrCode(code, loginAccount, errElId = 'acctLoginError') {
  const errEl = document.getElementById(errElId);
  const { error } = await db.rpc('redeem_invite_code', { invite_code: code, p_login_account: loginAccount });
  if (error) { errEl.textContent = error.message || '密钥无效或已被使用'; return; }
  try { localStorage.removeItem('pendingInviteCode'); } catch (e) {}
  await db.auth.signOut({ scope: 'others' });
  closeAccountModal();
  await refreshAccountNav();
}

async function doAccountLogin(event) {
  event.preventDefault();
  const account = document.getElementById('acctLoginAccount').value.trim();
  const password = document.getElementById('acctLoginPassword').value;
  const errEl = document.getElementById('acctLoginError');
  const remember = document.getElementById('acctRememberLogin').checked;
  localStorage.setItem('rememberLogin', remember ? '1' : '0');
  const { error } = await db.auth.signInWithPassword({ email: accountToAuthEmail(account), password });
  if (error) {
    loginFailCount++;
    // 连续错 3 次才露出"忘记密码"入口，避免会员随手一点就跑去申请重置密钥
    if (loginFailCount >= 3) {
      errEl.innerHTML = '账号或密码错误。<a href="#" onclick="revealForgotPassword(); return false;">忘记密码？点此用密钥重置</a>';
    } else {
      errEl.textContent = '账号或密码错误';
    }
    return false;
  }
  loginFailCount = 0;
  // 踢掉这个账号在其他设备上的登录状态，同一账号同时只保留一处登录。
  // 登录成功后留在主页，不强制跳转——要不要进后台/会员中心由用户自己点导航栏决定。
  await db.auth.signOut({ scope: 'others' });
  await refreshAccountNav();
  if (currentAccountRole) {
    closeAccountModal();
    return false;
  }
  let pending = null;
  try { pending = JSON.parse(localStorage.getItem('pendingInviteCode') || 'null'); } catch (e) {}
  if (pending && pending.account === account) {
    await redeemPendingOrCode(pending.code, account);
    return false;
  }
  errEl.textContent = '此账号还没有对应的身份，请联系主理人';
  return false;
}

async function doAccountRegister(event) {
  event.preventDefault();
  const code = document.getElementById('regCode').value.trim();
  const account = document.getElementById('regAccount').value.trim();
  const password = document.getElementById('regPassword').value;
  const passwordConfirm = document.getElementById('regPasswordConfirm').value;
  const errEl = document.getElementById('acctRegisterError');
  errEl.textContent = '';
  if (password !== passwordConfirm) { errEl.textContent = '两次密码不一致'; return false; }
  const { data: signUpData, error: signUpError } = await db.auth.signUp({ email: accountToAuthEmail(account), password });
  if (signUpError) { errEl.textContent = signUpError.message.includes('already') ? '该账号已注册' : '注册失败：' + signUpError.message; return false; }
  if (!signUpData.session) {
    try { localStorage.setItem('pendingInviteCode', JSON.stringify({ account, code })); } catch (e) {}
    errEl.textContent = '注册成功，请到邮箱点击确认链接，然后回来登录完成会员激活';
    return false;
  }
  await redeemPendingOrCode(code, account, 'acctRegisterError');
  return false;
}

async function doForgotPassword(event) {
  event.preventDefault();
  const code = document.getElementById('forgotCode').value.trim();
  const password = document.getElementById('forgotPassword').value;
  const passwordConfirm = document.getElementById('forgotPasswordConfirm').value;
  const errEl = document.getElementById('acctForgotError');
  errEl.textContent = '';
  if (password !== passwordConfirm) { errEl.textContent = '两次密码不一致'; return false; }
  const { error } = await db.rpc('reset_password_with_code', { reset_code: code, new_password: password });
  if (error) { errEl.textContent = error.message || '密钥无效或已被使用'; return false; }
  switchAccountTab('login');
  document.getElementById('acctLoginError').textContent = '密码已重置，请用新密码登录';
  return false;
}

// 密码框加一个"显示/隐藏密码"的小眼睛——手机浏览器大多不像部分安卓输入法那样自带这个按钮，
// 加了之后跟平台无关，桌面/手机都一样能用
const EYE_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.94 10.94 0 0112 19c-7 0-11-7-11-7a21.86 21.86 0 015.06-6.06M9.9 4.24A10.94 10.94 0 0112 4c7 0 11 7 11 7a21.82 21.82 0 01-3.22 4.44M14.12 14.12a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';

function addPasswordToggle(inputId) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:relative';
  input.parentNode.insertBefore(wrap, input);
  wrap.appendChild(input);
  input.style.paddingRight = '40px';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.setAttribute('aria-label', '显示密码');
  btn.style.cssText = 'position:absolute;right:6px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;padding:6px;line-height:0;color:var(--ink-soft)';
  btn.innerHTML = EYE_ICON;
  btn.onclick = () => {
    const showing = input.type === 'text';
    input.type = showing ? 'password' : 'text';
    btn.innerHTML = showing ? EYE_ICON : EYE_OFF_ICON;
    btn.setAttribute('aria-label', showing ? '显示密码' : '隐藏密码');
  };
  wrap.appendChild(btn);
}

document.addEventListener('DOMContentLoaded', () => {
  refreshAccountNav();
  document.getElementById('accountModalClose').addEventListener('click', closeAccountModal);
  document.getElementById('accountModalOverlay').addEventListener('click', closeAccountModal);
  document.getElementById('bookingModalClose').addEventListener('click', closeBookingModal);
  document.getElementById('bookingModalOverlay').addEventListener('click', closeBookingModal);
  ['acctLoginPassword', 'regPassword', 'regPasswordConfirm', 'forgotPassword', 'forgotPasswordConfirm'].forEach(addPasswordToggle);
});

document.addEventListener('DOMContentLoaded', () => {
  // 无缝循环轮播 —— transform 控制，彻底消除 scrollLeft 跳帧
  function initCarousel(grid) {
    if (!grid) return;
    const origCards = Array.from(grid.querySelectorAll('.card'));
    if (origCards.length < 2) return;

    // 建 track：[前克隆 1..N][原始 1..N][后克隆 1..N]
    const track = document.createElement('div');
    track.className = 'carousel-track';
    origCards.forEach(c => track.appendChild(c.cloneNode(true)));  // 前克隆
    origCards.forEach(c => track.appendChild(c));                   // 原始（移入 track）
    origCards.forEach(c => track.appendChild(c.cloneNode(true)));  // 后克隆
    grid.appendChild(track);
    track.querySelectorAll('img').forEach(i => i.setAttribute('draggable', 'false'));

    const N = origCards.length;
    let tx = 0;

    function slotW() {
      const c = track.querySelector('.card');
      if (!c) return 0;
      const gap = parseFloat(getComputedStyle(track).gap) || 16;
      return c.offsetWidth + gap;
    }
    function origW() { return slotW() * N; }

    // setTX：设置 transform，同时做循环修正，永远保持在原始区间
    function setTX(val) {
      const ow = origW();
      while (val < -2 * ow) val += ow;
      while (val >= -ow)     val -= ow;
      tx = val;
      track.style.transform = `translateX(${tx}px)`;
    }

    // 初始化：用 setTimeout 确保 CSS 布局完全稳定后再计算
    setTimeout(() => setTX(-origW()), 50);

    let rafId = null, paused = false, pauseTimeout = null, autoTimer = null, firstStepTimer = null, animating = false;

    function pause() {
      paused = true;
      clearTimeout(pauseTimeout);
      pauseTimeout = setTimeout(() => { paused = false; }, 4000);
    }

    // 吸附到最近一张卡片，dur 可传入让手感连贯
    function snapTo(fromTX, dur) {
      const sw = slotW();
      if (!sw) { animating = false; return; }
      const nearest = Math.round(-fromTX / sw) * sw;
      const target = -nearest;
      const startTX = fromTX, d = dur || 380, t0 = performance.now();
      cancelAnimationFrame(rafId);
      animating = true;
      function tick(now) {
        const p = Math.min((now - t0) / d, 1);
        // ease-out cubic：起步柔和，收尾缓慢
        setTX(startTX + (target - startTX) * (1 - Math.pow(1 - p, 2.5)));
        if (p < 1) rafId = requestAnimationFrame(tick);
        else animating = false;
      }
      rafId = requestAnimationFrame(tick);
    }

    // 惯性 → 柔和减速 → 吸附
    function glide(vel) {
      let v = vel;
      cancelAnimationFrame(rafId);
      animating = true;
      function tick() {
        if (Math.abs(v) < 0.4) { snapTo(tx, 420); return; }
        setTX(tx + v);
        v *= 0.94;  // 更慢的摩擦，停顿感更自然
        rafId = requestAnimationFrame(tick);
      }
      rafId = requestAnimationFrame(tick);
    }

    // 自动：向左滚一张，从当前吸附位置出发
    function autoStep() {
      if (paused || animating) return;
      animating = true;
      const sw = slotW();
      const snappedTX = -Math.round(-tx / sw) * sw;
      const startTX = snappedTX, target = snappedTX - sw, dur = 500, t0 = performance.now();
      cancelAnimationFrame(rafId);
      function tick(now) {
        const p = Math.min((now - t0) / dur, 1);
        setTX(startTX + (target - startTX) * (1 - Math.pow(1 - p, 3)));
        if (p < 1) rafId = requestAnimationFrame(tick);
        else animating = false;
      }
      rafId = requestAnimationFrame(tick);
    }

    // 首次进入视野后很快就切一次，让用户第一时间看出这里能滑动，之后再按正常节奏轮播
    function startAuto() {
      clearInterval(autoTimer);
      clearTimeout(firstStepTimer);
      firstStepTimer = setTimeout(() => {
        autoStep();
        autoTimer = setInterval(autoStep, 3000);
      }, 900);
    }
    function stopAuto() {
      clearInterval(autoTimer);
      clearTimeout(firstStepTimer);
      cancelAnimationFrame(rafId);
      animating = false;
    }

    // ── 鼠标拖拽（电脑端）──
    // 向右拖 → tx 减 → 内容左移 → 下一张
    let md = false, mX0 = 0, mTX0 = 0, mVel = 0, mLX = 0, mLT = 0;

    track.addEventListener('mousedown', e => {
      cancelAnimationFrame(rafId); animating = false;
      md = true; mX0 = mLX = e.pageX; mTX0 = tx; mLT = Date.now(); mVel = 0;
      track.classList.add('grabbing');
      pause();
    });
    document.addEventListener('mousemove', e => {
      if (!md) return;
      const now = Date.now(), dt = now - mLT || 1;
      mVel = (e.pageX - mLX) / dt; mLX = e.pageX; mLT = now;
      setTX(mTX0 + (e.pageX - mX0)); // 向右拖(dx>0) → tx 增 → 内容右移（自然抓拽）
    });
    document.addEventListener('mouseup', () => {
      if (!md) return; md = false;
      track.classList.remove('grabbing');
      if (Math.abs(mVel) > 0.1) glide(mVel * 12);
      else snapTo(tx, 380);
    });

    // ── 触摸滑动（手机端）──
    // 向右滑 → tx 增 → 内容右移 → 上一张（自然手势）
    let tc = false, tX0 = 0, tY0 = 0, tTX0 = 0, tVel = 0, tLX = 0, tLT = 0, horiz = null;

    grid.addEventListener('touchstart', e => {
      cancelAnimationFrame(rafId); animating = false;
      const t = e.touches[0];
      tc = true; horiz = null;
      tX0 = tLX = t.pageX; tY0 = t.pageY; tTX0 = tx;
      tLT = Date.now(); tVel = 0;
      pause();
    }, { passive: true });

    grid.addEventListener('touchmove', e => {
      if (!tc) return;
      const t = e.touches[0];
      const dx = t.pageX - tX0, dy = t.pageY - tY0;
      if (horiz === null) {
        if (Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
        horiz = Math.abs(dx) >= Math.abs(dy);
      }
      if (!horiz) return;
      e.preventDefault();
      const now = Date.now(), dt = now - tLT || 1;
      tVel = (t.pageX - tLX) / dt; tLX = t.pageX; tLT = now;
      setTX(tTX0 + dx); // 向右滑(dx>0) → tx 增 → 内容右 → 上一张 ✓
    }, { passive: false });

    grid.addEventListener('touchend', () => {
      if (!tc) return; tc = false;
      if (horiz) {
        if (Math.abs(tVel) > 0.1) glide(tVel * 12);
        else snapTo(tx, 380); // 手指慢慢抬起，直接吸附
      } else {
        snapTo(tx, 380); // 方向未判定，也吸附一下
      }
    }, { passive: true });

    const observer = new IntersectionObserver(entries => {
      entries.forEach(e => e.isIntersecting ? startAuto() : stopAuto());
    }, { threshold: 0.2 });
    observer.observe(grid);

    // 返回销毁函数：把原始卡片移回 grid，清除 track
    return function destroy() {
      stopAuto();
      observer.disconnect();
      // 把原始卡片（track 中第 N+1 到第 2N 个 .card）移回 grid
      const allCards = Array.from(track.querySelectorAll('.card'));
      const origInTrack = allCards.slice(N, N * 2);
      origInTrack.forEach(c => grid.appendChild(c));
      track.remove();
    };
  }

  // 记录每个 grid 对应的销毁函数
  const destroyers = new Map();

  function checkCarousel() {
    const isMobile = window.innerWidth <= 860;
    document.querySelectorAll('.grid-3, .grid-4').forEach(grid => {
      const hasCarousel = destroyers.has(grid);
      if (isMobile && !hasCarousel) {
        const destroy = initCarousel(grid);
        if (destroy) destroyers.set(grid, destroy);
      } else if (!isMobile && hasCarousel) {
        destroyers.get(grid)();
        destroyers.delete(grid);
      }
    });
  }

  checkCarousel();

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      checkCarousel();
      ['qindaoGrid', 'yajiGrid'].forEach(id => {
        const g = document.getElementById(id);
        if (g) checkPosterCarousel(g);
      });
      // 手风琴的展开状态是手动切换的类名，跟屏幕宽度无关；
      // 宽屏下子菜单靠 hover 显示，切回宽屏时把之前在窄屏点开的状态清掉，避免残留导致子菜单一直显示
      if (window.innerWidth > 860) {
        document.querySelectorAll('.has-submenu.submenu-open').forEach(li => li.classList.remove('submenu-open'));
      }
      if (brandModal.classList.contains('open')) updateModalViewToggle();
    }, 150);
  });


  const navToggle = document.getElementById('navToggle');
  const navMenu = document.getElementById('navMenu');

  navToggle.addEventListener('click', () => {
    navMenu.classList.toggle('open');
  });

  // 用事件委托而不是逐个绑定，子菜单项是分类数据加载完之后才动态生成的。
  // 移动端（窄屏）点带子菜单的主菜单名字：只展开/收起子菜单，不跳转；
  // 子菜单里的具体项目、以及没有子菜单的主菜单项，照常跳转并收起整个导航栏。
  // 桌面端（宽屏）不受影响，主菜单名字照常跳转，子菜单靠鼠标悬停显示。
  navMenu.addEventListener('click', e => {
    const link = e.target.closest('a');
    if (!link) return;
    if (link.classList.contains('nav-parent-link') && window.innerWidth <= 860) {
      e.preventDefault();
      const li = link.closest('.has-submenu');
      const wasOpen = li?.classList.contains('submenu-open');
      // 同一时间只展开一个子菜单，点开新的会先收起其他已展开的，不允许叠加
      document.querySelectorAll('.has-submenu.submenu-open').forEach(el => el.classList.remove('submenu-open'));
      if (li && !wasOpen) li.classList.add('submenu-open');
      return;
    }
    navMenu.classList.remove('open');
  });

  // 前台分类缓存：{ tea: {key: catObj, ...}, teaware: {...}, guqin: {...} }
  const frontCatCache = {};

  // 导航栏子菜单跟分类数据同源，后台改分类名字/增删分类，这里会跟着一起变
  const navSubmenuConfig = {
    tea:     { id: 'submenu-tea',     anchor: '#tea',     attr: 'data-brand' },
    teaware: { id: 'submenu-teaware', anchor: '#teaware', attr: 'data-category' },
    guqin:   { id: 'submenu-zhuoqin', anchor: '#zhuoqin', attr: 'data-guqin' },
  };

  function renderNavSubmenu(type) {
    const cfg = navSubmenuConfig[type];
    if (!cfg) return;
    const ul = document.getElementById(cfg.id);
    if (!ul) return;
    const entries = Object.values(frontCatCache[type] || {});
    ul.innerHTML = entries
      .map(c => `<li><a href="${cfg.anchor}" class="nav-submenu-link" ${cfg.attr}="${c.key}">${c.name}</a></li>`)
      .join('');
  }

  async function loadFrontCategories(type, gridId, cardClass, imgClass, btnAttr, btnLabel) {
    const grid = document.getElementById(gridId);
    if (!grid) return;
    const data = await fetchWithRetry(() => db.from('categories')
      .select('*').eq('type', type).eq('is_visible', true).order('sort_order').order('created_at'));
    frontCatCache[type] = {};
    grid.innerHTML = '';
    if (data && data.length) {
      data.forEach(c => {
        frontCatCache[type][c.key] = c;
        const mediaClass = type === 'guqin' ? 'card-media square' : 'card-media';
        const imgTag = c.cover_url
          ? `<img ${imgClass ? `class="${imgClass}"` : ''} src="${c.cover_url}" alt="${c.name}" loading="lazy">`
          : '';
        const card = document.createElement('div');
        card.className = ('card ' + cardClass).trim();
        card.innerHTML = `
          <div class="${mediaClass}">${imgTag}</div>
          <div class="card-body">
            <h3>${c.name}</h3>
            ${c.description ? `<p>${c.description}</p>` : ''}
            <button class="explore-btn" type="button" ${btnAttr}="${c.key}">${btnLabel}</button>
          </div>`;
        grid.appendChild(card);
      });
      checkCarousel();
    }
    renderNavSubmenu(type);
  }

  loadFrontCategories('tea',     'brandGrid',   'brand-card',   '',          'data-brand',     '探索系列 →');
  loadFrontCategories('teaware', 'teawareGrid', 'teaware-card', 'cover-fit', 'data-category',  '茗器清赏 →');
  loadFrontCategories('guqin',   'guqinGrid',   '',             '',          'data-guqin',     '知音寻琴 →');

  // 预加载所有商品到内存，点击时秒开
  const productsCache = {};
  const productsById = {};
  function indexProducts(list) {
    (list || []).forEach(p => { productsById[p.id] = p; });
  }
  fetchWithRetry(() => db.from('products').select('*').eq('is_visible', true).order('sort_order').order('created_at'))
    .then(data => {
      if (!data) return;
      data.forEach(p => {
        if (!productsCache[p.category_key]) productsCache[p.category_key] = [];
        productsCache[p.category_key].push(p);
      });
      indexProducts(data);
    });

  const brandModal = document.getElementById('brandModal');
  const brandModalOverlay = document.getElementById('brandModalOverlay');
  const modalClose = document.getElementById('modalClose');
  const modalEyebrow = document.getElementById('modalEyebrow');
  const modalBrandName = document.getElementById('modalBrandName');
  const modalBrandDesc = document.getElementById('modalBrandDesc');
  const modalProducts = document.getElementById('modalProducts');

  function renderProductCard(p) {
    const card = document.createElement('div');
    card.className = 'product-card';
    const media = p.image_url
      ? `<img src="${p.image_url}" alt="${p.name}" style="width:100%;height:100%;object-fit:cover">`
      : '【产品实拍图占位】';
    const spec = p.price ? `¥${p.price}` : (p.spec || '');
    const desc = p.description || p.category || '';
    card.innerHTML = `
      <div class="product-media">${media}</div>
      <div class="product-body">
        <h4>${p.name}</h4>
        ${spec ? `<p class="product-spec">${spec}</p>` : ''}
        ${desc ? `<span class="product-category">${desc}</span>` : ''}
        <button class="detail-btn" type="button" data-id="${p.id}">查看详情</button>
      </div>
    `;
    return card;
  }

  async function openEntryModal(entry, eyebrowText, categoryKey) {
    if (!entry) return;
    modalEyebrow.textContent = eyebrowText;
    modalBrandName.textContent = entry.name;
    modalBrandDesc.textContent = entry.description || '';
    modalProducts.innerHTML = '<p style="color:#888;padding:20px 0">加载中…</p>';
    brandModal.classList.add('open');
    brandModal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
    updateModalViewToggle();

    const cached = productsCache[categoryKey];
    const products = cached !== undefined ? cached
      : await fetchWithRetry(() => db.from('products').select('*').eq('category_key', categoryKey).eq('is_visible', true).order('sort_order').order('created_at'));
    if (cached === undefined) indexProducts(products);
    if (products && products.length) {
      modalProducts.innerHTML = '';
      products.forEach(p => modalProducts.appendChild(renderProductCard(p)));
    } else {
      modalProducts.innerHTML = '<p style="color:#888;padding:20px 0">暂无商品</p>';
    }
    updateModalViewToggle();
  }

  // 商品浏览的每排数量切换：只有窄屏下一排天生只能放一个商品时才出现，
  // 电脑/平板宽度够放 2、3 个时不受影响、也不显示这个控件
  const modalViewToggle = document.getElementById('modalViewToggle');

  function getNaturalGridColumns() {
    const gap = 22, minCol = 200;
    if (!modalProducts.clientWidth) return 1;
    return Math.max(1, Math.floor((modalProducts.clientWidth + gap) / (minCol + gap)));
  }

  function applyModalGridCols(n) {
    modalProducts.classList.remove('force-cols-2', 'force-cols-3');
    if (n === 2) modalProducts.classList.add('force-cols-2');
    if (n === 3) modalProducts.classList.add('force-cols-3');
    modalViewToggle.querySelectorAll('.view-toggle-btn').forEach(btn => {
      btn.classList.toggle('active', parseInt(btn.dataset.cols, 10) === n);
    });
    try { localStorage.setItem('modalGridCols', String(n)); } catch (e) {}
  }

  function updateModalViewToggle() {
    if (getNaturalGridColumns() >= 2) {
      modalViewToggle.style.display = 'none';
      modalProducts.classList.remove('force-cols-2', 'force-cols-3');
      return;
    }
    modalViewToggle.style.display = 'flex';
    let saved = 1;
    try { saved = parseInt(localStorage.getItem('modalGridCols'), 10) || 1; } catch (e) {}
    applyModalGridCols(saved);
  }

  modalViewToggle.querySelectorAll('.view-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => applyModalGridCols(parseInt(btn.dataset.cols, 10)));
  });

  function closeEntryModal() {
    brandModal.classList.remove('open');
    brandModal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('modal-open');
  }

  // 商品详情图片弹窗
  const galleryModal = document.getElementById('productGalleryModal');
  const galleryOverlay = document.getElementById('productGalleryOverlay');
  const galleryClose = document.getElementById('galleryClose');
  const galleryMainImg = document.getElementById('galleryMainImg');
  const galleryThumbs = document.getElementById('galleryThumbs');
  const galleryPrev = document.getElementById('galleryPrev');
  const galleryNext = document.getElementById('galleryNext');
  const galleryProductName = document.getElementById('galleryProductName');
  const galleryProductSpec = document.getElementById('galleryProductSpec');
  const galleryProductDesc = document.getElementById('galleryProductDesc');

  let galleryImages = [];
  let galleryIndex = 0;

  function showGalleryImage(i) {
    galleryIndex = (i + galleryImages.length) % galleryImages.length;
    galleryMainImg.src = galleryImages[galleryIndex];
    [...galleryThumbs.children].forEach((el, idx) => el.classList.toggle('active', idx === galleryIndex));
  }

  function openProductGallery(p) {
    const images = [p.image_url, ...(p.detail_images || [])].filter(Boolean);
    galleryImages = images;
    galleryProductName.textContent = p.name;
    galleryProductSpec.textContent = p.price ? `¥${p.price}` : (p.spec || '');
    galleryProductDesc.textContent = p.description || '';
    if (images.length) {
      galleryMainImg.style.display = '';
      galleryThumbs.innerHTML = images.length > 1
        ? images.map((url, i) => `<img class="gallery-thumb" src="${url}" data-i="${i}" alt="">`).join('')
        : '';
      galleryThumbs.style.display = images.length > 1 ? 'flex' : 'none';
      galleryPrev.style.display = galleryNext.style.display = images.length > 1 ? '' : 'none';
      showGalleryImage(0);
    } else {
      galleryMainImg.style.display = 'none';
      galleryThumbs.innerHTML = '';
      galleryThumbs.style.display = 'none';
      galleryPrev.style.display = galleryNext.style.display = 'none';
    }
    galleryModal.classList.add('open');
    galleryModal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
  }

  function closeProductGallery() {
    galleryModal.classList.remove('open');
    galleryModal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('modal-open');
  }

  galleryThumbs.addEventListener('click', e => {
    const t = e.target.closest('.gallery-thumb');
    if (t) showGalleryImage(parseInt(t.dataset.i, 10));
  });
  galleryPrev.addEventListener('click', () => showGalleryImage(galleryIndex - 1));
  galleryNext.addEventListener('click', () => showGalleryImage(galleryIndex + 1));
  galleryClose.addEventListener('click', closeProductGallery);
  galleryOverlay.addEventListener('click', closeProductGallery);

  // 事件委托：绑定到 document，克隆卡片的按钮也能触发
  document.addEventListener('click', e => {
    const detailBtn = e.target.closest('.detail-btn');
    if (detailBtn) {
      const p = productsById[detailBtn.dataset.id];
      if (p) openProductGallery(p);
      return;
    }
    const btn = e.target.closest('.explore-btn, .nav-submenu-link');
    if (!btn) return;
    if (btn.dataset.brand) {
      openEntryModal(frontCatCache.tea?.[btn.dataset.brand], 'BRAND', btn.dataset.brand);
    } else if (btn.dataset.category) {
      openEntryModal(frontCatCache.teaware?.[btn.dataset.category], 'TEAWARE', btn.dataset.category);
    } else if (btn.dataset.guqin) {
      openEntryModal(frontCatCache.guqin?.[btn.dataset.guqin], 'GUQIN', btn.dataset.guqin);
    }
  });

  modalClose.addEventListener('click', closeEntryModal);
  brandModalOverlay.addEventListener('click', closeEntryModal);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (galleryModal.classList.contains('open')) closeProductGallery();
      else closeEntryModal();
    } else if (galleryModal.classList.contains('open')) {
      if (e.key === 'ArrowLeft') showGalleryImage(galleryIndex - 1);
      else if (e.key === 'ArrowRight') showGalleryImage(galleryIndex + 1);
    }
  });

  // 海报板块的导航子菜单：用海报的"显示文字"当子菜单文字，没填文字的海报不出现在子菜单里
  const posterNavSubmenuConfig = {
    qindao: { id: 'submenu-qindao', anchor: '#qindao' },
    yaji:   { id: 'submenu-yaji',   anchor: '#yaji' },
  };

  function renderPosterNavSubmenu(section, posters) {
    const cfg = posterNavSubmenuConfig[section];
    if (!cfg) return;
    const ul = document.getElementById(cfg.id);
    if (!ul) return;
    const titled = (posters || []).filter(p => p.title);
    ul.innerHTML = titled.map(p => `<li><a href="${cfg.anchor}">${p.title}</a></li>`).join('');
  }

  // 海报加载
  async function loadPosters(section, gridId, btnText, btnHref) {
    const grid = document.getElementById(gridId);
    if (!grid) return;
    const data = await fetchWithRetry(() => db.from('posters').select('*').eq('section', section).eq('is_visible', true).order('sort_order').order('created_at'));
    grid.innerHTML = '';
    if (data && data.length) {
      data.forEach(p => {
        const card = document.createElement('div');
        card.className = 'card poster-card';
        card.innerHTML = `
          <div class="card-media poster"><img src="${p.image_url}" alt="${p.title || '活动海报'}" loading="lazy"></div>
          <div class="card-body">
            ${p.title ? `<h3>${p.title}</h3>` : ''}
            <a href="${btnHref}" class="cta-btn">${btnText}</a>
          </div>`;
        grid.appendChild(card);
      });
      checkPosterCarousel(grid);
    }
    renderPosterNavSubmenu(section, data);
  }

  // 海报轮播：按实际是否装得下一排来判断，不依赖固定屏幕宽度断点
  function checkPosterCarousel(grid) {
    // 先拆除旧轮播，恢复原始卡片以便测量真实宽度
    if (destroyers.has(grid)) {
      destroyers.get(grid)();
      destroyers.delete(grid);
      grid.classList.remove('has-carousel');
    }
    const cards = grid.querySelectorAll('.card');
    if (cards.length < 2) return;
    const overflowing = grid.scrollWidth > grid.clientWidth + 1;
    if (overflowing) {
      const destroy = initCarousel(grid);
      if (destroy) {
        destroyers.set(grid, destroy);
        grid.classList.add('has-carousel');
      }
    }
  }

  loadPosters('qindao', 'qindaoGrid', '咨询报名 →', '#contact');
  loadPosters('yaji',   'yajiGrid',   '联络掌柜 →', '#contact');
});
