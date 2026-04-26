/**
 * 开发模式入口：供 `npm run dev` (tsx watch) 使用。
 * 库根模块 `index.ts` 仅 re-export，直接 watch 时终端无输出，易被误认为未启动。
 */
import consola from 'consola'

consola.success('dy-downloader 开发监听已启动（修改 src 将重新加载）')
consola.info('测试 CLI：npm run cli -- --help')

await import('./index.js')
