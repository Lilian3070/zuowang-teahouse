const db = supabase.createClient(
  'https://wmatsdnpbpcltuoynyrh.supabase.co',
  'sb_publishable_gw7gfFtSHHJR6SbDUpCTwA_HNcktgEl'
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

    let rafId = null, paused = false, pauseTimeout = null, autoTimer = null, animating = false;

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
    }, 150);
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

  // 前台分类缓存：{ tea: {key: catObj, ...}, teaware: {...}, guqin: {...} }
  const frontCatCache = {};

  async function loadFrontCategories(type, gridId, cardClass, imgClass, btnAttr, btnLabel) {
    const grid = document.getElementById(gridId);
    if (!grid) return;
    const data = await fetchWithRetry(() => db.from('categories')
      .select('*').eq('type', type).eq('is_visible', true).order('sort_order').order('created_at'));
    frontCatCache[type] = {};
    grid.innerHTML = '';
    if (!data || !data.length) return;
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
  }

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
    const btn = e.target.closest('.explore-btn');
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

  // 海报加载
  async function loadPosters(section, gridId, btnText, btnHref) {
    const grid = document.getElementById(gridId);
    if (!grid) return;
    const data = await fetchWithRetry(() => db.from('posters').select('*').eq('section', section).eq('is_visible', true).order('sort_order').order('created_at'));
    grid.innerHTML = '';
    if (!data || !data.length) return;
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
