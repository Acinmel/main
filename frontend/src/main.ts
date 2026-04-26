import { createApp } from 'vue'
import { createPinia } from 'pinia'
import naive from 'naive-ui'

import App from './App.vue'
import router from './router'
import '@/assets/styles/global.css'

/**
 * 应用入口：Pinia + Vue Router + Naive UI（全量注册，MVP 开发更快）
 *
 * 用 `router.isReady()` 再 mount，避免与首屏导航竞态；守卫里长时间 await 不返回时
 * 在 router 中已对 digitalHuman.refresh 做超时，避免 isReady 永久挂起、整页白屏。
 */
const app = createApp(App)

app.config.errorHandler = (err, instance, info) => {
  console.error('[Vue error]', err, info, instance)
}

const pinia = createPinia()
app.use(pinia)
app.use(router)
app.use(naive)

function showFatalMessage(text: string) {
  const el = document.getElementById('app')
  if (el) {
    el.innerHTML = `<div style="padding:24px;font-family:system-ui,sans-serif;background:#020617;color:#fecaca;min-height:100vh;white-space:pre-wrap;word-break:break-all">${text}</div>`
  }
}

router
  .isReady()
  .then(() => {
    try {
      app.mount('#app')
    } catch (e) {
      console.error('[mount error]', e)
      showFatalMessage(`应用挂载失败：${e instanceof Error ? e.message : String(e)}`)
    }
  })
  .catch((e) => {
    console.error('[router.isReady error]', e)
    showFatalMessage(`路由初始化失败：${e instanceof Error ? e.message : String(e)}`)
  })
