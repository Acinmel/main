<script setup lang="ts">
import { NButton, NResult } from 'naive-ui'
import { useRouter } from 'vue-router'

const router = useRouter()
</script>

<template>
  <div class="wrap">
    <n-result status="404" title="404" description="页面不存在">
      <template #footer>
        <n-button type="primary" @click="router.push({ name: 'home' })">返回首页</n-button>
      </template>
    </n-result>
  </div>
</template>

<style scoped>
.wrap {
  padding: 80px 16px;
}
</style>
