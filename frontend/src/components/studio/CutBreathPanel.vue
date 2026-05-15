<template>
  <section class="config-panel">
    <div class="panel-main">
      <div class="panel-title">
        <span class="line-icon">✂</span>
        <strong>剪辑气口</strong>
      </div>
      <button
        class="switch"
        :class="{ active: enabled }"
        type="button"
        aria-label="剪辑气口开关"
        @click="$emit('update:enabled', !enabled)"
      >
        <span />
      </button>
    </div>

    <div class="cut-controls">
      <div class="mode-pills">
        <button
          v-for="item in modes"
          :key="item.value"
          class="mode-pill"
          :class="{ active: mode === item.value }"
          type="button"
          @click="$emit('update:mode', item.value)"
        >
          {{ item.label }}
        </button>
      </div>
      <span class="cut-summary">
        {{ summary?.totalCount || 0 }} 个气口 · 压缩 {{ formatSeconds(summary?.totalCutDuration) }}
      </span>
    </div>
  </section>
</template>

<script setup lang="ts">
import type { SmartClipCutMode, SmartClipCutSummary } from '@/api/task'

defineProps<{
  enabled: boolean
  mode: SmartClipCutMode
  summary?: SmartClipCutSummary | null
}>()

defineEmits<{
  (event: 'update:enabled', value: boolean): void
  (event: 'update:mode', value: SmartClipCutMode): void
}>()

const modes: Array<{ value: SmartClipCutMode; label: string }> = [
  { value: 'light', label: '轻量' },
  { value: 'standard', label: '标准' },
  { value: 'strong', label: '强力' },
]

function formatSeconds(value?: number) {
  return `${Number(value || 0).toFixed(2)}s`
}
</script>

<style scoped>
.config-panel {
  display: grid;
  gap: 10px;
  min-width: 0;
}

.panel-main {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
}

.panel-title {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--text-main);
  font-size: var(--font-section-title, 15px);
  font-weight: 800;
}

.line-icon {
  color: #94A3B8;
  font-size: 19px;
}

.switch {
  position: relative;
  width: 38px;
  height: 22px;
  border: 0;
  border-radius: 999px;
  background: #CBD5E1;
  cursor: pointer;
  transition: background 0.18s ease;
}

.switch span {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 16px;
  height: 16px;
  border-radius: 999px;
  background: #fff;
  box-shadow: 0 4px 10px rgba(15, 23, 42, 0.18);
  transition: transform 0.18s ease;
}

.switch.active {
  background: var(--primary);
}

.switch.active span {
  transform: translateX(16px);
}

.cut-controls {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-width: 0;
  padding-left: 30px;
  overflow: hidden;
}

.mode-pills {
  display: flex;
  gap: 6px;
  flex: 0 0 auto;
  min-width: 0;
}

.mode-pill {
  height: 28px;
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 0 10px;
  color: #64748B;
  font-size: var(--font-small, 12px);
  font-weight: 800;
  background: #fff;
  cursor: pointer;
  transition: border-color 0.18s ease, background 0.18s ease, color 0.18s ease;
}

.mode-pill.active {
  border-color: #C4B5FD;
  color: var(--primary);
  background: var(--primary-light);
}

.cut-summary {
  color: #94A3B8;
  overflow: hidden;
  flex: 1 1 auto;
  min-width: 0;
  font-size: var(--font-small, 12px);
  font-weight: 800;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 1500px) {
  .panel-title {
    font-size: 14px;
  }

  .cut-controls {
    padding-left: 28px;
  }
}
</style>
