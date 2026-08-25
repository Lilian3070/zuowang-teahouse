document.addEventListener('DOMContentLoaded', () => {
  const navToggle = document.getElementById('navToggle');
  const navMenu = document.getElementById('navMenu');

  navToggle.addEventListener('click', () => {
    navMenu.classList.toggle('open');
  });

  navMenu.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => navMenu.classList.remove('open'));
  });

  const bookingForm = document.getElementById('bookingForm');
  const formStatus = document.getElementById('formStatus');

  bookingForm.addEventListener('submit', (e) => {
    e.preventDefault();
    formStatus.style.display = 'block';
    bookingForm.reset();
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

  const brandModal = document.getElementById('brandModal');
  const brandModalOverlay = document.getElementById('brandModalOverlay');
  const modalClose = document.getElementById('modalClose');
  const modalEyebrow = document.getElementById('modalEyebrow');
  const modalBrandName = document.getElementById('modalBrandName');
  const modalBrandDesc = document.getElementById('modalBrandDesc');
  const modalProducts = document.getElementById('modalProducts');

  function renderProductCard(product) {
    const card = document.createElement('div');
    card.className = 'product-card';
    card.innerHTML = `
      <div class="product-media">【产品实拍图占位】</div>
      <div class="product-body">
        <span class="product-category">${product.category}</span>
        <h4>${product.name}</h4>
        <p class="product-spec">${product.spec}</p>
        <button class="detail-btn" type="button">查看详情</button>
      </div>
    `;
    return card;
  }

  function openEntryModal(entry, eyebrowText) {
    if (!entry) return;
    modalEyebrow.textContent = eyebrowText;
    modalBrandName.textContent = entry.name;
    modalBrandDesc.textContent = entry.desc;
    modalProducts.innerHTML = '';
    entry.products.forEach(p => modalProducts.appendChild(renderProductCard(p)));
    brandModal.classList.add('open');
    brandModal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
  }

  function closeEntryModal() {
    brandModal.classList.remove('open');
    brandModal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('modal-open');
  }

  document.querySelectorAll('.explore-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.brand) {
        openEntryModal(teaBrands[btn.dataset.brand], 'BRAND');
      } else if (btn.dataset.category) {
        openEntryModal(teawareCategories[btn.dataset.category], 'TEAWARE');
      }
    });
  });

  modalClose.addEventListener('click', closeEntryModal);
  brandModalOverlay.addEventListener('click', closeEntryModal);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeEntryModal();
  });
});
