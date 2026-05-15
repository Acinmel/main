<script setup lang="ts">
import { computed, ref } from 'vue'
import { NButton, NCard, NCheckbox, NInput, NTag, NText } from 'naive-ui'
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

function formatCreatedAt(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const pad = (unit: number) => String(unit).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
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
      <div class="resource-card__actions">
        <n-button size="small" type="primary" :disabled="!hasSourceVideo" @click="emit('create')">创作</n-button>
        <n-button size="small" secondary :disabled="!hasSourceVideo" @click="emit('preview')">预览</n-button>
        <n-button v-if="item.owner === 'mine'" size="small" secondary @click="editing = true">改名</n-button>
        <n-button v-if="item.owner === 'mine'" size="small" type="error" secondary @click="emit('delete')">
          删除
        </n-button>
      </div>
    </div>
    <div class="resource-card__body">
      <div class="resource-card__meta">
        <n-input
          v-if="editing"
          v-model:value="draftName"
          size="small"
          autofocus
          @blur="saveName"
          @keyup.enter="saveName"
        />
        <n-text v-else strong class="resource-card__name">{{ item.name }}</n-text>
        <n-tag size="small" :type="item.owner === 'mine' ? 'success' : 'info'" class="resource-card__tag">
          {{ item.owner === 'mine' ? '我的' : '推荐' }}
        </n-tag>
      </div>
      <n-text depth="3" class="resource-card__date">上传于 {{ formatCreatedAt(item.createdAt) }}</n-text>
      <n-text v-if="!hasSourceVideo" depth="3" class="resource-card__hint">
        这个数字人还没有绑定原始视频，先补充视频素材后才能做对口型预览。
      </n-text>
    </div>
  </n-card>
</template>

<style scoped>
.resource-card {
  position: relative;
  overflow: hidden;
  border: 1px solid rgba(223, 230, 244, 0.9);
  border-radius: 22px;
  background: rgba(255, 255, 255, 0.92);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.94),
    0 18px 40px rgba(64, 78, 118, 0.08);
  transition:
    border-color var(--transition-fast),
    box-shadow var(--transition-fast),
    transform var(--transition-smooth);
}

.resource-card:hover {
  border-color: rgba(124, 58, 237, 0.28);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.96),
    0 24px 54px rgba(64, 78, 118, 0.14);
  transform: translateY(-6px);
}

.resource-card__media {
  position: relative;
  aspect-ratio: 3 / 4;
  overflow: hidden;
  background:
    linear-gradient(180deg, rgba(17, 24, 39, 0.04), rgba(17, 24, 39, 0.1)),
    linear-gradient(180deg, #eef3fb, #dfe8f7);
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
  top: 12px;
  z-index: 1;
  padding: 7px 11px;
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
  top: 12px;
  left: 12px;
  padding: 6px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.82);
  box-shadow: 0 10px 24px rgba(64, 86, 122, 0.14);
}

.resource-card__body {
  padding: 20px 22px 18px;
  background: rgba(255, 255, 255, 0.96);
}

.resource-card__actions {
  position: absolute;
  right: 14px;
  bottom: 14px;
  left: 14px;
  z-index: 2;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-end;
  padding-top: 42px;
  opacity: 0;
  background: linear-gradient(180deg, transparent, rgba(15, 23, 42, 0.62));
  transform: translateY(10px);
  transition:
    opacity var(--transition-fast),
    transform var(--transition-fast);
  pointer-events: none;
}

.resource-card:hover .resource-card__actions,
.resource-card:focus-within .resource-card__actions {
  opacity: 1;
  transform: translateY(0);
  pointer-events: auto;
}

.resource-card__actions :deep(.n-button) {
  min-width: 58px;
  border-radius: 999px;
  font-weight: 800;
  box-shadow: 0 10px 24px rgba(15, 23, 42, 0.16);
}

.resource-card__meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.resource-card__name {
  min-width: 0;
  color: #101828;
  font-size: 20px;
  font-weight: 900;
  line-height: 1.25;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.resource-card__tag {
  flex: 0 0 auto;
  border: 0;
  border-radius: 7px;
  color: #6f35f0;
  font-weight: 900;
  background: rgba(124, 58, 237, 0.1);
}

.resource-card__date {
  display: block;
  margin-top: 8px;
  color: #8b98ad;
  font-size: 14px;
  font-weight: 600;
}

.resource-card__hint {
  display: block;
  margin-top: 10px;
  line-height: 1.45;
}

@media (hover: none) {
  .resource-card__actions {
    opacity: 1;
    transform: none;
    pointer-events: auto;
  }
}
</style>
