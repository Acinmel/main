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
  padding: 36px 16px 12px;
  text-align: center;
}
</style>
