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
let bookingModalPageScrollY = 0;

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
  bookingModalPageScrollY = window.scrollY;
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('modal-open');
  document.body.style.position = 'fixed';
  document.body.style.top = `-${bookingModalPageScrollY}px`;
  document.body.style.width = '100%';
  bwkAnchor = bwkDayStart(shopNow());
  renderBwkWeek();
}

function closeBookingModal() {
  const modal = document.getElementById('bookingModal');
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('modal-open');
  document.body.style.position = '';
  document.body.style.top = '';
  document.body.style.width = '';
  window.scrollTo(0, bookingModalPageScrollY);
}

async function submitBookingRequest(event) {
  event.preventDefault();
  const statusEl = document.getElementById('bookingFormStatus');
  if (!currentMemberId) { statusEl.style.color = '#e7a39c'; statusEl.textContent = '请先登录会员账号'; return false; }
  const datetime = document.getElementById('datetime').value.trim();
  const slot = document.getElementById('slot').value;
  if (!datetime || !slot || !bwkSelected) { statusEl.style.color = '#e7a39c'; statusEl.textContent = '请先在上方选择到访时间'; return false; }
  const note = document.getElementById('note').value.trim();
  const startAt = new Date(bwkSelected.y, bwkSelected.m, bwkSelected.d, Math.floor(bwkSelected.startSlot / 2), bwkSelected.startSlot % 2 ? 30 : 0);
  const endAt = new Date(bwkSelected.y, bwkSelected.m, bwkSelected.d, Math.floor(bwkSelected.endSlot / 2), bwkSelected.endSlot % 2 ? 30 : 0);
  const base = { member_id: currentMemberId, preferred_time: datetime + ' · ' + slot, note };
  // 客人在周表上选的是茶室那边的钟点，写库前换算成绝对时刻
  let { error } = await db.from('booking_requests').insert({
    ...base, start_at: shopToISO(startAt), end_at: shopToISO(endAt),
  });
  // start_at/end_at 是 supabase/booking_calendar_workflow.sql 加的列。网站是 push 到 GitHub
  // Pages 自动部署的，代码上线和跑那份 SQL 之间必然有个时间差；万一客人正好卡在这个窗口里提交，
  // 少了这两列不该让她整个约不成——退回只写 preferred_time 那份（后台仍能从这段文字解析出时间）
  if (error && /start_at|end_at/.test(error.message || '')) {
    ({ error } = await db.from('booking_requests').insert(base));
  }
  if (error) { statusEl.style.color = '#e7a39c'; statusEl.textContent = '提交失败：' + error.message; return false; }
  statusEl.style.color = '#cfe0b8';
  statusEl.textContent = '已收到您的预约申请，我们会尽快与您确认。';
  document.getElementById('realBookingForm').reset();
  resetBwkPicker();
  return false;
}

// ── 店里的时间（跟 admin.html 里那份保持一致，改一处两处都要改）─────────────
// 茶室在温州，"上午11点"永远指温州的 11 点，不该跟着看的人所在时区变（网站也只面向国内）。
// 数据库存的是绝对时刻（timestamptz）。做法是只在**数据库边界**换算：读出来先转成一个
// "显示用 Date"——它的本地 getHours()/getDate() 读出来正好就是北京时间的钟点；写回去之前
// 再换算回绝对时刻。这样中间所有画格子/定位/切天的代码一行都不用动。
// 对身处 UTC+8 的人（主理人）来说换算量正好是 0，结果跟以前完全一样；在别的时区打开也
// 看到同一个温州钟点。北京时间全年 UTC+8、没有夏令时，用固定偏移就够。
const SHOP_UTC_OFFSET_MIN = 8 * 60;
function shopDate(value) {
  const t = new Date(value);
  // 先用 t 自己的时区偏移估一次，再用估出来那一刻的偏移修一次——看的人所在时区如果有
  // 夏令时，这两个偏移可能差一小时，修一次才落在正确的钟点上
  const approx = new Date(t.getTime() + (SHOP_UTC_OFFSET_MIN + t.getTimezoneOffset()) * 60000);
  return new Date(t.getTime() + (SHOP_UTC_OFFSET_MIN + approx.getTimezoneOffset()) * 60000);
}
function shopToISO(d) {
  return new Date(d.getTime() - (SHOP_UTC_OFFSET_MIN + d.getTimezoneOffset()) * 60000).toISOString();
}
function shopNow() { return shopDate(new Date()); }

// 首页预约表单选时段：照抄后台 admin.html 周视图的表格骨架（时间轴+按天分栏+半小时格），
// 只是内容做阉割——看不到备忘录/行程标题，格子只剩"能点"（空档）跟"不能点"（占用/关闭/
// 已过去，统一灰色斜纹，不挂钩具体原因）两种状态；点起点、再点终点选一段时间（跟后台
// 拖拽预选一个道理，只是这里用点两下代替拖拽，手机上更好操作）
let bwkAnchor = bwkDayStart(shopNow()); // 当前显示的连续七天起始日（按茶室所在地的"今天"）
let bwkDaysData = [];      // 当前这一周已经算好忙闲的每一天，点格子时直接查这份，不用重新请求
let bwkSelected = null;    // 起点+终点都选完了：{ y, m, d, startSlot, endSlot }
const BWK_WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];

function bwkDayStart(d) {
  const day = new Date(d);
  day.setHours(0, 0, 0, 0);
  return day;
}

// 营业时间是 9:30-23:30——跟后台日历默认显示窗口的 8:30 不是一回事，那只是后台自己
// 看行程时习惯往前多留半小时方便看，不代表真的 8:30 就开门营业
const BOOKING_BUSINESS_START_SLOT = 19; // 9:30 = 9.5*2
const BOOKING_BUSINESS_END_SLOT = 47;   // 23:30 = 23.5*2
// ⚠️ 这两个尺寸必须跟 styles.css 里 .bwk-cell 的 height、.bwk-col-head 的 height 一致，
// 拖拽算"手指落在第几格"和预选框的定位都靠它们，改 CSS 记得同步改这里
const BWK_SLOT_H = 24;  // 半小时一格的高度（后台 calWeekPxPerHour 48 的一半）
const BWK_HEAD_H = 40;  // 表头那一行的高度

// 时间标签格式跟后台完全一样：早上/上午/中午/下午/晚上 + 12 小时制，不是"18:00"这种
// 24 小时制裸数字（periodWordForHour 的分段跟 admin.html 里那份一模一样）
function bwkPeriodWordForHour(h) {
  if (h < 5) return '凌晨';
  if (h < 9) return '早上';
  if (h < 12) return '上午';
  if (h < 13) return '中午';
  if (h < 18) return '下午';
  return '晚上';
}
function bwkFormatSlot(slotIdx) {
  const p = bwkFormatSlotParts(slotIdx);
  return `${p.period}${p.time}`;
}
// 拆成"上午"/"10:00"两段分两行显示，跟后台 formatSlotLabelParts + 手机版那套 CSS 一样，
// 时间轴那一列很窄，一行放不下"上午10:00"六个字
function bwkFormatSlotParts(slotIdx) {
  const h = Math.floor(slotIdx / 2), m = slotIdx % 2 ? 30 : 0;
  let h12 = h % 12; if (h12 === 0) h12 = 12;
  return { period: bwkPeriodWordForHour(h), time: `${h12}:${String(m).padStart(2, '0')}` };
}

function bwkShiftWeek(dir) {
  const next = new Date(bwkAnchor);
  next.setDate(next.getDate() + dir * 7);
  if (bwkAnchor <= bwkDayStart(shopNow()) && dir < 0) return;
  if (next < bwkDayStart(shopNow())) next.setTime(bwkDayStart(shopNow()).getTime()); // 跨日后返回也不能显示过去日期
  bwkAnchor = next;
  renderBwkWeek();
}

// 跟后台工具栏的"今天"按钮一个道理，翻了好几周之后能一键跳回从今天开始的七天
function bwkGoToday() {
  bwkAnchor = bwkDayStart(shopNow());
  renderBwkWeek();
}

// 每一周的忙闲原始数据按"七天的起始日"缓存起来，翻回看过的周直接画、不再请求；
// 每次画完还会顺手预取上一周/下一周，所以点 ‹ › 绝大多数时候是零等待、不闪一下
const bwkWeekCache = new Map();

async function bwkLoadWeek(weekStart) {
  const key = weekStart.getTime();
  if (bwkWeekCache.has(key)) return bwkWeekCache.get(key);
  const weekEnd = new Date(weekStart); weekEnd.setDate(weekEnd.getDate() + 7);
  // weekStart/weekEnd 是"显示用 Date"（本地钟点=北京钟点），发给数据库前换回绝对时刻
  const { data, error } = await db.rpc('get_tea_busy_ranges', {
    p_start: shopToISO(weekStart), p_end: shopToISO(weekEnd),
  });
  if (error) throw error;
  bwkWeekCache.set(key, data || []);
  return data || [];
}

// 在后台悄悄把相邻两周也取回来，用户点 ‹ › 的时候就已经在缓存里了
function bwkPrefetchNeighbors() {
  const todayStart = bwkDayStart(shopNow());
  [-7, 7].forEach(off => {
    const w = new Date(bwkAnchor); w.setDate(w.getDate() + off);
    if (w >= todayStart) bwkLoadWeek(w).catch(() => {});
  });
}

// 把这一周的原始忙闲区间算成"每天每个半小时格能不能约"。rows 传 null 表示数据还在路上，
// 先按"暂时都不能点"画出骨架，等数据回来再重画——**绝不能把表清空成一行"加载中"文字**，
// 那样每翻一周画面都要闪一下（见 不许再犯.md 第 1 条）
function bwkBuildDays(rows) {
  // "今天"和"现在"都按茶室所在地（北京时间）算，不按看的人所在时区——不然人在国外打开，
  // 会把温州这边其实还没到的时段当成"已过"划掉
  const now = shopNow();
  const today = bwkDayStart(now);
  const days = [];
  for (let i = 0; i < 7; i++) {
    const day = new Date(bwkAnchor); day.setDate(day.getDate() + i);
    const weekdayIndex = (day.getDay() + 6) % 7;
    days.push({
      date: day, weekday: BWK_WEEKDAYS[weekdayIndex],
      isToday: day.getTime() === today.getTime(),
      loading: rows === null,
      // 客人看到的七天从今天起排开，因此底色也从第一栏开始严格黄白交替；
      // 不跟星期几绑定，否则从周六开始会出现黄、白、白、黄的错位。
      colTint: i % 2 === 0 ? '#F8EED7' : '#F7F3EC',
    });
  }
  days.forEach(d => {
    const dayStart = d.date;
    const busy = new Array(48).fill(false);
    // reason 记的是"这格为什么不能约"：'past'=已经过去了、'full'=被占用或主理人关了。
    // 客人只看得到这两种说法，看不出到底是别人订了还是主理人关店（那是隐私，见
    // get_tea_busy_ranges 只返回起止时间的设计）；null=能约，或者数据还在路上还不知道
    const reason = new Array(48).fill(null);
    d.busy = busy; d.reason = reason;
    // 数据还没回来：整列先按"不可点"画骨架，但不写"已约满"——还不知道满没满，
    // 写了等数据回来又变回空档，等于骗了客人一下
    if (rows === null) { busy.fill(true); return; }
    rows.forEach(r => {
      // 库里是绝对时刻，转成"显示用 Date"再跟这一天的格子对齐
      const s = shopDate(r.start_at), e = shopDate(r.end_at);
      const sSlot = Math.max(0, Math.floor((s - dayStart) / 60000 / 30));
      const eSlot = Math.min(48, Math.ceil((e - dayStart) / 60000 / 30));
      for (let k = Math.max(0, sSlot); k < Math.min(48, eSlot); k++) busy[k] = true;
    });
    if (d.isToday) {
      const nowSlot = Math.ceil((now.getHours() * 60 + now.getMinutes()) / 30);
      // 今天已经过去的那几格标 'past' 而不是 'full'——哪怕它同时也被行程占着，
      // 对客人来说"已过"才是更有用的说法
      for (let k = 0; k < Math.min(48, nowSlot); k++) { busy[k] = true; reason[k] = 'past'; }
    }
    for (let k = 0; k < 48; k++) if (busy[k] && !reason[k]) reason[k] = 'full';
  });
  return days;
}

// 把一列里连续的不可约格子合并成"一段"，好在整段中间写一次"已约满"／"已过"，
// 而不是每格都写一遍（每格都写既啰嗦又看不出这一整段是连着的）
function bwkBlockedRuns(d) {
  const runs = [];
  let k = BOOKING_BUSINESS_START_SLOT;
  while (k < BOOKING_BUSINESS_END_SLOT) {
    const r = d.reason[k];
    if (!r) { k++; continue; }
    let j = k;
    while (j < BOOKING_BUSINESS_END_SLOT && d.reason[j] === r) j++;
    runs.push({ s0: k, s1: j, reason: r });
    k = j;
  }
  return runs;
}

// 不可约那一段上盖的说明标：绝对定位盖住整段，pointer-events:none 不挡下面的格子。
// 文字本身在 CSS 里是 position:sticky，一段很长（比如整天已过去）时向下滚也一直跟着，
// 不会滚到中间就看不见这段是什么状态
function bwkBlockedTagHtml(run) {
  const top = BWK_HEAD_H + (run.s0 - BOOKING_BUSINESS_START_SLOT) * BWK_SLOT_H;
  const height = (run.s1 - run.s0) * BWK_SLOT_H;
  const text = run.reason === 'past' ? '已过' : '已约满';
  return `<div class="bwk-blocked-tag" style="top:${top}px;height:${height}px"><span>${text}</span></div>`;
}

async function renderBwkWeek() {
  const wrap = document.getElementById('bwkGrid');
  const todayStart = bwkDayStart(shopNow());
  if (bwkAnchor < todayStart) bwkAnchor = todayStart;
  document.getElementById('bwkPrevBtn').disabled = bwkAnchor.getTime() <= todayStart.getTime();

  // 连续七天，可跨周、跨月和跨年。
  const firstDay = bwkAnchor;
  const lastDay = new Date(bwkAnchor); lastDay.setDate(lastDay.getDate() + 6);
  document.getElementById('bwkRangeLabel').textContent =
    `${firstDay.getMonth() + 1}月${firstDay.getDate()}日 - ${lastDay.getMonth() + 1}月${lastDay.getDate()}日`;

  const key = bwkAnchor.getTime();
  if (bwkWeekCache.has(key)) {
    // 缓存里有：直接画，整个过程没有网络等待，也就不会闪
    bwkDaysData = bwkBuildDays(bwkWeekCache.get(key));
    bwkPaintGrid();
    bwkPrefetchNeighbors();
    return;
  }

  // 缓存里没有：先把这一周的骨架画出来（表格结构、日期、时间轴都在，格子暂时不可点），
  // 数据回来再原地换成真实忙闲，表格不会消失也不会跳
  bwkDaysData = bwkBuildDays(null);
  bwkPaintGrid();
  try {
    const rows = await bwkLoadWeek(bwkAnchor);
    if (bwkAnchor.getTime() !== key) return; // 用户已经翻到别的周了，这次结果直接丢掉
    bwkDaysData = bwkBuildDays(rows);
    bwkPaintGrid();
    bwkPrefetchNeighbors();
  } catch (e) {
    if (bwkAnchor.getTime() !== key) return;
    wrap.innerHTML = '<div class="bwk-loading">查询失败，请稍后重试，或直接在备注里说明期望时间</div>';
  }
}

// 纯画图，不查数据库——用 bwkDaysData 里已经算好的忙闲状态，配合当前选择状态
// （bwkDrag 正在拖 / bwkSelected 已经选定）画出预选框
function bwkPaintGrid() {
  const wrap = document.getElementById('bwkGrid');
  const days = bwkDaysData;

  // DOM 结构：七天各自一列，flex 分列（后台是 .cal-week-timecol + .cal-week-days >
  // .cal-week-daycol，这里砍掉了左边那根时间轴列——客人不写备忘录、不用对着时间轴读行程，
  // 时间直接印在每个能约的格子里，省下的宽度分给七天）。
  // ⚠️ 仍然不能改用 CSS Grid 平铺格子：表头 .bwk-col-head 的 position:sticky 会失效
  // （grid 子项的包含块是它自己那一格，没有可以"吸"的余量），纵向一滚"星期几"就跑没了。
  const daysHtml = days.map(d => {
    const y = d.date.getFullYear(), m = d.date.getMonth(), dd = d.date.getDate();
    // 先算这一天有没有正在拖的预选／已经选定的时间段——被选中盖住的格子不再印时间，
    // 那个框上已经写了开始时间、结束时间和总时长，格子里再逐格印一遍会糊成一片
    const drag = bwkDrag && bwkDrag.dragging && bwkSameDay(bwkDrag, y, m, dd)
      ? { s0: Math.min(bwkDrag.anchor, bwkDrag.cur), s1: Math.max(bwkDrag.anchor, bwkDrag.cur) + 1, done: false }
      : (bwkSelected && bwkSameDay(bwkSelected, y, m, dd)
        ? { s0: bwkSelected.startSlot, s1: bwkSelected.endSlot, done: true } : null);

    let cellsHtml = `<div class="bwk-col-head${d.isToday ? ' today' : ''}"><span>星期${d.weekday}</span><b>${m + 1}/${dd}</b></div>`;
    for (let k = BOOKING_BUSINESS_START_SLOT; k < BOOKING_BUSINESS_END_SLOT; k++) {
      const isHour = k % 2 === 0;
      // 时间印在格子里，格式跟原来那根时间轴一模一样（早上/上午/中午/下午/晚上 + 12 小时制，
      // 跟后台 periodWordForHour 同一套），只是颜色淡成灰的，不跟"哪里能点"抢注意力
      const tp = bwkFormatSlotParts(k);
      const timeHtml = `<span class="bwk-cell-time">${tp.period}${tp.time}</span>`;
      if (d.busy[k]) {
        // 已经确定不能约的格子不写时间（写了也点不了，只是噪音），整段上面统一盖一个
        // "已约满"／"已过"。但 reason 还是空的意味着数据没回来、还不知道能不能约——
        // 那种情况照样把时间印出来，表格一开始就是完整的样子，等数据到了只是"哪几格
        // 能点"变一下，不会有一片文字凭空长出来（不许再犯.md 第 1 条）
        cellsHtml += `<div class="bwk-cell busy${isHour ? ' hour-start' : ''}">${d.reason[k] ? '' : timeHtml}</div>`;
        continue;
      }
      const masked = drag && k >= drag.s0 && k < drag.s1 ? ' masked' : '';
      cellsHtml += `<div class="bwk-cell open${isHour ? ' hour-start' : ''}${masked}" data-slot="${k}">${timeHtml}</div>`;
    }
    // 数据还在路上时 reason 全是空的（见 bwkBuildDays），这里自然一个标也不画
    const blockedHtml = bwkBlockedRuns(d).map(bwkBlockedTagHtml).join('');
    const selBoxHtml = drag ? bwkSelBoxHtml(drag.s0, drag.s1, drag.done) : '';
    return `<div class="bwk-day-col${d.isToday ? ' today' : ''}${d.loading ? ' loading' : ''}" style="--col-tint:${d.colTint}" data-y="${y}" data-m="${m}" data-d="${dd}">${cellsHtml}${blockedHtml}${selBoxHtml}</div>`;
  }).join('');

  // 重画（比如点了起点要高亮）会把整块 HTML 换掉，滚动位置会跟着归零——先记下来再还原，
  // 不然点一下格子表格就"跳"回最上面/最左边，正在挑时间的人要重新滚回去找
  const prevWrap = wrap.querySelector('.bwk-table-wrap');
  const keepTop = prevWrap ? prevWrap.scrollTop : null;
  const keepLeft = prevWrap ? prevWrap.scrollLeft : null;

  wrap.innerHTML = `<div class="bwk-table-wrap"><div class="bwk-table"><div class="bwk-days">${daysHtml}</div></div></div>`;

  const tableWrap = wrap.querySelector('.bwk-table-wrap');
  // 拖拽的起手式挂在整张表上（事件委托），重画之后不用一个个格子重新绑
  const daysEl = tableWrap.querySelector('.bwk-days');
  daysEl.addEventListener('mousedown', bwkDragStart);
  daysEl.addEventListener('touchstart', bwkDragStart, { passive: true });

  if (keepTop !== null) {
    tableWrap.scrollTop = keepTop;
    tableWrap.scrollLeft = keepLeft;
  } else {
    // 头一次画这一周：第一栏本来就是今天（过去的日子整栏都没画，见 bwkBuildDays），
    // 所以直接停在最左边就行，不用再去找"今天"是第几栏往那儿滚
    tableWrap.scrollLeft = 0;
  }
}

function bwkFindDay(y, m, d) {
  return bwkDaysData.find(dd => dd.date.getFullYear() === y && dd.date.getMonth() === m && dd.date.getDate() === d);
}
function bwkSameDay(o, y, m, d) { return o.y === y && o.m === m && o.d === d; }

// 拖拽/选中变化时只动"选框"这一个元素，不重画整张表——拖的时候每移动一格就重建整棵 DOM
// 会明显发顿，滚动位置也要来回还原（见 不许再犯.md 第 1 条）
function bwkUpdateSelBox() {
  document.querySelectorAll('.bwk-selbox').forEach(el => el.remove());
  // 上一次被选框盖住、藏起了时间文字的格子先还原（数量就是上次选了几格，很少，
  // 不是遍历整张表重建）
  document.querySelectorAll('.bwk-cell.masked').forEach(el => el.classList.remove('masked'));
  let sel = null;
  if (bwkDrag && bwkDrag.dragging) {
    sel = { y: bwkDrag.y, m: bwkDrag.m, d: bwkDrag.d, done: false,
      s0: Math.min(bwkDrag.anchor, bwkDrag.cur), s1: Math.max(bwkDrag.anchor, bwkDrag.cur) + 1 };
  } else if (bwkSelected) {
    sel = { y: bwkSelected.y, m: bwkSelected.m, d: bwkSelected.d, done: true,
      s0: bwkSelected.startSlot, s1: bwkSelected.endSlot };
  }
  if (!sel) return;
  const col = document.querySelector(`.bwk-day-col[data-y="${sel.y}"][data-m="${sel.m}"][data-d="${sel.d}"]`);
  if (!col) return;
  col.insertAdjacentHTML('beforeend', bwkSelBoxHtml(sel.s0, sel.s1, sel.done));
  // 选中范围内的格子藏掉各自的时间文字：这一段的时间信息由选框上的
  // "开始时间 / 时长 / 结束时间"三个标负责，格子里再逐格印一遍会跟它叠在一起看不清
  for (let k = sel.s0; k < sel.s1; k++) {
    const cell = col.querySelector(`.bwk-cell[data-slot="${k}"]`);
    if (cell) cell.classList.add('masked');
  }
}

// 拖出来的预选框 / 选定后的时间段：上贴开始时间、下贴结束时间，中间够高就写时长，
// 跟后台拖拽预选新行程时那个框长一样
function bwkSelBoxHtml(s0, s1, done) {
  const top = BWK_HEAD_H + (s0 - BOOKING_BUSINESS_START_SLOT) * BWK_SLOT_H;
  const height = (s1 - s0) * BWK_SLOT_H;
  // 两个时间标各占 15px（10px 字 × line-height 1.5）、时长标约 12px、上下内边距 4px：
  // 48px（选了 1 小时）就装得下三样，24px（只选了半小时）连两个时间标都放不下——
  // 硬塞会被 overflow:hidden 从中间裁掉半行，那种情况只写开始时间，
  // 完整的"起-止 · 共多久"由表格下面那行"已选：…"负责交代
  const durHtml = height >= 48 ? `<span class="bwk-selbox-duration">${bwkFormatDuration(s0, s1)}</span>` : '';
  const endHtml = height >= 48 ? `<span class="bwk-selbox-label">${bwkFormatSlot(s1)}</span>` : '';
  return `<div class="bwk-selbox${done ? ' done' : ''}" style="top:${top}px;height:${height}px">` +
    `<span class="bwk-selbox-label">${bwkFormatSlot(s0)}</span>${durHtml}${endHtml}</div>`;
}

// 半小时的整数倍：0.5 说成"30分钟"更顺口，其余照旧"1小时"/"1.5小时"
function bwkFormatDuration(s0, s1) {
  const hours = (s1 - s0) * 0.5;
  return hours < 1 ? '30分钟' : `${hours}小时`;
}

// ── 拖拽选时间段（跟后台周视图一样的手势）──
// 鼠标：按下即开始拖。手机：先按住不动一小会儿才进入拖拽，免得跟上下滑页面的手势打架
// （后台 calWeekDragStart 也是这个思路）。没拖动直接松手 = 只选这半小时。
let bwkDrag = null;
const BWK_LONG_PRESS_MS = 260;

function bwkPointerXY(evt) {
  const t = evt.touches && evt.touches[0];
  return t ? { x: t.clientX, y: t.clientY } : { x: evt.clientX, y: evt.clientY };
}

// 根据手指/鼠标的纵向位置，算出落在这一天的第几个半小时格；再夹到"从起点开始连续空着"
// 的范围内——中间碰到被占用的格子就停在那儿，不能跨过去选
function bwkSlotFromY(dayEl, clientY, anchor, dayData) {
  const rect = dayEl.getBoundingClientRect();
  const offsetY = clientY - rect.top - BWK_HEAD_H;
  let slot = BOOKING_BUSINESS_START_SLOT + Math.floor(offsetY / BWK_SLOT_H);
  slot = Math.max(BOOKING_BUSINESS_START_SLOT, Math.min(BOOKING_BUSINESS_END_SLOT - 1, slot));
  const step = slot >= anchor ? 1 : -1;
  for (let i = anchor; ; i += step) {
    if (dayData.busy[i]) return i - step;
    if (i === slot) return slot;
  }
}

function bwkDragStart(evt) {
  const cell = evt.target.closest('.bwk-cell.open');
  if (!cell) return;
  const dayEl = cell.closest('.bwk-day-col');
  const y = Number(dayEl.dataset.y), m = Number(dayEl.dataset.m), d = Number(dayEl.dataset.d);
  const slot = Number(cell.dataset.slot);
  const dayData = bwkFindDay(y, m, d);
  if (!dayData) return;

  bwkDrag = { y, m, d, dayEl, dayData, anchor: slot, cur: slot, dragging: false, moved: false };

  if (evt.type === 'mousedown') {
    if (evt.button !== 0) return;
    evt.preventDefault();
    bwkDrag.dragging = true;
    bwkSelected = null;
    bwkUpdateSelBox();
    document.addEventListener('mousemove', bwkDragMove);
    document.addEventListener('mouseup', bwkDragEnd);
    return;
  }
  // 触摸：先记下按下的位置，按住不动够久才真正进入拖拽（期间手指大幅移动就取消，
  // 让浏览器照常上下滚动看时间）
  const p = bwkPointerXY(evt);
  bwkDrag.startX = p.x; bwkDrag.startY = p.y;
  bwkDrag.timer = setTimeout(() => {
    if (!bwkDrag) return;
    bwkDrag.dragging = true;
    bwkSelected = null;
    bwkUpdateSelBox();
  }, BWK_LONG_PRESS_MS);
  document.addEventListener('touchmove', bwkDragMove, { passive: false });
  document.addEventListener('touchend', bwkDragEnd);
  document.addEventListener('touchcancel', bwkDragEnd);
}

function bwkDragMove(evt) {
  if (!bwkDrag) return;
  const p = bwkPointerXY(evt);
  if (!bwkDrag.dragging) {
    // 还没进入拖拽（手机长按判定中）：手指挪动超过一点点就放弃，让页面正常滚动
    if (Math.abs(p.y - bwkDrag.startY) > 10 || Math.abs(p.x - bwkDrag.startX) > 10) {
      clearTimeout(bwkDrag.timer);
      bwkCleanupDrag();
    }
    return;
  }
  evt.preventDefault();
  // ⚠️ 每次都重新查一遍这一列的元素：拖拽过程中每动一格就会重画整张表，
  // 一开始记下来的那个 dayEl 早就被换掉了（detached 元素的 getBoundingClientRect
  // 全是 0，算出来的格子会离谱地跑到最底下）
  const dayEl = document.querySelector(`.bwk-day-col[data-y="${bwkDrag.y}"][data-m="${bwkDrag.m}"][data-d="${bwkDrag.d}"]`);
  if (!dayEl) return;
  const next = bwkSlotFromY(dayEl, p.y, bwkDrag.anchor, bwkDrag.dayData);
  if (next !== bwkDrag.cur) { bwkDrag.cur = next; bwkDrag.moved = true; bwkUpdateSelBox(); }
}

function bwkDragEnd() {
  if (!bwkDrag) return;
  clearTimeout(bwkDrag.timer);
  const { y, m, d, anchor, cur, dragging } = bwkDrag;
  const wasDragging = dragging;
  bwkCleanupDrag();
  if (!wasDragging) { // 手机上轻轻一点没长按：也当成选这半小时
    bwkFinalize(y, m, d, anchor, anchor + 1);
    return;
  }
  bwkFinalize(y, m, d, Math.min(anchor, cur), Math.max(anchor, cur) + 1);
}

function bwkCleanupDrag() {
  bwkDrag = null;
  document.removeEventListener('mousemove', bwkDragMove);
  document.removeEventListener('mouseup', bwkDragEnd);
  document.removeEventListener('touchmove', bwkDragMove);
  document.removeEventListener('touchend', bwkDragEnd);
  document.removeEventListener('touchcancel', bwkDragEnd);
}

function bwkFinalize(y, m, d, startSlot, endSlot) {
  bwkSelected = { y, m, d, startSlot, endSlot };
  const dateLabel = `${m + 1}月${d}日 周${BWK_WEEKDAYS[(new Date(y, m, d).getDay() + 6) % 7]}`;
  const label = `${bwkFormatSlot(startSlot)}-${bwkFormatSlot(endSlot)}`;
  document.getElementById('datetime').value = dateLabel;
  document.getElementById('slot').value = label;
  const selEl = document.getElementById('bwkSelectedLabel');
  // 这行永远写全"起-止 · 共多久"——选框太矮时框里只写得下开始时间，靠这行兜底
  selEl.textContent = `已选：${dateLabel} ${label} · 共 ${bwkFormatDuration(startSlot, endSlot)}`;
  selEl.classList.add('picked');
  bwkUpdateSelBox();
}

function resetBwkPicker() {
  bwkSelected = null;
  bwkAnchor = bwkDayStart(shopNow());
  document.getElementById('datetime').value = '';
  document.getElementById('slot').value = '';
  const selEl = document.getElementById('bwkSelectedLabel');
  selEl.textContent = '尚未选择时间';
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
