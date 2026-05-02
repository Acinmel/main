# SHUZIREN（数字人 / 口播重制）项目文档

本文档描述仓库**目录结构**与 **HTTP API 接口**（全局前缀均为 `/api`）。

---

## 目录

- [1. 项目概述](#1-项目概述)
- [2. 仓库目录结构](#2-仓库目录结构)
- [3. HTTP API 总览](#3-http-api-总览)
  - [3.1 根与探活](#31-根与探活)
  - [3.2 工具 Tools `v1/tools`](#32-工具-tools-v1tools)
  - [3.3 任务 Tasks `v1/tasks`](#33-任务-tasks-v1tasks)
  - [3.4 作品 Works `v1/works`](#34-作品-works-v1works)
- [4. 环境与部署索引](#4-环境与部署索引)
- [5. 本地开发：启动与重启](#5-本地开发启动与重启)

---

## 1. 项目概述

| 模块 | 技术栈 | 说明 |
|------|--------|------|
| **frontend** | Vue 3 + Vite + Naive UI + Pinia | 用户站点；开发时通过 Vite 将 `/api` 代理到后端 |
| **backend** | NestJS 11 | REST API；视频元信息、dy-downloader/yt-dlp、FFmpeg 抽轨、外部 ASR HTTP 转写等 |
| **deploy** | Nginx 配置、`compose.env` 示例 | 与根目录 `docker-compose.yml` 配合一体化部署 |

**线上一体化**：产品与场景说明见 [`DEPLOY.md`](./DEPLOY.md)；服务编排与镜像见 [`docker-compose.yml`](./docker-compose.yml)。

---

## 2. 仓库目录结构

```
shuziren/
├── DEPLOY.md                 # 产品功能、场景与价值（面向销售/客户）
├── SHUZIREN.md               # 本文件：目录与接口说明
├── docker-compose.yml        # web + api（+ compose 内 mysql）编排
├── yt-dlp-master/            # 可选：内置 yt-dlp 源码；Docker 镜像内 pip -e 安装，本地可不配 YTDLP_BIN 时用 Python 调用
├── .gitignore
├── deploy/
│   ├── compose.env.example   # Compose 可选环境变量示例
│   └── …
├── backend/                  # Nest 主后端
│   ├── DY-DOWNLOADER/        # 内嵌 [dy-downloader](https://github.com/Everless321/dyDownloader)；抖音拉流仅用此 + DY_DOWNLOADER_COOKIE（不走 yt-dlp）
│   ├── Dockerfile
│   ├── .env.example
│   ├── src/
│   │   ├── main.ts           # 入口；全局前缀 api
│   │   ├── app.module.ts
│   │   ├── app.controller.ts
│   │   ├── common/           # 抖音链接归一化、URL 安全等
│   │   ├── integrations/
│   │   │   ├── ai/           # 改写 / 千问 ASR / TTS 等
│   │   │   ├── video/        # video-meta、media-download（yt-dlp/HTML）
│   │   │   ├── transcription/ # 转写结果 DTO、进程内 TranscriptStore
│   │   └── modules/
│   │       ├── tasks/        # 任务域
│   │       ├── tools/        # 工具域（视频信息、转写）
│   │       └── works/        # 作品列表
│   └── package.json
├── frontend/                 # Vue 前端
│   ├── Dockerfile
│   ├── deploy/nginx-web.conf # 生产 Nginx：静态 + /api 反代
│   ├── vite.config.ts
│   └── src/
│       ├── api/              # Axios 封装、各模块请求
│       ├── views/            # 页面（含 HomeView）
│       ├── stores/           # Pinia（如 taskDraft）
│       ├── router/
│       ├── components/
│       └── types/
```

---

## 3. HTTP API 总览

**Base URL**

| 场景 | 浏览器访问的 API 根路径 |
|------|-------------------------|
| 本地开发（Vite） | 同域 `/api`（代理到 `http://localhost:3000/api`） |
| Docker（`web` 容器 Nginx） | 同域 `/api`（反代到 `api:3000/api`） |
| 前后端分离 | 构建时设置 `VITE_API_BASE_URL` 指向实际 API 根路径 |

以下路径均省略前缀 **`/api`**（即完整路径为 **`/api` + 下表路径**）。

---

### 3.1 根与探活

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/` | 根探活（返回简单字符串） |

---

### 3.2 工具 Tools `v1/tools`

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/v1/tools/asr-health` | 探测千问 ASR 配置是否完整 |
| `GET` | `/v1/tools/transcribe-pipeline-health` | 保存目录、FFmpeg、ASR、抖音 Cookie 一站式自检 |
| `GET` | `/v1/tools/transcripts/:transcriptId` | 取回主后端内存中已保存的一次转写结果 |
| `POST` | `/v1/tools/transcribe` | **multipart** 字段 `file`：上传音视频 → FFmpeg 预处理 → 千问3-ASR-Flash-Filetrans → 保存并返回 `transcriptId` 等 |
| `POST` | `/v1/tools/transcribe-url` | **JSON** `{ "sourceVideoUrl": "…" }`：下载链接媒体 → 千问 ASR 转写 → 保存并返回 |
| `POST` | `/v1/tools/douyin-transcribe-rewrite` | **JSON** `{ "sourceVideoUrl", "rewriteStyle?" }`：**仅抖音**；dy-downloader 拉流 → 千问 ASR 转写 → 改写 `suggest` |
| `POST` | `/v1/tools/transcript-preview` | **JSON** `{ "sourceVideoUrl": "…" }`：按 URL 调用千问 ASR 预览 |
| `POST` | `/v1/tools/video-meta` | **JSON** `{ "sourceVideoUrl": "…" }`：抓取作品页 HTML，解析标题/内容/封面等 |

**鉴权**：当前 Tools 路由**未强制** Bearer；生产可按需加守卫。

**相关环境变量（节选）**：`DASHSCOPE_API_KEY`、`DASHSCOPE_BASE_URL`、`QWEN_ASR_MODEL`、`YTDLP_BIN`、`DY_DOWNLOADER_COOKIE`、`VIDEO_MEDIA_MAX_BYTES` 等（详见 `backend/.env.example`）。

---

### 3.3 任务 Tasks `v1/tasks`

任务接口从请求头 **`Authorization: Bearer <token>`** 解析用户（`tasks.auth`）；无 token 时使用占位用户，便于联调。

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/v1/tasks` | 创建任务；Body：`{ sourceVideoUrl, initialTranscript? }` |
| `GET` | `/v1/tasks/:id` | 查询任务详情与状态 |
| `POST` | `/v1/tasks/:id/photo` | **multipart** 字段 `file`：上传口播形象照（≤8MB） |
| `POST` | `/v1/tasks/:id/extract` | 启动解析 / 模拟转写流水线 |
| `GET` | `/v1/tasks/:id/transcript` | 获取转写结果 |
| `GET` | `/v1/tasks/:id/result` | 获取成片与资源 URL |
| `POST` | `/v1/tasks/:id/rewrite/suggest` | 改写建议；Body：`{ style }` |
| `POST` | `/v1/tasks/:id/rewrite` | 提交改写文案 |
| `POST` | `/v1/tasks/:id/render` | 提交渲染配置；Body：`mode`、`aspect`、`voiceStyleId`、`subtitleStyleId` |
| `GET` | `/v1/tasks/:id/download/subtitle` | 下载字幕（SRT） |
| `GET` | `/v1/tasks/:id/download/script` | 下载口播文案文本 |

**推荐调用顺序**（与 `tasks.controller` 注释一致）：创建任务 → 上传照片 → `extract` → 轮询详情直至可拉 transcript → 可选改写 → `render` → 成功后再 `result` / 下载。

---

### 3.4 作品 Works `v1/works`

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/v1/works` | 我的作品列表（当前为内存/模拟数据形态，与任务模块演进相关） |

---

## 4. 环境与部署索引

| 文档 / 文件 | 用途 |
|-------------|------|
| [`DEPLOY.md`](./DEPLOY.md) | 产品功能、使用场景与交付说明（非技术运维手册） |
| [`docker-compose.yml`](./docker-compose.yml) | `web` / `api` / `mysql` 服务定义 |
| [`backend/.env.example`](./backend/.env.example) | 后端环境变量说明 |
| [`deploy/compose.env.example`](./deploy/compose.env.example) | Compose 层可选变量示例 |

---

## 5. 本地开发：启动与重启

| 服务 | 默认端口 | 说明 |
|------|----------|------|
| **前端**（Vite） | `5173`（被占用时会顺延，如 `5174`） | 浏览器访问控制台里打印的 Local URL；`/api` 代理到后端 |
| **后端**（Nest） | `3000` | 全局前缀 `/api`；改 **`backend/.env` 后必须重启** 才生效 |

**仓库根目录快捷命令**（需在仓库根执行）：

```bash
npm run dev:frontend    # 前端开发
npm run dev:backend     # 后端 watch 模式
```

**重启**：在对应终端按 **Ctrl+C** 结束进程，再执行上表同一命令。**修改 `backend/.env`（含 ASR、抖音 Cookie、体积上限等）后，只需重启后端**；前端一般无需重启，除非改了 `frontend` 依赖或 `vite.config.ts`。

**推荐开发时开 2 个终端**：后端 → 前端（先起后端可避免 Vite 代理短暂连不上）。

---

*文档生成依据当前仓库代码结构；接口以 `backend/src/**/*controller.ts` 为准，若代码变更请同步更新本文件。*
