# 坐忘茗舍网站 · 交接文档

最后更新：2026-08-30
备份检查点（可回滚）：`checkpoint-2026-08-30`（回滚命令见文末）

## 基本信息

- 本地代码：`C:\Users\xianl\Desktop\Lilian\坐忘茗舍网站\`
- GitHub：https://github.com/Lilian3070/zuowang-teahouse
- **正式网址：https://zuowangmingshe.com**（Cloudflare CDN + GitHub Pages）
- 后台地址：https://zuowangmingshe.com/admin.html
- 部署方式：push 到 GitHub main 分支，约 1 分钟内自动生效
- Cloudflare Page Rule：`*zuowangmingshe.com/*.html` → Cache Level Bypass（HTML 不缓存）

## 技术架构

纯静态 JAMstack：`index.html`（前台）+ `script.js` + `styles.css` + `admin.html`（后台，内嵌样式和脚本）

数据库：Supabase，Project URL `https://wmatsdnpbpcltuoynyrh.supabase.co`，Publishable key `sb_publishable_gw7gfFtSHHJR6SbDUpCTwA_HNcktgEl`，区域 Southeast Asia (Singapore)。

**前端库不再依赖 jsdelivr CDN**（国内偶尔连不上/慢，一旦失败前台商品和后台会整体失效），全部自托管在 `assets/vendor/`：
- `supabase-js@2.112.4.min.js`（index.html + admin.html 共用）
- `fullcalendar@6.1.15.global.min.js`（admin.html 日程日历）
- `fullcalendar-locale-zh-cn@6.1.15.global.min.js`（原来引用的 `locales-all.global.min.js` 在该版本包里根本不存在、一直 404，日历中文语言包从未生效；已换成真实存在的路径）
- **以后升级这几个库需要手动下载替换文件**，不会像 CDN 那样自动跟最新版

**CSS/JS 缓存刷新**：每次改 `script.js` 或 `styles.css` 后，把 `index.html` 里对应的 `?v=` 版本号 +1。当前：`styles.css?v=22`、`script.js?v=13`。

## 数据库表结构

### categories
`id, type(tea/teaware/guqin), key, name, description, cover_url, sort_order, is_visible`

分类 key 对照：
- tea：zhengshantang(正山堂·骏眉中国) / hexingyan(和星岩) / pinguvillage(品古村)
- teaware：zhuchaqi(泡茶主器) / pinmingbei(品茗杯盏) / chaxiyashe(茶席雅设) / mingyao(名窑匠作)
- guqin：chuxian(初弦) / miaoyin(妙音) / cangfeng(藏锋) / xiexing(携行)

### products
`id, category_key(字符串，对应上表 key，不是 UUID), name, description, price, image_url, detail_images(text[]，商品详情图片数组), is_visible, sort_order, created_at`

### posters
`id, section(qindao/yaji), title(显示文字，选填), image_url, is_visible, sort_order, created_at`

## 已完成功能

### 前台（index.html + script.js + styles.css）
- 精选茗茶 / 茶器美学 / 斫琴甄选三个板块从 Supabase 动态读取分类和商品，隐藏分类不显示
- 商品弹窗预缓存全部商品，点击秒开；商品"查看详情"弹出图片画廊（主图+详情图，缩略图/左右箭头/键盘切换）
- 移动端（≤860px）分类/海报用横向轮播展示，首次加载即生效（不用等用户手动触发一次 resize）；轮播启动后 0.9 秒就开始第一次切换，不会让人误以为只有一个分类
- 海报板块（琴道传习/坐忘雅集）横排展示，卡片数量少时居中，多到装不下时轮播
- 顶部导航栏**全部 8 个菜单项都有子菜单**：
  - 精选茗茶/茶器美学/斫琴甄选：子菜单内容跟分类数据同源，后台改分类会自动同步
  - 琴道传习/坐忘雅集：子菜单用每张海报的"显示文字"，没填文字的海报不出现
  - 茶席预约/坐忘故事/寻访茗舍：固定文字子菜单，跳转到板块内对应的小节（用 `scroll-margin-top` 避免被固定导航栏挡住）
  - 桌面端鼠标悬停展开下拉；移动端点主菜单名字本身展开/收起（不跳转），同一时间只展开一个，其他主菜单项自动顺延；子菜单里的具体项目才会真正跳转/弹出详情框
  - 点品牌/分类子项：跳转 + 直接弹出该项详情框；点海报/预约/故事/联系方式子项：直接跳转到对应位置（没有单独详情弹窗）
- 数据请求失败自动重试（最多 2 次，间隔 0.8 秒），避免手机网络抖动导致某个板块内容永久空白
- 首页大图（logo/店铺印章/联系方式图标）按实际显示尺寸压缩，省了约 2.1MB 首屏体积
- 商品详情弹窗（点分类卡片弹出的那个）在"一排天生只能放下 1 个商品"的窄屏下（用 `modalProducts.clientWidth` 按 `auto-fill, minmax(200px,...)` 的公式反算，不是写死的媒体查询断点），标题下方会出现一个每排显示几个的切换控件：三个空心方框图标（1 个方框 / 2x2 四宫格 / 3x3 九宫格，不写文字，靠图标本身表达，市面上常见的宫格视图切换样式），选中态高亮；方便小屏幕用户一次多看几件商品再点进详情。电脑/平板宽度只要天生能放下 2 个以上就不会出现这个控件，也不受影响。选择会记到 `localStorage`（key: `modalGridCols`），下次打开任何分类都记得上次选的排列方式

### 后台（admin.html）
- 登录/退出、修改密码
- 商品 CRUD，图片 canvas 压缩（最大 1200px，quality 0.82）上传 Supabase Storage
- 商品主图带裁剪框（4:3，跟前台卡片比例一致）：可拖动改变显示区域、滚轮/滑块缩放，不强制居中，保存时才把当前裁剪结果烘焙成一张图上传；只有真正动过图片（选新图/拖动/缩放）才会重新生成上传，没碰过就沿用原图，不会白白产生新文件。编辑老商品时，就算是历史上传的旧图（不是当初裁剪出来的）也能直接在这个框里重新调整
- 后台商品列表缩略图改成 4:3（跟前台卡片、裁剪框比例一致，之前是 1:1 方形裁切，跟前台实际显示不一样，看不出图片有没有裁歪/裁漏）
- 保存商品（新增/编辑）后不再整体刷新列表：只原地替换/插入被改动的那一行，其余行的 DOM 节点原样不动，不会有整页闪一下的感觉；如果编辑时把分类改到当前筛选范围之外，那一行会从视图里移除（数据本身还在缓存里，切换筛选能看到）
- 保存商品彻底改成"界面立刻乐观更新 + 图片上传/数据库写入放到后台"：点保存后弹窗立刻关闭、列表立刻显示新内容（图片用本地裁剪好的预览，不用等 Supabase 上传），网络操作在后台默默完成，成功了才把预览图换成真实链接、清理旧文件；失败了会弹提示并把界面改回原样（新增的会把那一行整个撤掉）。彻底解决了"点保存要等一两秒才关窗口"的卡顿感
- 上面这个后台流程里，正式图片链接生成后不会立刻塞进 `<img src>`，而是先用一个隐藏的 `Image()` 把它预加载/解码完，再去替换列表里的那一行——这样切换到真实链接的瞬间浏览器已经有缓存了，不会看到"缩略图慢慢加载出来"的效果
- 商品详情图片：可加多张、随时增删，保存时才真正上传
- 图片上传区支持真正的文件夹拖拽（之前文字写了但没接线）
- 图片替换/删除时清理 Storage 孤儿文件（商品主图、详情图、分类封面图、海报）
- 分类管理：CRUD、排序、显示隐藏，切换 tab 时正确收起/刷新（之前有 CSS 选择器碰撞导致的旧数据残留 bug，已修）
- 商品编辑弹窗去掉了多余的"显示此商品"勾选框（显示/隐藏已由列表按钮控制，编辑保存不再覆盖该状态）
- 会员管理：琴人档案（课时套餐）、茗客档案（消费记录）
- 行程安排：FullCalendar 日历（中文语言包已修好）
- 移动端小屏幕下菜单栏改为横向换行排列，不再竖排占位；顶栏用回真实类名，紧凑显示

## 踩过的坑（给以后的自己提个醒）

**`.nav ul` 选择器碰撞**：写导航子菜单时，`.submenu` 本身也是个 `<ul>`，会被 `.nav ul` 这条通用规则的**每一条属性**顶替（display、position、transform、max-height 都中过招）。教训：给一个新组件加样式时，如果它的标签名/结构会被某条更早、更宽泛的选择器意外匹配到，不要一条属性一条属性地打补丁，而是一次性用更高优先级的选择器（比如 `.nav .submenu`）把这个组件需要的所有属性都接管过来。

**删除按钮曾经"先删存储、不管数据库是否删成功"**：`deleteProduct`/`deletePoster` 原来没检查 `db.from(...).delete()` 的 `error`，一旦数据库删除失败（网络抖动、权限问题），还是会往下执行把 Supabase Storage 里的图片删掉——结果是数据库里那条记录还在，但图片没了，前台会看到裂图。已修复：两处都改成先判断 `error`，删除失败就直接提示并 return，不再动 Storage。`deleteCat` 从一开始就有这个判断，是对的写法，以后任何新增的"删记录+删图片"逻辑都要照这个顺序写。

**商品图片裁剪框在 canvas 上重新画已上传到 Supabase 的图不会 "tainted canvas"**：本来担心跨域图片（Storage 公开 URL 跟站点不同源）画到 canvas 上再 `toBlob` 会被浏览器当成"污染画布"直接报错，实测只要给 `<img>` 元素设置 `crossOrigin = "anonymous"`（在赋值 `src` 之前），Supabase Storage 的公开 URL 默认就带了正确的 CORS 头，能正常读出像素、正常导出。这也是"编辑老商品时能对着历史图片重新裁剪"这个功能能做的前提——以后如果哪天要对着任何 Supabase Storage 的图片做 canvas 处理（滤镜、水印之类），记得先加这行，別的什么都不用配置。

### 会员/管理员账号体系（2026-08-30 新增，⚠️ 上线前必须先跑一次 SQL）

- 数据库新增 `profiles`（角色：admin/member，member 关联到 members 表）、`invite_codes`（一次性会员注册密钥）两张表，
  以及 `is_admin()` / `redeem_invite_code()` 两个函数，SQL 见 [supabase/member_system.sql](supabase/member_system.sql)
- **部署后必须去 Supabase 后台 SQL Editor 手动执行这个文件一次**（把文件末尾的邮箱占位符换成实际管理员邮箱），
  在执行之前 admin.html 的登录会因为查不到 `profiles` 表而把任何人都当成"非管理员"登出——这是预期行为，跑完 SQL 就正常了
- 首页导航栏最右侧新增"登录"入口（未登录显示"登录"，登录后按角色显示"进入后台"或"会员中心"）；点开是登录/会员注册两个 tab
- 会员注册走密钥制：后台「琴人档案/茗客档案」→ 点进某个会员详情 → "生成一次性登录密钥"，密钥给到本人，在首页"会员注册"里填密钥+邮箱+密码换取会员身份，一码只能用一次
- admin.html 顶部新增"返回主页"按钮；登录时会校验 `profiles.role`，不是 admin 会被强制登出
- 新增 [member.html](member.html) 会员中心：登录后能看自己的课时套餐余额、消费记录（目前只读，还没有提交预约申请的功能）
- 登录/注册**支持邮箱或手机号二选一**，前端按有没有 "@" 自动判断；手机号在 Supabase 内部会包装成
  `<手机号>@member.zuowangmingshe.local` 这样一个假邮箱存进去，纯粹是技术兼容手段，客人完全无感，
  自始至终看到的都是"手机号 + 密码"。⚠️ 因为这个假邮箱收不到确认邮件，**Supabase 后台
  Authentication → Providers → Email → "Confirm email" 必须关闭**，否则手机号注册的账号会卡在
  "未激活"状态永远进不去（这个开关关掉是合理的——反正注册本来就靠密钥线下核实身份，邮箱确认是多余的一层）
- **忘记密码**：不走邮箱/短信（手机号账号的假邮箱收不到信），而是复用跟注册密钥一样的模式——后台
  会员详情新增"生成密码重置密钥"，客人拿密钥去首页"忘记密码"直接设新密码。原理是
  `reset_password_with_code()` 函数直接改 `auth.users.encrypted_password`（用 pgcrypto 的
  `crypt()`/`gen_salt('bf')`，跟 Supabase/GoTrue 用的是同一套 bcrypt 加密方式），不需要旧密码，
  也不需要主理人能看到密码本身（密码全程只有加密后的哈希值落库，包括管理员在内谁都读不出明文，
  这是正常且安全的设计，不是功能缺失）
- 后台会员详情"会员账号"区块现在会显示这个会员登录用的是哪个邮箱/手机号（`profiles.login_account`
  字段，注册时客人填的原文），方便客人忘记自己当初注册用的是哪个时，主理人能在后台查到告诉她
- **有意暂缓的部分**：会员中心目前不含"提交预约申请"，因为首页已有的"茶席预约 · 知音通道"原型（[index.html:135](index.html#L135)，手机号验证目前是前端假数据）以后要跟这套账号体系合并，但那个模块的设计还没定，先各自占位，改动的时候一起改

## 待做事项

- [ ] 前台网页整体布局和设计（持续渐进调整）
- [ ] 知音通道预约原型跟新会员体系合并，设计方案还没定
- [ ] 会员分级：以后会加"线上购物会员"（不来店，直接网上买茶买茶具，主理人邮寄），跟现在的"线下学员/客人会员"权限不同。
      `profiles.member_type` 字段已经预留了口子，加新类型是加字段允许值，不影响已有数据，不用推倒重来
- [ ] 后台与前台无缝衔接：管理员身份下能直接在主页和后台之间切换（这次已经加了"返回主页"按钮，双向跳转基本打通了，
      后面主要是看还有没有细节要补）

主理人已有管理员账号，可自己管理茶器等分类的商品（含删除），不需要保留测试商品。

## 备份与回滚

每个阶段性节点都打了 git tag，出问题可以直接回滚：

```bash
git tag                          # 查看所有备份点
git checkout checkpoint-2026-08-29   # 回滚到这次的备份点（会进入 detached HEAD，确认要用再合并/新建分支）
```

已有备份点：`checkpoint-2026-08-28`、`checkpoint-2026-08-29`、`checkpoint-2026-08-30`
