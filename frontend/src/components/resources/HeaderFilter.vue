<script setup lang="ts">
import { computed } from 'vue'
import { NButton, NInput, NRadioButton, NRadioGroup, NSpace, NText } from 'naive-ui'
import type { ResourceScope } from '@/types/resources'

const props = defineProps<{
  modelValue: ResourceScope
  title: string
  subtitle: string
  actionText?: string
  batchDeleteDisabled?: boolean
  showAction?: boolean
  showBatchDelete?: boolean
  searchValue?: string
  searchPlaceholder?: string
  showSearch?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: ResourceScope]
  'update:searchValue': [value: string]
  action: []
  batchDelete: []
}>()

const search = computed({
  get: () => props.searchValue ?? '',
  set: (value) => emit('update:searchValue', value),
})
</script>

<template>
  <section class="resource-header">
    <div class="resource-header__main">
      <div class="resource-header__copy">
        <h1>{{ title }}</h1>
        <n-text depth="3">{{ subtitle }}</n-text>
      </div>
      <n-space class="resource-header__actions" align="center" :size="14" wrap>
        <n-input
          v-if="showSearch"
          v-model:value="search"
          class="resource-header__search"
          size="large"
          clearable
          :placeholder="searchPlaceholder || '搜索...'"
        />
        <n-button
          v-if="showAction !== false && actionText"
          size="large"
          type="primary"
          class="resource-header__primary"
          @click="emit('action')"
        >
          <span class="resource-header__plus">+</span>
          {{ actionText }}
        </n-button>
        <n-button
          v-if="showBatchDelete !== false"
          size="large"
          class="resource-header__batch"
          :disabled="batchDeleteDisabled"
          @click="emit('batchDelete')"
        >
          批量删除{{ batchDeleteDisabled ? ' (0)' : '' }}
        </n-button>
      </n-space>
    </div>
    <div class="resource-header__filters">
      <n-radio-group
        :value="modelValue"
        size="large"
        @update:value="emit('update:modelValue', $event as ResourceScope)"
      >
        <n-radio-button value="all">全部</n-radio-button>
        <n-radio-button value="mine">我的</n-radio-button>
        <n-radio-button value="recommended">推荐</n-radio-button>
      </n-radio-group>
    </div>
  </section>
</template>

<style scoped>
.resource-header {
  margin-bottom: 36px;
}

.resource-header__main {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 28px;
}

.resource-header__copy {
  min-width: 220px;
}

.resource-header h1 {
  margin: 0 0 10px;
  color: var(--text-main);
  font-size: clamp(30px, 3vw, 42px);
  line-height: 1;
  letter-spacing: -0.04em;
}

.resource-header__actions {
  justify-content: flex-end;
}

.resource-header__search {
  width: min(360px, 32vw);
}

.resource-header__search :deep(.n-input-wrapper) {
  min-height: 56px;
  padding: 0 18px;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.84);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.95),
    0 16px 34px rgba(60, 74, 110, 0.1);
}

.resource-header__primary {
  min-width: 184px;
  height: 56px;
  border-radius: 18px;
  font-size: 16px;
  font-weight: 900;
  box-shadow: 0 18px 34px rgba(118, 55, 235, 0.25);
}

.resource-header__plus {
  margin-right: 8px;
  font-size: 26px;
  line-height: 1;
}

.resource-header__batch {
  min-width: 172px;
  height: 56px;
  border-radius: 18px;
  font-weight: 800;
}

.resource-header__filters {
  margin-top: 32px;
}

.resource-header :deep(.n-radio-group .n-radio-button) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 96px;
  height: 52px;
  padding: 0 24px;
  margin: 0;
  border: 0 !important;
  border-radius: 18px;
  color: #667085;
  font-size: 16px;
  font-weight: 900;
  background: rgba(255, 255, 255, 0.78);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.92),
    0 14px 30px rgba(64, 78, 118, 0.08);
  transition:
    color var(--transition-fast),
    transform var(--transition-fast),
    box-shadow var(--transition-fast),
    background var(--transition-fast);
}

.resource-header :deep(.n-radio-group) {
  display: flex;
  align-items: center;
  gap: 18px;
  --n-button-border-color: transparent !important;
  --n-button-border-color-active: transparent !important;
  --n-button-border-color-hover: transparent !important;
  --n-button-box-shadow: none !important;
  --n-button-box-shadow-active: none !important;
  --n-button-box-shadow-focus: none !important;
}

.resource-header :deep(.n-radio-button)::before,
.resource-header :deep(.n-radio-button)::after,
.resource-header :deep(.n-radio-button + .n-radio-button)::before {
  content: none !important;
  display: none !important;
}

.resource-header :deep(.n-radio-button .n-radio-button__state-border),
.resource-header :deep(.n-radio-button .n-radio-button__border),
.resource-header :deep(.n-radio-button .n-radio-button__separator) {
  display: none !important;
}

.resource-header :deep(.n-radio-button__label) {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  line-height: 52px;
  text-align: center;
}

.resource-header :deep(.n-radio-button:hover) {
  color: var(--primary);
  transform: translateY(-2px);
}

.resource-header :deep(.n-radio-button.n-radio-button--checked) {
  color: #ffffff;
  background: linear-gradient(135deg, #7f3df3 0%, #7048f4 100%);
  box-shadow: 0 16px 30px rgba(112, 72, 244, 0.24);
}

@media (max-width: 760px) {
  .resource-header__main {
    flex-direction: column;
  }

  .resource-header__actions,
  .resource-header__search {
    width: 100%;
  }

  .resource-header :deep(.n-radio-group) {
    width: 100%;
    overflow-x: auto;
    padding-bottom: 4px;
  }
}
</style>
