<script setup lang="ts">
import { ref } from 'vue'
import { NButton, NCard, NCheckbox, NInput, NSpace, NTag, NText } from 'naive-ui'
import type { SubtitleTemplateResource } from '@/types/resources'

const props = defineProps<{
  item: SubtitleTemplateResource
  selected?: boolean
  readOnly?: boolean
}>()

const emit = defineEmits<{
  'update:selected': [value: boolean]
  rename: [name: string]
  delete: []
  copy: []
  edit: []
}>()

const editing = ref(false)
const hover = ref(false)
const draftName = ref(props.item.name)

function saveName() {
  editing.value = false
  const next = draftName.value.trim()
  if (next && next !== props.item.name) emit('rename', next)
}
</script>

<template>
  <n-card class="resource-card" content-style="padding: 0">
    <div class="resource-card__media" @mouseenter="hover = true" @mouseleave="hover = false">
      <img :src="hover ? item.previewCoverUrl : item.coverUrl" :alt="item.name" loading="lazy" />
      <n-checkbox
        v-if="item.owner === 'mine' && !readOnly"
        class="resource-card__check"
        :checked="selected"
        @update:checked="emit('update:selected', $event)"
      />
    </div>
    <div class="resource-card__body">
      <n-space justify="space-between" align="center" :wrap="false">
        <n-input
          v-if="editing"
          v-model:value="draftName"
          size="small"
          autofocus
          @blur="saveName"
          @keyup.enter="saveName"
        />
        <n-text v-else strong>{{ item.name }}</n-text>
        <n-tag size="small" :type="item.owner === 'mine' ? 'success' : 'info'">
          {{ item.owner === 'mine' ? '我的' : '推荐' }}
        </n-tag>
      </n-space>
      <n-space v-if="!readOnly" class="resource-card__actions" size="small">
        <n-button size="tiny" @click="emit('copy')">复制样式</n-button>
        <n-button v-if="item.owner === 'mine'" size="tiny" @click="emit('edit')">编辑模板</n-button>
        <n-button v-if="item.owner === 'mine'" size="tiny" @click="editing = true">编辑名称</n-button>
        <n-button v-if="item.owner === 'mine'" size="tiny" type="error" quaternary @click="emit('delete')">
          删除
        </n-button>
      </n-space>
      <n-text v-else class="resource-card__readonly" depth="3">
        系统模板，仅可在创作流程中选择使用
      </n-text>
    </div>
  </n-card>
</template>

<style scoped>
.resource-card {
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.58);
  border-radius: 18px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.9), rgba(246, 249, 255, 0.82));
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.94),
    var(--shadow-soft);
  transition:
    border-color var(--transition-fast),
    box-shadow var(--transition-fast),
    transform var(--transition-smooth);
}

.resource-card:hover {
  border-color: var(--border-strong);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.96),
    var(--shadow-panel);
  transform: translateY(-5px);
}

.resource-card__media {
  position: relative;
  aspect-ratio: 16 / 10;
  overflow: hidden;
  background: var(--bg-soft);
}

.resource-card__media img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition:
    opacity var(--transition-fast),
    transform var(--transition-smooth),
    filter var(--transition-fast);
}

.resource-card:hover .resource-card__media img {
  filter: saturate(1.08);
  transform: scale(1.045);
}

.resource-card__check {
  position: absolute;
  top: 10px;
  left: 10px;
  padding: 6px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.82);
  box-shadow: 0 10px 24px rgba(64, 86, 122, 0.14);
}

.resource-card__body {
  padding: 14px;
}

.resource-card__actions {
  margin-top: 12px;
}

.resource-card__readonly {
  display: block;
  margin-top: 12px;
  font-size: 12px;
  line-height: 1.6;
}
</style>
