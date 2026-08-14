# Anima 绘师画廊（Anima Artist Gallery）

基于 Anima2B 模型 **59,676 位画师**名单的在线绘师画廊。核心功能：

- 🔍 **画师搜索**（自动联想）+ **标签反查画师**（Gelbooru 预抓索引）
- 🖼️ **作品预览**：Gelbooru 主索引 + Danbooru 在线预览（本地版）
- 🔗 一键跳转 Danbooru / Gelbooru 的对应标签页
- ⧉ 复制 Anima 调用 id（含 `@` 前缀和转义符，原样不变）
- ⭐ 收藏 / 多选 / 灯箱缩放 / 9 种排序
- 🔞 成人内容开关（网页版）

## 🌐 在线体验（无需安装）

**在线完整版**：https://anima-gallery.pages.dev —— Cloudflare 免费部署，带作品预览图（仅 Gelbooru 数据源），需在设置里填自己的 Gelbooru API Key。

## 快速开始（本地运行）

1. **装好 Python 3.10+**（[python.org](https://www.python.org/downloads/)）
2. 首次运行安装依赖：

   ```bash
   pip install httpx curl_cffi
   ```

3. **双击 `start.bat`** 启动，浏览器自动打开 `http://127.0.0.1:8765/`
4. 点右上角 **⚙ 设置**，填**你自己的** API Key：
   - **Gelbooru API Key + User ID**：必填（[获取](https://gelbooru.com/index.php?page=account&s=home)，登录后进 Options 查看）
   - **Danbooru 用户名 + API Key**：可选（[获取](https://danbooru.donmai.us/profile)，登录后点 API Key 的 View）
   - 保存后自动刷新

> ⚠️ **API Key 只保存在你自己的浏览器里**，服务器不内置任何 key。请勿把 key 分享给他人。

## 在线部署（Cloudflare Pages，免费）

前端带 `/proxy`（图片代理）和 `/api/posts`（API 代理）两个 Cloudflare Pages Functions，可免费部署到 Cloudflare Pages：

```bash
npm i -g wrangler
wrangler login
wrangler pages project create anima-gallery --production-branch main
wrangler pages deploy site --project-name anima-gallery   # 部署纯前端
wrangler pages deploy . --project-name anima-gallery      # 部署前端 + Functions（需把 functions/ 放到根目录）
```

在线版只支持 Gelbooru 数据源（Danbooru 在线被 Cloudflare 防护拦截，本地版可用）。

## 项目结构

```
├── server.py            # 本地画廊服务器（图片/API 代理 + 磁盘缓存 + 多端口提速）
├── start.bat            # 一键启动
├── site/                # 前端（纯 HTML/CSS/JS，无框架）
│   ├── index.html / app.js / style.css
│   ├── artists-data.json   # 59,676 位画师数据
│   └── index-*.json        # 标签索引分片（28 个，搜索/标签反查用）
├── fetch-gelbooru.mjs   # Gelbooru 数据抓取脚本（需填自己的 key）
├── fetch-danbooru.mjs   # Danbooru 数据抓取脚本（需填自己的 key）
├── merge-index.mjs      # 合并抓取数据 → 标签索引（在线分片版）
├── build-full-index.mjs # 构建本地满血索引（139MB 单文件，本地加载，标签反查覆盖最全）
├── parse-artists.mjs    # 画师名单解析（Anima 调用 id + 别名映射）
├── split-index.mjs      # 标签索引分片（在线部署用）
├── artists.txt          # Anima 画师名单（59,676 位）
└── alias-map*.json      # 别名映射（Danbooru 别名检测结果）
```

## 数据说明

- 索引基于 Gelbooru 公开 API 预抓（标签-画师对 292 万条），仅供个人学习使用
- 画师作品数/热度为抓取时快照，非实时

## 免责声明

项目仅供学习交流。请遵守 Danbooru / Gelbooru 的使用条款与限流规则，不要高频抓取。
