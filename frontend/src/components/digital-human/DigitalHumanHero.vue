<script setup lang="ts">
import { NGradientText, NSpace, NTag, NText } from 'naive-ui'
</script>

<template>
  <section class="hero">
    <n-space vertical :size="14" align="center">
      <n-tag size="small" round type="success" bordered>第 1 步 · 必做</n-tag>
      <n-gradient-text :size="30" type="info">创建你的专属数字人</n-gradient-text>
      <n-text style="max-width: 560px; text-align: center; line-height: 1.75" depth="2">
        进入产品后请先完成本步骤：上传面部清晰的自拍照并选择风格，系统会生成并保存你的数字人形象。
        完成后即可进入「口播制作」粘贴视频链接、解析口播与成片。
      </n-text>
    </n-space>
  </section>
</template>

<style scoped>
.hero {
  position: relative;
  z-index: 1;
  max-width: 860px;
  margin: 0 auto;
  padding: 20px 16px 4px;
  text-align: center;
}

.hero::before {
  position: absolute;
  top: 0;
  left: 50%;
  width: min(620px, 88vw);
  height: 120px;
  pointer-events: none;
  content: '';
  background:
    radial-gradient(circle at 50% 0%, rgba(56, 189, 248, 0.18), transparent 38%),
    radial-gradient(circle at 28% 26%, rgba(236, 72, 153, 0.14), transparent 32%);
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

.hero :deep(.n-text) {
  color: #cbd5e1;
}
</style>
