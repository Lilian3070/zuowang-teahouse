const db = supabase.createClient(
  'https://wmatsdnpbpcltuoynyrh.supabase.co',
  'sb_publishable_gw7gfFtSHHJR6SbDUpCTwA_HNcktgEl'
);

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
      return c ? (c.offsetWidth + 16) : 0;
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

    let rafId = null, paused = false, pauseTimeout = null, autoTimer = null, animating = false;

    function pause() {
      paused = true;
      clearTimeout(pauseTimeout);
      pauseTimeout = setTimeout(() => { paused = false; }, 4000);
    }

    // 惯性：vel > 0 → tx 增 → 内容右移（上一张）；vel < 0 → tx 减 → 内容左移（下一张）
    function glide(vel) {
      let v = vel;
      cancelAnimationFrame(rafId);
      animating = true;
      function tick() {
        if (Math.abs(v) < 0.3) { animating = false; return; }
        setTX(tx + v);
        v *= 0.95;
        rafId = requestAnimationFrame(tick);
      }
      rafId = requestAnimationFrame(tick);
    }

    // 自动：向左滚一张（下一张）
    function autoStep() {
      if (paused || animating) return;
      animating = true;
      const startTX = tx, target = tx - slotW(), dur = 500, t0 = performance.now();
      cancelAnimationFrame(rafId);
      function tick(now) {
        const p = Math.min((now - t0) / dur, 1);
        setTX(startTX + (target - startTX) * (1 - Math.pow(1 - p, 3)));
        if (p < 1) rafId = requestAnimationFrame(tick);
        else animating = false;
      }
      rafId = requestAnimationFrame(tick);
    }

    function startAuto() { clearInterval(autoTimer); autoTimer = setInterval(autoStep, 3000); }
    function stopAuto()  { clearInterval(autoTimer); cancelAnimationFrame(rafId); animating = false; }

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
      glide(mVel * 15); // 向右拖 mVel>0 → vel 正 → tx 继续增 ✓
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
      if (horiz) glide(tVel * 15); // 向右滑 tVel>0 → vel 正 → tx 继续增 ✓
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
    resizeTimer = setTimeout(checkCarousel, 150);
  });


  const navToggle = document.getElementById('navToggle');
  const navMenu = document.getElementById('navMenu');

  navToggle.addEventListener('click', () => {
    navMenu.classList.toggle('open');
  });

  navMenu.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => navMenu.classList.remove('open'));
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

  // 茶叶版块：品牌 -> 产品 两级浏览（品牌为真实合作品牌，具体茶品暂为示例数据，正式上线前替换）
  const teaBrands = {
    zhengshantang: {
      name: '正山堂 · 骏眉中国',
      desc: '高端红茶奠基者，传承四百年正山小种底蕴，开创清香甘醇新红茶。',
      products: [
        { name: '【示例】金骏眉', category: '红茶', spec: '【规格/价格示例】50g / ¥488' },
        { name: '【示例】银骏眉', category: '红茶', spec: '【规格/价格示例】100g / ¥298' },
        { name: '【示例】铜骏眉', category: '红茶', spec: '【规格/价格示例】125g / ¥168' }
      ]
    },
    hexingyan: {
      name: '和星岩',
      desc: '专注武夷核心正岩山场，传承传统炭焙工艺，臻选岩骨花香之味。',
      products: [
        { name: '【示例】正岩大红袍', category: '岩茶', spec: '【规格/价格示例】50g / ¥268' },
        { name: '【示例】荒野老丛水仙', category: '岩茶', spec: '【规格/价格示例】50g / ¥328' },
        { name: '【示例】牛栏坑肉桂', category: '岩茶', spec: '【规格/价格示例】50g / ¥398' }
      ]
    },
    pinguvillage: {
      name: '品古村',
      desc: '深耕高山野生茶源，遵循古法采制，保留最纯粹自然的山野气韵。',
      products: [
        { name: '【示例】易武古树生普', category: '普洱', spec: '【规格/价格示例】357g 饼 / ¥588' },
        { name: '【示例】冰岛熟普', category: '普洱', spec: '【规格/价格示例】357g 饼 / ¥688' },
        { name: '【示例】福鼎白牡丹', category: '白茶', spec: '【规格/价格示例】200g / ¥158' }
      ]
    }
  };

  // 茶具版块：分类 -> 产品 两级浏览（分类为结构占位，具体茶具暂为示例数据，正式上线前替换）
  const teawareCategories = {
    zhuchaqi: {
      name: '泡茶主器',
      desc: '手感顺畅，出水断水利落，兼具实用与观赏价值。',
      products: [
        { name: '【示例】紫砂梨形壶', category: '紫砂', spec: '【规格/价格示例】180ml / ¥680' },
        { name: '【示例】白瓷盖碗', category: '陶瓷', spec: '【规格/价格示例】120ml / ¥168' },
        { name: '【示例】建水紫陶壶', category: '紫陶', spec: '【规格/价格示例】200ml / ¥880' }
      ]
    },
    pinmingbei: {
      name: '品茗杯盏',
      desc: '观茶汤之色，品茶香之韵，寻一只称手的专属主人杯。',
      products: [
        { name: '【示例】建盏主人杯', category: '建盏', spec: '【规格/价格示例】80ml / ¥328' },
        { name: '【示例】白瓷品茗杯（一组四只）', category: '陶瓷', spec: '【规格/价格示例】50ml×4 / ¥238' },
        { name: '【示例】柴烧茶盏', category: '柴烧', spec: '【规格/价格示例】60ml / ¥398' }
      ]
    },
    chaxiyashe: {
      name: '茶席雅设',
      desc: '点缀案头茶席，营造静谧雅致的品茶氛围。',
      products: [
        { name: '【示例】天然麻布茶席', category: '茶席布', spec: '【规格/价格示例】30×90cm / ¥168' },
        { name: '【示例】黄铜茶则茶匙组', category: '铜器', spec: '【规格/价格示例】五件套 / ¥228' },
        { name: '【示例】枯山水茶盘', category: '竹木', spec: '【规格/价格示例】40×25cm / ¥398' }
      ]
    },
    mingyao: {
      name: '名窑匠作',
      desc: '严选名窑大工精制，独一无二的匠心器物。',
      products: [
        { name: '【示例】景德镇手绘薄胎杯', category: '名窑瓷', spec: '【规格/价格示例】60ml / ¥880' },
        { name: '【示例】龙泉青瓷茶洗', category: '青瓷', spec: '【规格/价格示例】直径12cm / ¥560' },
        { name: '【示例】汝窑天青釉盖碗', category: '汝窑', spec: '【规格/价格示例】130ml / ¥1280' }
      ]
    }
  };

  // 斫琴甄选版块：分类 -> 琴器 两级浏览（分类为真实分类，具体琴器暂为示例数据，正式上线前替换）
  const guqinCategories = {
    chuxian: {
      name: '初弦',
      desc: '初学者入门之选，手感松沉顺手，陪伴您迈出习琴的第一步。',
      products: [
        { name: '【示例】梧桐面板初学琴', category: '入门琴', spec: '【规格/价格示例】标准式 / ¥1680' },
        { name: '【示例】杉木仲尼式练习琴', category: '入门琴', spec: '【规格/价格示例】标准式 / ¥2280' }
      ]
    },
    miaoyin: {
      name: '妙音',
      desc: '演奏与进阶之选，音色饱满圆润、余韵深长，是日常操缦的知心伴侣。',
      products: [
        { name: '【示例】老杉木鸣凤琴', category: '演奏琴', spec: '【规格/价格示例】仲尼式 / ¥6800' },
        { name: '【示例】伏羲式演奏琴', category: '演奏琴', spec: '【规格/价格示例】伏羲式 / ¥8600' }
      ]
    },
    cangfeng: {
      name: '藏锋',
      desc: '经典良材与老漆珍品，兼具精湛工艺与深厚收藏之美。',
      products: [
        { name: '【示例】百年杉木仲尼式', category: '收藏琴', spec: '【规格/价格示例】仲尼式 / ¥28000' },
        { name: '【示例】老漆断纹古琴', category: '收藏琴', spec: '【规格/价格示例】连珠式 / ¥36000' }
      ]
    },
    xiexing: {
      name: '携行',
      desc: '形制小巧轻灵的膝琴，无论案头清修还是外出随身携带皆宜。',
      products: [
        { name: '【示例】便携膝琴', category: '便携琴', spec: '【规格/价格示例】迷你式 / ¥3200' },
        { name: '【示例】折叠式随行琴', category: '便携琴', spec: '【规格/价格示例】可拆卸 / ¥3800' }
      ]
    }
  };

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
        ${desc ? `<span class="product-category">${desc}</span>` : ''}
        <h4>${p.name}</h4>
        ${spec ? `<p class="product-spec">${spec}</p>` : ''}
        <button class="detail-btn" type="button">查看详情</button>
      </div>
    `;
    return card;
  }

  async function openEntryModal(entry, eyebrowText, categoryKey) {
    if (!entry) return;
    modalEyebrow.textContent = eyebrowText;
    modalBrandName.textContent = entry.name;
    modalBrandDesc.textContent = entry.desc;
    modalProducts.innerHTML = '<p style="color:#888;padding:20px 0">加载中…</p>';
    brandModal.classList.add('open');
    brandModal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');

    const { data: products } = await db.from('products').select('*').eq('category_key', categoryKey).eq('is_visible', true).order('sort_order').order('created_at');
    if (products && products.length) {
      modalProducts.innerHTML = '';
      products.forEach(p => modalProducts.appendChild(renderProductCard(p)));
    } else {
      modalProducts.innerHTML = '<p style="color:#888;padding:20px 0">暂无商品</p>';
    }
  }

  function closeEntryModal() {
    brandModal.classList.remove('open');
    brandModal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('modal-open');
  }

  // 事件委托：绑定到 document，克隆卡片的按钮也能触发
  document.addEventListener('click', e => {
    const btn = e.target.closest('.explore-btn');
    if (!btn) return;
    if (btn.dataset.brand) {
      openEntryModal(teaBrands[btn.dataset.brand], 'BRAND', btn.dataset.brand);
    } else if (btn.dataset.category) {
      openEntryModal(teawareCategories[btn.dataset.category], 'TEAWARE', btn.dataset.category);
    } else if (btn.dataset.guqin) {
      openEntryModal(guqinCategories[btn.dataset.guqin], 'GUQIN', btn.dataset.guqin);
    }
  });

  modalClose.addEventListener('click', closeEntryModal);
  brandModalOverlay.addEventListener('click', closeEntryModal);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeEntryModal();
  });

  // 海报加载
  async function loadPosters(section, gridId, btnText, btnHref) {
    const grid = document.getElementById(gridId);
    if (!grid) return;
    const { data } = await db.from('posters').select('*').eq('section', section).eq('is_visible', true).order('sort_order').order('created_at');
    if (!data || !data.length) { grid.innerHTML = ''; return; }
    grid.innerHTML = data.map(p => `
      <div class="card poster-card">
        <div class="card-media poster"><img src="${p.image_url}" alt="${p.title || '活动海报'}" loading="lazy"></div>
        <div class="card-body">
          ${p.title ? `<h3>${p.title}</h3>` : ''}
          <a href="${btnHref}" class="cta-btn">${btnText}</a>
        </div>
      </div>
    `).join('');
  }

  loadPosters('qindao', 'qindaoGrid', '咨询报名 →', '#contact');
  loadPosters('yaji',   'yajiGrid',   '联络掌柜 →', '#contact');
});
