# Performance Bottlenecks

当前性能优化重点以 `docs/PERFORMANCE.md` 为准。本文只记录需要持续关注的瓶颈。

## Watch List

- 真实口型 provider 长任务耗时、失败态和重复付费调用。
- 大视频预览等待时间和 Range 请求稳定性。
- 生成后视频清晰度、色彩空间和压缩参数。
- 字幕模板预览图加载体积。
- 创作台大组件拆分和首屏解析成本。
- stage-state 恢复请求去重和陈旧请求覆盖。

## Current Rules

- 高成本任务必须有幂等键。
- 预览优先轻量资源。
- 包装成片不重新生成音频或口型。
- 模板预览图不能使用内联大图。

详细检查命令见 `docs/PERFORMANCE.md`。
