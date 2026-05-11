<script setup lang="ts">
import { NGradientText, NSpace, NTag, NText } from 'naive-ui'
</script>

<template>
  <section class="hero">
    <n-space vertical :size="14" align="center">
      <n-tag size="small" round type="info" bordered>视频创作工作台</n-tag>
      <n-gradient-text class="hero__title" :size="32" type="info">
        抖音文案进来，数字人成片出去
      </n-gradient-text>
      <n-text class="hero__sub" depth="2">
        先抓取视频文案，再从数字人库选择出镜视频，从音色库选择克隆声音，最后直接生成对口型预览。
      </n-text>
    </n-space>
  </section>
</template>

<style scoped>
.hero {
  position: relative;
  z-index: 1;
  width: 100%;
  box-sizing: border-box;
  padding: 28px 16px 12px;
  text-align: center;
}

.hero::before {
  position: absolute;
  top: 0;
  left: 50%;
  width: min(760px, 90vw);
  height: 150px;
  pointer-events: none;
  content: '';
  background:
    radial-gradient(circle at 50% 0%, rgba(22, 242, 139, 0.14), transparent 38%),
    radial-gradient(circle at 28% 26%, rgba(0, 210, 106, 0.1), transparent 32%),
    radial-gradient(circle at 72% 20%, rgba(22, 242, 139, 0.08), transparent 30%);
  filter: blur(2px);
  transform: translateX(-50%);
}

.hero :deep(.n-space) {
  position: relative;
  z-index: 1;
}

.hero :deep(.n-tag) {
  color: var(--primary);
  border-color: rgba(22, 242, 139, 0.22);
  background: rgba(22, 242, 139, 0.08);
  box-shadow: 0 0 22px rgba(22, 242, 139, 0.12);
}

.hero :deep(.n-gradient-text) {
  font-family: var(--font-display);
  letter-spacing: 1px;
}

.hero__sub {
  max-width: 680px;
  margin: 0 auto;
  display: block;
  color: var(--text-sub);
  line-height: 1.7;
  text-align: center;
}

@media (max-width: 900px) {
  .hero {
    padding: 20px 12px 8px;
  }
}

@media (max-width: 640px) {
  .hero {
    padding: 16px 10px 6px;
  }

  :deep(.hero__title) {
    font-size: 22px !important;
  }

  .hero__sub {
    font-size: 13px;
    line-height: 1.65;
  }
}
</style>
