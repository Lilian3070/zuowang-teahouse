# 坐忘茗舍网站

静态 JAMstack 茶馆官网：`index.html`（前台）+ `script.js` + `styles.css` + `admin.html`（后台，内嵌样式脚本）。

## ⚠️ 开工第一件事（不许跳过）

动手写任何代码之前，**完整读这两份文件**（是整份读完，不是 `tail` 结尾几十行——
2026-09-04 就因为只读了后 150 行、漏掉前面写着的缓存约定，白排查了半天）：

1. **[不许再犯.md](./不许再犯.md)** —— 已经犯过、被主理人当场指出的错误清单。
   重复犯同一个错比犯新错更不能接受。犯了新的重复性问题，当场往这个文件里加一条。
2. **[HANDOFF.md](./HANDOFF.md)** —— 完整功能清单、数据库结构、每个功能当初为什么这么做、
   踩过的坑。开头有"开新对话先看这里"一节，是最近一次收工时的状态。

## 硬性规则

- **改完代码直接 commit + push**，不用等用户确认——push 到 GitHub main 会自动部署到
  https://zuowangmingshe.com，约 1 分钟生效。
- 改了 `script.js` 或 `styles.css` 后，`index.html` 里对应的 `?v=` 版本号要 +1（缓存刷新）。
  提交前 `grep "?v=" index.html` 对一眼。
- **同一个界面里的操作不许整块重刷/闪一下**，也不许点了半天没反应。数据没回来之前保留原有结构，
  能缓存的缓存、能预取的预取，高频交互只改必要的 DOM 节点。（不许再犯.md 第 1 条）
- **做新功能前，先看站内有没有现成的一套可以照搬**——尤其"给客人看简化版的某个后台功能"这类需求，
  直接把后台对应实现的**参数**（颜色/尺寸/字号/间距/交互）抄过来，不要凭印象做个"像的"。
  （不许再犯.md 第 3 条）
- 任何 `db.from(...).insert/update/delete(...)` 之后，**先判断 `error` 再提示成功**。
- 用户输入/确认一律用站内 modal，不用原生 `confirm`/`alert`/`prompt`；日期时间一律用站内自制
  选择器，不用原生 `<input type="date|time|datetime-local">`。
- 涉及移动端的改动，必须用手机宽度（如 390px）实测，不能只测桌面。
- 后台所有删除/替换图片的地方，都要清理 Supabase Storage 里的孤儿文件。
- 一条消息里提了几件事，就要几件都做完再回话。

## 关键配置

- Supabase：`https://wmatsdnpbpcltuoynyrh.supabase.co`，publishable key
  `sb_publishable_gw7gfFtSHHJR6SbDUpCTwA_HNcktgEl`
- GitHub：https://github.com/Lilian3070/zuowang-teahouse
- 前端库（supabase-js、lunar.js）已自托管在 `assets/vendor/`，不依赖 CDN——升级要手动换文件
- **`supabase/*.sql` 现网全部已经跑过**，日常开发不需要跑任何 SQL；那些文件只在"从零重建数据库"
  时按顺序重跑。只有当**新加字段/函数**时，才需要把新 SQL 贴给主理人跑一次
- 出问题可回滚：`git tag` 看备份点，最新是 `checkpoint-2026-09-04-b`
