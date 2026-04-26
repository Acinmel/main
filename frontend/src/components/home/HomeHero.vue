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
  padding: 28px 16px 10px;
  text-align: center;
  width: 100%;
  box-sizing: border-box;
}

.hero__sub {
  max-width: 640px;
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
