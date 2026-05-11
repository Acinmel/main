<script setup lang="ts">
defineProps<{
  fileName?: string
  videoUrl?: string
  loading?: boolean
  error?: string
  directory?: string
}>()

const emit = defineEmits<{
  open: []
}>()
</script>

<template>
  <section class="saved-video-preview">
    <div class="saved-video-preview__header">
      <div>
        <span class="saved-video-preview__eyebrow">服务器视频预览</span>
        <strong>{{ fileName || '请选择已保存视频' }}</strong>
      </div>
      <button
        type="button"
        class="saved-video-preview__open"
        :disabled="!videoUrl || loading"
        @click="emit('open')"
      >
        点开查看
      </button>
    </div>

    <button
      v-if="videoUrl"
      type="button"
      class="saved-video-preview__frame"
      aria-label="打开视频预览"
      @click="emit('open')"
    >
      <video :src="videoUrl" muted playsinline preload="metadata" />
      <span>点击放大预览</span>
    </button>

    <div v-else class="saved-video-preview__empty" :class="{ 'is-error': error }">
      <span>{{ loading ? '正在加载服务器视频...' : error || '选择后会在这里显示视频预览' }}</span>
    </div>

    <p v-if="directory" class="saved-video-preview__path">服务器目录：{{ directory }}</p>
  </section>
</template>

<style scoped>
.saved-video-preview {
  padding: 14px;
  margin-bottom: 16px;
  border: 1px solid rgba(96, 132, 255, 0.22);
  border-radius: 22px;
  background:
    linear-gradient(145deg, rgba(255, 255, 255, 0.96), rgba(245, 249, 255, 0.86)),
    radial-gradient(circle at 10% 0%, rgba(81, 111, 255, 0.12), transparent 30%);
  box-shadow: 0 18px 42px rgba(35, 63, 138, 0.08);
}

.saved-video-preview__header {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 12px;
}

.saved-video-preview__header strong {
  display: block;
  max-width: 460px;
  overflow: hidden;
  color: #18233c;
  font-size: 15px;
  line-height: 1.5;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.saved-video-preview__eyebrow {
  display: block;
  margin-bottom: 3px;
  color: #6680bd;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
}

.saved-video-preview__open {
  min-width: 84px;
  padding: 8px 14px;
  color: #4369ff;
  font-weight: 800;
  border: 1px solid rgba(67, 105, 255, 0.24);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.82);
  box-shadow: 0 10px 24px rgba(63, 91, 220, 0.1);
  cursor: pointer;
  transition:
    transform 0.18s ease,
    border-color 0.18s ease,
    box-shadow 0.18s ease;
}

.saved-video-preview__open:hover:not(:disabled) {
  border-color: rgba(67, 105, 255, 0.42);
  box-shadow: 0 14px 32px rgba(63, 91, 220, 0.18);
  transform: translateY(-1px);
}

.saved-video-preview__open:disabled {
  color: #9aa8c5;
  cursor: not-allowed;
  opacity: 0.72;
}

.saved-video-preview__frame {
  position: relative;
  display: block;
  width: 100%;
  overflow: hidden;
  aspect-ratio: 16 / 9;
  padding: 0;
  border: 0;
  border-radius: 18px;
  background: #0f172a;
  cursor: zoom-in;
}

.saved-video-preview__frame video {
  width: 100%;
  height: 100%;
  object-fit: contain;
  background: #0f172a;
}

.saved-video-preview__frame span {
  position: absolute;
  right: 12px;
  bottom: 12px;
  padding: 7px 12px;
  color: #fff;
  font-size: 12px;
  font-weight: 800;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.68);
  backdrop-filter: blur(10px);
}

.saved-video-preview__empty {
  display: grid;
  min-height: 132px;
  place-items: center;
  padding: 22px;
  color: #7182a5;
  font-weight: 700;
  text-align: center;
  border: 1px dashed rgba(112, 139, 198, 0.32);
  border-radius: 18px;
  background: rgba(247, 250, 255, 0.72);
}

.saved-video-preview__empty.is-error {
  color: #c2410c;
  border-color: rgba(251, 146, 60, 0.45);
  background: rgba(255, 247, 237, 0.78);
}

.saved-video-preview__path {
  margin: 10px 2px 0;
  overflow: hidden;
  color: #8796b5;
  font-size: 12px;
  line-height: 1.5;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 640px) {
  .saved-video-preview__header {
    flex-direction: column;
  }

  .saved-video-preview__open {
    width: 100%;
  }
}
</style>
