<script setup lang="ts">
import {
  NConfigProvider,
  NDialogProvider,
  NMessageProvider,
  dateZhCN,
  zhCN,
} from 'naive-ui'
import { onErrorCaptured, ref } from 'vue'
import { RouterView } from 'vue-router'
import { appThemeOverrides } from '@/theme/naive-ui-overrides'

const childError = ref<string | null>(null)

onErrorCaptured((err) => {
  childError.value = err instanceof Error ? err.message : String(err)
  console.error('[App] child render error', err)
  return false
})
</script>

<template>
  <div v-if="childError" class="app-fatal">
    页面渲染出现错误，请稍后刷新重试。
    <pre class="app-fatal__pre">{{ childError }}</pre>
  </div>
  <n-config-provider
    v-else
    :locale="zhCN"
    :date-locale="dateZhCN"
    :theme-overrides="appThemeOverrides"
  >
    <n-dialog-provider>
      <n-message-provider
        placement="top"
        :duration="5200"
        :closable="true"
        :max="6"
        container-class="app-message-root"
        :container-style="{
          paddingTop: '28px',
          paddingLeft: 'max(20px, env(safe-area-inset-left))',
          paddingRight: 'max(20px, env(safe-area-inset-right))',
        }"
      >
        <RouterView v-slot="{ Component, route }">
          <Transition name="route-fade" mode="out-in">
            <component :is="Component" :key="route.fullPath" />
          </Transition>
        </RouterView>
      </n-message-provider>
    </n-dialog-provider>
  </n-config-provider>
</template>

<style scoped>
.app-fatal {
  padding: 24px;
  color: #a82647;
  background: var(--bg-main);
  min-height: 100vh;
  box-sizing: border-box;
  font: 15px/1.7 var(--font-sans);
}

.app-fatal__pre {
  margin-top: 12px;
  padding: 14px;
  overflow: auto;
  border: 1px solid var(--border-soft);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.9);
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
