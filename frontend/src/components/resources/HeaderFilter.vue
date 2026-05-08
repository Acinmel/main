<script setup lang="ts">
import { computed } from 'vue'
import { NButton, NInput, NRadioButton, NRadioGroup, NSpace, NText } from 'naive-ui'
import type { ResourceScope } from '@/types/resources'

const props = defineProps<{
  modelValue: ResourceScope
  title: string
  subtitle: string
  actionText: string
  batchDeleteDisabled?: boolean
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
    <div>
      <h1>{{ title }}</h1>
      <n-text depth="3">{{ subtitle }}</n-text>
    </div>
    <n-space align="center" :size="10" wrap>
      <n-input
        v-if="showSearch"
        v-model:value="search"
        class="resource-header__search"
        size="small"
        clearable
        :placeholder="searchPlaceholder || '搜索...'"
      />
      <n-radio-group
        :value="modelValue"
        size="small"
        @update:value="emit('update:modelValue', $event as ResourceScope)"
      >
        <n-radio-button value="all">全部</n-radio-button>
        <n-radio-button value="mine">我的</n-radio-button>
        <n-radio-button value="recommended">推荐</n-radio-button>
      </n-radio-group>
      <n-button size="small" :disabled="batchDeleteDisabled" @click="emit('batchDelete')">
        批量删除
      </n-button>
      <n-button size="small" type="primary" @click="emit('action')">{{ actionText }}</n-button>
    </n-space>
  </section>
</template>

<style scoped>
.resource-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 18px;
  padding: 18px;
  border: 1px solid var(--border-soft);
  border-radius: 24px;
  background: linear-gradient(180deg, rgba(8, 28, 21, 0.78), rgba(2, 10, 7, 0.86));
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.04),
    var(--shadow-soft);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
}

.resource-header h1 {
  margin: 0 0 6px;
  color: var(--text-main);
  font-size: 28px;
  letter-spacing: -0.04em;
}

.resource-header__search {
  width: min(220px, 48vw);
}

.resource-header :deep(.n-radio-group .n-radio-button) {
  border-color: rgba(22, 242, 139, 0.18);
  background: rgba(0, 0, 0, 0.18);
}

.resource-header :deep(.n-radio-button:hover) {
  color: var(--primary);
  border-color: var(--border-strong);
  transform: translateY(-1px);
}

.resource-header :deep(.n-radio-button.n-radio-button--checked) {
  color: #02110a;
  background: linear-gradient(135deg, var(--primary), var(--primary-deep));
  box-shadow: 0 10px 24px rgba(22, 242, 139, 0.14);
}

@media (max-width: 760px) {
  .resource-header {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
