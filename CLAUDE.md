# 坐忘茗舍网站

静态 JAMstack 茶馆官网：`index.html`（前台）+ `script.js` + `styles.css` + `admin.html`（后台，内嵌样式脚本）。

## 硬性规则

- **改完代码直接 commit + push**，不用等用户确认——push 到 GitHub main 会自动部署到 https://zuowangmingshe.com，约 1 分钟生效。
- 改了 `script.js` 或 `styles.css` 后，`index.html` 里对应的 `?v=` 版本号要 +1（Cloudflare 缓存刷新）。
- 涉及移动端/小屏幕的改动，必须同时用手机宽度（如 390px）实测，不能只测桌面宽度。
- 所有操作默认流畅无卡顿：DOM 先更新、DB 后台保存，不让用户等网络；发现某个模式有问题要主动扫描所有同类地方一起改。
- 后台所有删除/替换图片的地方，都要清理 Supabase Storage 里的孤儿文件。

## 关键配置

- Supabase：`https://wmatsdnpbpcltuoynyrh.supabase.co`，publishable key `sb_publishable_gw7gfFtSHHJR6SbDUpCTwA_HNcktgEl`
- GitHub：https://github.com/Lilian3070/zuowang-teahouse
- 前端库（supabase-js、FullCalendar）已自托管在 `assets/vendor/`，不依赖 jsdelivr CDN——升级需要手动下载替换文件

## 完整功能清单 / 数据库结构 / 踩过的坑

看同目录下的 [HANDOFF.md](./HANDOFF.md)，每次重大节点更新。仓库有备份 git tag（`checkpoint-2026-08-28`、`checkpoint-2026-08-29`），出问题可回滚。
