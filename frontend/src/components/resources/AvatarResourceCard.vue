<script setup lang="ts">
import { computed, ref } from 'vue'
import { NButton, NCard, NCheckbox, NInput, NSpace, NTag, NText } from 'naive-ui'
import type { AvatarResource } from '@/types/resources'

const props = defineProps<{
  item: AvatarResource
  selected: boolean
  previewVideoUrl?: string
  previewLoading?: boolean
}>()

const emit = defineEmits<{
  'update:selected': [value: boolean]
  rename: [name: string]
  delete: []
  preview: []
  create: []
}>()

const editing = ref(false)
const draftName = ref(props.item.name)
const hasSourceVideo = computed(() => Boolean(props.item.originalVideoUrl))

function saveName() {
  editing.value = false
  const next = draftName.value.trim()
  if (next && next !== props.item.name) emit('rename', next)
}

function playVideoPreview(event: Event) {
  const video = event.currentTarget as HTMLVideoElement
  void video.play().catch(() => undefined)
}

function pauseVideoPreview(event: Event) {
  const video = event.currentTarget as HTMLVideoElement
  video.pause()
}
</script>

<template>
  <n-card class="resource-card" content-style="padding: 0">
    <div class="resource-card__media" :class="{ 'resource-card__media--video': previewVideoUrl }">
      <video
        v-if="previewVideoUrl"
        :src="previewVideoUrl"
        muted
        playsinline
        preload="metadata"
        @pointerenter="playVideoPreview"
        @pointerleave="pauseVideoPreview"
      />
      <img v-else :src="item.coverUrl" :alt="item.name" loading="lazy" />
      <span v-if="previewVideoUrl" class="resource-card__media-label">视频预览</span>
      <span v-else-if="previewLoading" class="resource-card__media-label">加载预览中</span>
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
        <n-button size="tiny" :disabled="!hasSourceVideo" @click="emit('create')">立即创作</n-button>
        <n-button size="tiny" :disabled="!hasSourceVideo" @click="emit('preview')">
          原始视频
        </n-button>
        <n-button v-if="item.owner === 'mine'" size="tiny" @click="editing = true">编辑名称</n-button>
        <n-button v-if="item.owner === 'mine'" size="tiny" type="error" quaternary @click="emit('delete')">
          删除
        </n-button>
      </n-space>
      <n-text v-if="!hasSourceVideo" depth="3" class="resource-card__hint">
        这个数字人还没有绑定原始视频，先补充视频素材后才能做对口型预览。
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
  aspect-ratio: 4 / 5;
  overflow: hidden;
  background: linear-gradient(180deg, #eef3fb, #dfe8f7);
}

.resource-card__media img,
.resource-card__media video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform var(--transition-smooth), filter var(--transition-fast);
}

.resource-card__media video {
  display: block;
  background: #0f172a;
}

.resource-card:hover .resource-card__media img,
.resource-card:hover .resource-card__media video {
  filter: saturate(1.08);
  transform: scale(1.045);
}

.resource-card__media--video {
  background: #0f172a;
}

.resource-card__media-label {
  position: absolute;
  right: 10px;
  bottom: 10px;
  z-index: 1;
  padding: 6px 10px;
  color: #ffffff;
  font-size: 12px;
  font-weight: 800;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.7);
  box-shadow: 0 10px 22px rgba(15, 23, 42, 0.2);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
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

.resource-card__hint {
  display: block;
  margin-top: 10px;
  line-height: 1.45;
}
</style>
