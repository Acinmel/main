<script setup lang="ts">
import { ref } from 'vue'
import { NButton, NCard, NCheckbox, NInput, NSpace, NTag, NText } from 'naive-ui'
import type { SubtitleTemplateResource } from '@/types/resources'

const props = defineProps<{
  item: SubtitleTemplateResource
  selected: boolean
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
        v-if="item.owner === 'mine'"
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
      <n-space class="resource-card__actions" size="small">
        <n-button size="tiny" @click="emit('copy')">复制样式</n-button>
        <n-button v-if="item.owner === 'mine'" size="tiny" @click="emit('edit')">编辑模板</n-button>
        <n-button v-if="item.owner === 'mine'" size="tiny" @click="editing = true">编辑名称</n-button>
        <n-button v-if="item.owner === 'mine'" size="tiny" type="error" quaternary @click="emit('delete')">
          删除
        </n-button>
      </n-space>
    </div>
  </n-card>
</template>

<style scoped>
.resource-card {
  overflow: hidden;
  border: 1px solid var(--border-soft);
  border-radius: 18px;
  background: linear-gradient(180deg, rgba(8, 28, 21, 0.78), rgba(2, 10, 7, 0.9));
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.04),
    var(--shadow-soft);
  transition:
    border-color var(--transition-fast),
    box-shadow var(--transition-fast),
    transform var(--transition-smooth);
}

.resource-card:hover {
  border-color: var(--border-strong);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.06),
    0 18px 44px rgba(0, 0, 0, 0.38),
    0 0 30px rgba(22, 242, 139, 0.12);
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
  background: rgba(2, 17, 10, 0.82);
  box-shadow: 0 0 18px rgba(22, 242, 139, 0.16);
}

.resource-card__body {
  padding: 14px;
}

.resource-card__actions {
  margin-top: 12px;
}
</style>
