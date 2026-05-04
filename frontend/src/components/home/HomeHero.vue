<script setup lang="ts">
import { NGradientText, NSpace, NTag, NText } from 'naive-ui'
</script>

<template>
  <section class="hero">
    <n-space vertical :size="14" align="center">
      <n-tag size="small" round type="info" bordered>第 2 步 · 口播制作</n-tag>
      <n-gradient-text class="hero__title" :size="32" type="info">把爆款口播，换成你的脸</n-gradient-text>
      <n-text class="hero__sub" depth="2">
        你已在「专属数字人」中保存形象；在此粘贴视频链接、获取信息与口播，并进入生成与任务流水线。若需更换数字人，请从顶部导航返回上一步。
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
    radial-gradient(circle at 50% 0%, rgba(56, 189, 248, 0.18), transparent 38%),
    radial-gradient(circle at 28% 26%, rgba(236, 72, 153, 0.14), transparent 32%),
    radial-gradient(circle at 72% 20%, rgba(168, 85, 247, 0.14), transparent 30%);
  filter: blur(2px);
  transform: translateX(-50%);
}

.hero :deep(.n-space) {
  position: relative;
  z-index: 1;
}

.hero :deep(.n-tag) {
  color: #e9d5ff;
  border-color: rgba(168, 85, 247, 0.36);
  background: rgba(168, 85, 247, 0.18);
  box-shadow: 0 0 24px rgba(168, 85, 247, 0.25);
}

.hero :deep(.n-gradient-text) {
  font-family: Sora, 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif;
  letter-spacing: 1px;
}

.hero__sub {
  max-width: 640px;
  color: #cbd5e1;
  line-height: 1.7;
  margin: 0 auto;
  display: block;
  text-align: center;
  padding: 0 4px;
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
