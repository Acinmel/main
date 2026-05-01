<script setup lang="ts">
import { NButton, NCard, NSpace, NText } from 'naive-ui'
import { useRouter } from 'vue-router'
import { useUserStore } from '@/stores/user'

const router = useRouter()
const user = useUserStore()

function goReLogin() {
  user.clearSession()
  void router.push({ name: 'login', query: { redirect: '/admin/dashboard' } })
}
</script>

<template>
  <div class="wrap">
    <n-card title="需要管理员权限" class="card" :bordered="false">
      <n-space vertical :size="16">
        <n-text>
          当前登录账号不是<strong>管理员</strong>，无法打开运营管理后台。
        </n-text>
        <n-text depth="3">
          若你是部署者：请在后端环境变量中配置
          <code>ADMIN_EMAILS</code>（为你的注册邮箱，逗号分隔多个），保存后<strong>重启 API 服务</strong>，再在此处刷新或重新进入后台。
        </n-text>
        <n-text depth="3">
          若已由其他管理员开通：请对方在「用户审核」中将你的角色设为管理员，或<strong>退出后重新登录</strong>以刷新权限。
        </n-text>
        <n-space>
          <n-button type="primary" @click="router.push({ name: 'home' })">返回专属数字人</n-button>
          <n-button @click="goReLogin">重新登录（刷新管理员权限）</n-button>
        </n-space>
      </n-space>
    </n-card>
  </div>
</template>

<style scoped>
.wrap {
  box-sizing: border-box;
  min-height: 100vh;
  padding: 48px 20px;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  background: linear-gradient(180deg, #0b1224 0%, #020617 100%);
}
.card {
  max-width: 560px;
  background: rgba(15, 23, 42, 0.85) !important;
  border: 1px solid rgba(148, 163, 184, 0.15) !important;
}
.card :deep(code) {
  padding: 2px 8px;
  border-radius: 6px;
  background: rgba(56, 189, 248, 0.12);
  font-size: 13px;
}
</style>
