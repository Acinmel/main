<script setup lang="ts">
import { NButton, NCard, NForm, NFormItem, NInput, NSpace, useMessage } from 'naive-ui'
import { reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { loginAuth } from '@/api/auth'
import { useUserStore } from '@/stores/user'
import { describeHttpOrNetworkError } from '@/utils/httpErrorMessage'

const router = useRouter()
const route = useRoute()
const message = useMessage()
const user = useUserStore()
const loading = ref(false)

const form = reactive({
  email: '',
  password: '',
})

async function handleSubmit() {
  if (!form.email?.trim() || !form.password) {
    message.warning('请填写邮箱和密码')
    return
  }
  loading.value = true
  try {
    const res = await loginAuth({
      email: form.email.trim(),
      password: form.password,
    })
    user.setSession(res.token, res.user)
    message.success('登录成功')

    const redirect = route.query.redirect
    if (typeof redirect === 'string' && redirect.startsWith('/')) {
      void router.push(redirect)
      return
    }
    const next = route.query.next
    if (next === 'task-create') {
      void router.push({ name: 'task-create' })
      return
    }
    void router.push({ name: 'works' })
  } catch (e: unknown) {
    message.error(describeHttpOrNetworkError(e))
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="wrap">
    <n-card title="登录" class="card" size="large">
      <n-form label-placement="top">
        <n-form-item label="邮箱">
          <n-input v-model:value="form.email" placeholder="name@example.com" />
        </n-form-item>
        <n-form-item label="密码">
          <n-input v-model:value="form.password" type="password" show-password-on="click" />
        </n-form-item>
        <n-space vertical :size="12" style="width: 100%">
          <n-button type="primary" block size="large" :loading="loading" @click="handleSubmit">
            登录
          </n-button>
          <router-link :to="{ name: 'register', query: route.query }" class="link">还没有账号？去注册</router-link>
        </n-space>
      </n-form>
    </n-card>
  </div>
</template>

<style scoped>
.wrap {
  max-width: 420px;
  margin: 40px auto;
  padding: 0 16px;
}

.card {
  background: rgba(15, 23, 42, 0.96);
  border: 1px solid rgba(148, 163, 184, 0.35);
}

.link {
  font-size: 13px;
  color: #7dd3fc;
  text-align: center;
  display: block;
}

@media (max-width: 480px) {
  .wrap {
    max-width: 100%;
    margin: 16px auto 32px;
    padding: 0 max(12px, var(--app-safe-left, 0px)) 0 max(12px, var(--app-safe-right, 0px));
  }
}
</style>
