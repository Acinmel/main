<script setup lang="ts">
import { NAlert, NSpace, NText } from 'naive-ui'
</script>

<template>
  <n-alert type="default" :bordered="false" style="background: rgba(15, 23, 42, 0.9)">
    <n-space vertical :size="6">
      <n-text strong>照片要求（上传前请自查）</n-text>
      <ul class="guide-list">
        <li>单人入镜，五官完整、正脸朝向镜头</li>
        <li>光线充足、无强阴影；避免墨镜、口罩等大面积遮挡</li>
        <li>尽量高清，背景简洁更利于驱动口型</li>
        <li>支持 JPG / PNG，建议最短边不低于 512px</li>
      </ul>
      <n-text depth="3" style="font-size: 12px">
        说明：前端先做基础校验；若不符合口播驱动要求，任务会在后续步骤失败并提示你重新上传。
      </n-text>
    </n-space>
  </n-alert>
</template>

<style scoped>
.guide-list {
  margin: 0;
  padding-left: 18px;
  color: #cbd5f5;
  font-size: 13px;
  line-height: 1.7;
}
</style>
