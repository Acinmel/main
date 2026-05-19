<template>
  <aside class="result-panel">
    <header class="result-header">
      <div class="result-title">
        <span>▷</span>
        <strong>生成结果</strong>
      </div>
      <div class="result-actions">
        <button class="danger-btn" type="button" @click="$emit('delete-video')">删除视频</button>
        <button class="outline-btn" type="button" @click="$emit('change-video')">更换视频</button>
        <a v-if="finalVideoUrl" class="download-btn" :href="finalVideoUrl" download>下载</a>
        <button v-else class="download-btn" type="button" disabled>下载</button>
      </div>
    </header>

    <div class="phone-wrap">
      <video v-if="finalVideoUrl" class="preview-video" :src="finalVideoUrl" controls playsinline preload="metadata" />
      <div v-else class="preview-placeholder">
        <img v-if="coverUrl" :src="coverUrl" alt="生成结果封面" />
        <div v-else class="avatar-word">avatar</div>
        <div class="video-caption">
          <strong>福气别乱说</strong>
          <span>小心招损！</span>
        </div>
        <p>{{ hint || '点击立即剪辑后，这里展示最终成片结果' }}</p>
      </div>
    </div>

    <p class="result-note">{{ finalVideoUrl ? '成片已生成，可以下载使用。' : '先确认文案、数字人和音色。' }}</p>
  </aside>
</template>

<script setup lang="ts">
defineProps<{
  finalVideoUrl?: string | null
  coverUrl?: string
  hint?: string
}>()

defineEmits<{
  (event: 'delete-video'): void
  (event: 'change-video'): void
}>()
</script>

<style scoped>
.result-panel {
  display: grid;
  grid-template-rows: auto auto 1fr;
  align-content: start;
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  overflow: hidden;
  height: 100%;
  padding: 20px 18px;
  border-left: 1px solid var(--border);
  background: #F8FAFC;
}

.result-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: nowrap;
  gap: 8px;
  min-width: 0;
  margin-bottom: 18px;
}

.result-title {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text-main);
  min-width: 0;
  white-space: nowrap;
}

.result-title span {
  color: var(--primary);
  font-size: 15px;
}

.result-title strong {
  font-size: var(--font-section-title, 15px);
  font-weight: 900;
}

.result-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1 1 auto;
  justify-content: flex-end;
  min-width: 0;
}

.result-actions button,
.result-actions a {
  display: grid;
  height: 32px;
  place-items: center;
  border-radius: 10px;
  padding: 0 12px;
  font-size: 12px;
  font-weight: 900;
  text-decoration: none;
  white-space: nowrap;
  cursor: pointer;
  min-width: 0;
  flex: 0 1 auto;
}

.danger-btn {
  border: 1px solid #FCA5A5;
  color: var(--danger);
  background: #fff;
}

.outline-btn {
  border: 1px solid #DDD6FE;
  color: var(--primary);
  background: #fff;
}

.download-btn {
  border: 1px solid var(--primary);
  color: #fff;
  background: var(--primary);
  box-shadow: 0 12px 24px rgba(124, 58, 237, 0.22);
  min-width: 52px;
}

.download-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.phone-wrap {
  width: min(100%, 300px);
  margin: 0 auto;
}

.preview-video,
.preview-placeholder {
  width: 100%;
  aspect-ratio: 9 / 16;
  overflow: hidden;
  border-radius: 22px;
  background: linear-gradient(180deg, #E5E7EB 0%, #F8FAFC 38%, #9CA3AF 100%);
  box-shadow: 0 18px 42px rgba(15, 23, 42, 0.12);
}

.preview-video {
  object-fit: cover;
}

.preview-placeholder {
  position: relative;
  display: grid;
  place-items: center;
}

.preview-placeholder img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  filter: saturate(0.9);
}

.avatar-word {
  position: absolute;
  top: 47%;
  left: 50%;
  color: rgba(15, 23, 42, 0.95);
  font-size: clamp(44px, 4.2vw, 68px);
  font-weight: 900;
  line-height: 1;
  transform: translate(-50%, -50%);
}

.video-caption {
  position: absolute;
  left: 20px;
  right: 20px;
  bottom: 28%;
  display: grid;
  gap: 12px;
  z-index: 1;
}

.video-caption strong {
  color: #FACC15;
  font-size: clamp(28px, 2vw, 34px);
  font-weight: 1000;
  line-height: 1.05;
  text-shadow:
    0 3px 0 #111827,
    0 6px 14px rgba(0, 0, 0, 0.36);
}

.video-caption span {
  color: #fff;
  font-size: clamp(20px, 1.6vw, 24px);
  font-weight: 1000;
  text-shadow:
    0 2px 0 #111827,
    2px 0 0 #111827,
    -2px 0 0 #111827,
    0 6px 14px rgba(0, 0, 0, 0.38);
}

.preview-placeholder p {
  position: absolute;
  left: 20px;
  right: 20px;
  bottom: 22px;
  z-index: 1;
  margin: 0;
  color: #fff;
  font-size: 12px;
  font-weight: 900;
  line-height: 1.5;
  text-shadow: 0 3px 10px rgba(0, 0, 0, 0.42);
}

.result-note {
  margin: 12px auto 0;
  width: min(100%, 300px);
  color: var(--text-sub);
  font-size: var(--font-small, 12px);
  font-weight: 800;
}

@media (max-width: 1500px) {
  .result-panel {
    padding: 18px 14px;
  }

  .result-header {
    align-items: center;
    flex-direction: row;
  }

  .result-actions {
    width: auto;
    gap: 6px;
  }

  .result-actions button,
  .result-actions a {
    height: 30px;
    padding: 0 8px;
    font-size: 11px;
  }
}

@media (max-width: 1440px) {
  .result-header {
    align-items: flex-start;
    flex-wrap: wrap;
  }

  .result-actions {
    width: 100%;
    justify-content: space-between;
  }

  .result-actions button,
  .result-actions a {
    flex: 1 1 0;
    padding: 0 6px;
  }
}
</style>
