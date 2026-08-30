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

// 账号入口：识别当前登录人是管理员还是会员，决定导航栏那个按钮点了之后去哪
let currentAccountRole = null; // 'admin' | 'member' | null（未登录或还没有角色记录）
let loginFailCount = 0;

async function refreshAccountNav() {
  const link = document.getElementById('navAccountLink');
  if (!link) return;
  const { data: { user } } = await db.auth.getUser();
  if (!user) { currentAccountRole = null; link.textContent = '登录'; return; }
  const { data: profile } = await db.from('profiles').select('role').eq('id', user.id).maybeSingle();
  currentAccountRole = profile ? profile.role : null;
  link.textContent = currentAccountRole === 'admin' ? '进入后台' : currentAccountRole === 'member' ? '会员中心' : '登录';
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
  sessionStorage.setItem('justLoggedIn', '1');
  closeAccountModal();
  await refreshAccountNav();
  location.href = 'member.html';
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
  // "踢掉其他设备"放到落地页（admin.html/member.html）确认完自己的身份之后再做，
  // 不在这里跳转前做——实测这里调用 signOut({scope:'others'}) 紧接着跳页面，会把
  // 刚建好的本机登录状态也一起冲掉，导致跳过去还要再登一次。用这个标记告诉落地页
  // "我是刚登录的，该踢一下其他设备了"。
  sessionStorage.setItem('justLoggedIn', '1');
  await refreshAccountNav();
  if (currentAccountRole) {
    closeAccountModal();
    location.href = currentAccountRole === 'admin' ? 'admin.html' : 'member.html';
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
  const errEl = document.getElementById('acctRegisterError');
  errEl.textContent = '';
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
  const errEl = document.getElementById('acctForgotError');
  const { error } = await db.rpc('reset_password_with_code', { reset_code: code, new_password: password });
  if (error) { errEl.textContent = error.message || '密钥无效或已被使用'; return false; }
  switchAccountTab('login');
  document.getElementById('acctLoginError').textContent = '密码已重置，请用新密码登录';
  return false;
}

document.addEventListener('DOMContentLoaded', () => {
  refreshAccountNav();
  document.getElementById('accountModalClose').addEventListener('click', closeAccountModal);
  document.getElementById('accountModalOverlay').addEventListener('click', closeAccountModal);
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

  // 席位预约 - 知音通道：手机号验证后再展开真正的预约表单。
  // 白名单目前是前端写死的演示数据，仅用于验证交互流程，
  // 不具备真实校验能力（任何人查看网页源码都能看到号码）——
  // 正式上线需要把这一步换成真实的后端接口 + 会员数据库。
  const demoWhitelist = ['13800138000', '13900139000'];

  const verifyForm = document.getElementById('verifyForm');
  const verifyPhone = document.getElementById('verifyPhone');
  const verifyMessage = document.getElementById('verifyMessage');
  const realBookingForm = document.getElementById('realBookingForm');
  const formStatus = document.getElementById('formStatus');

  verifyForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const phone = verifyPhone.value.trim();

    if (demoWhitelist.includes(phone)) {
      verifyMessage.textContent = '验证通过，欢迎回来，请填写席位预约信息。';
      verifyMessage.className = 'verify-message success';
      realBookingForm.classList.add('expanded');
    } else {
      verifyMessage.textContent = '未查询到您的预约资格，请先添加掌柜微信沟通。';
      verifyMessage.className = 'verify-message error';
      realBookingForm.classList.remove('expanded');
    }
  });

  realBookingForm.addEventListener('submit', (e) => {
    e.preventDefault();
    formStatus.style.display = 'block';
    realBookingForm.reset();
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
