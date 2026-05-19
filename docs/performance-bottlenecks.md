# 性能瓶颈分析与优化记录

## 已发现问题

- 首屏路由已有懒加载，但资源库页内部一次性静态导入三个资源子页面，进入资源库会扩大首个 route chunk。
- 创作台页面较大，第三步智能编辑和资源弹窗直接静态导入，会增加工作台初始解析成本。
- 任务进度页只展示粗略轮询状态，缺少失败原因、阶段耗时、后台执行说明和失败重试入口。
- 任务链路没有统一记录每一步耗时，定位 AI / FFmpeg / 渲染慢点成本偏高。
- 上传照片和对口型视频缺少真实上传进度反馈，照片上传前校验偏弱。
- 视频元数据、AI 改写和相同源视频下载结果缺少短期缓存，重复点击会重复消耗后端和第三方服务。
- 生产 Nginx 已开启 gzip，但仍建议补齐 `gzip_vary`、`gzip_min_length`、`gzip_comp_level`，并为带 hash 的静态资源设置长缓存。

## 本次优化

- 后端任务详情增加 `progress`，包含百分比、当前阶段、每一步开始/结束时间、耗时和错误信息。
- 后端任务服务增加阶段日志：每次状态迁移记录 `task_step id/status/progress/durationMs`。
- 后端增加接口耗时日志，默认 `HTTP_SLOW_LOG_MS=800` 以上或 5xx 以 warn 记录。
- 后端增加失败任务重试接口 `POST /api/v1/tasks/:id/retry`。
- 后端增加内存 TTL 缓存：视频元数据、AI 改写结果、源视频下载结果。
- 前端任务进度页增加状态条、阶段列表、失败原因、重试按钮和后台运行说明。
- 前端上传任务照片和对口型视频时展示上传进度。
- 前端资源库 tab 和创作台重型组件改为按需加载，降低初始 route chunk 压力。
- 前端资源列表接口增加 60 秒内存缓存，创建/修改/删除后自动失效。
- OSS 模式下声音样本试听和 provider 回读改为流式返回，不再先把完整 OSS 对象读入后端 Buffer。

## 建议的 Nginx 静态资源配置

```nginx
gzip on;
gzip_vary on;
gzip_min_length 1024;
gzip_comp_level 5;
gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss image/svg+xml;

location ~* \.(?:js|css|woff2?|ttf|otf|svg)$ {
    expires 30d;
    add_header Cache-Control "public, max-age=2592000, immutable" always;
    try_files $uri =404;
}

location ~* \.(?:png|jpg|jpeg|gif|webp|avif|ico)$ {
    expires 30d;
    add_header Cache-Control "public, max-age=2592000, immutable" always;
    try_files $uri =404;
}

location /api/ {
    proxy_request_buffering off;
    proxy_read_timeout 620s;
    proxy_send_timeout 620s;
}
```

## 后续建议

- 图片、音频、视频成品建议迁移到对象存储/CDN，后端只保存对象 key 和签名访问 URL。
- 大于 100MB 的视频上传建议继续拆成独立分片上传会话：init、part、complete、abort；本次 API 层已保持 multipart，不走 JSON。
- Redis 未在本次接入，避免新增部署依赖；如果线上已有 Redis，可将当前内存任务状态缓存替换为 `Redis -> DB` 的读取顺序。
