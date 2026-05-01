<script setup lang="ts">
import { NButton, NCard, NSpace, NText } from 'naive-ui'
import { useRouter } from 'vue-router'
import { useUserStore } from '@/stores/user'

const router = useRouter()
const user = useUserStore()

function logout() {
  user.clearSession()
  void router.push({ name: 'login' })
}
</script>

<template>
  <div class="wrap">
    <n-card title="账号审核中" class="card" size="large">
      <n-space vertical :size="14">
        <n-text>
          当前账号状态为「待开通」，管理员审核通过前无法使用专属数字人、口播制作、任务与作品等功能。
        </n-text>
        <n-text depth="3" style="font-size: 13px">
          审核完成后请重新登录或刷新页面。如有疑问请联系管理员。
        </n-text>
        <n-button type="primary" block @click="logout">退出登录</n-button>
      </n-space>
    </n-card>
  </div>
</template>

<style scoped>
.wrap {
  max-width: 460px;
  margin: 48px auto;
  padding: 0 16px;
}

.card {
  background: rgba(15, 23, 42, 0.96);
  border: 1px solid rgba(148, 163, 184, 0.35);
}
</style>
