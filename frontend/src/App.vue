<script setup lang="ts">
import {
  NConfigProvider,
  NDialogProvider,
  NMessageProvider,
  darkTheme,
  zhCN,
  dateZhCN,
} from 'naive-ui'
import { computed, onErrorCaptured, ref } from 'vue'
import { appThemeOverrides } from '@/theme/naive-ui-overrides'

/** 全局深色主题，偏工具/科技感 */
const theme = computed(() => darkTheme)

const childError = ref<string | null>(null)
onErrorCaptured((err) => {
  childError.value = err instanceof Error ? err.message : String(err)
  console.error('[App] child render error', err)
  return false
})
</script>

<template>
  <div v-if="childError" class="app-fatal">
    页面渲染出错（请把下列信息发开发者），或先尝试硬刷新/清除缓存后重开：
    <pre class="app-fatal__pre">{{ childError }}</pre>
  </div>
  <n-config-provider
    v-else
    :theme="theme"
    :locale="zhCN"
    :date-locale="dateZhCN"
    :theme-overrides="appThemeOverrides"
  >
    <n-dialog-provider>
      <n-message-provider
        placement="top"
        :duration="5600"
        :closable="true"
        :max="6"
        container-class="app-message-root"
        :container-style="{
          paddingTop: '28px',
          paddingLeft: 'max(20px, env(safe-area-inset-left))',
          paddingRight: 'max(20px, env(safe-area-inset-right))',
        }"
      >
        <router-view />
      </n-message-provider>
    </n-dialog-provider>
  </n-config-provider>
</template>

<style scoped>
.app-fatal {
  padding: 24px;
  color: #fecaca;
  background: #020617;
  min-height: 100vh;
  font: 15px/1.6 system-ui, sans-serif;
  box-sizing: border-box;
}
.app-fatal__pre {
  margin-top: 12px;
  padding: 12px;
  background: #0f172a;
  border-radius: 8px;
  overflow: auto;
  font-size: 13px;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
