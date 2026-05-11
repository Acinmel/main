<script setup lang="ts">
import { NButton, NCard, NForm, NFormItem, NInput, NTag, useMessage } from 'naive-ui'
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

const proofs = ['任务继续生成', '作品统一管理', '素材快速复用']

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
    void router.push({ name: 'resource-library' })
  } catch (e: unknown) {
    message.error(describeHttpOrNetworkError(e))
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="auth-page page-entrance">
    <section class="auth-page__hero glass-panel">
      <div class="auth-page__copy">
        <n-tag :bordered="false" class="auth-page__eyebrow">
          AI VIDEO GENERATION WORKBENCH
        </n-tag>
        <h1>回到你的 AI 数字人创作工作台</h1>
        <p>登录后继续管理专属数字人、口播任务、文案提取与 AI 改写流程。</p>
        <div class="auth-page__proofs">
          <span v-for="item in proofs" :key="item">{{ item }}</span>
        </div>
      </div>

      <n-card class="auth-page__card" size="large" :bordered="false">
        <template #header>
          <div class="auth-page__card-head">
            <span>登录账号</span>
            <p>使用已审核通过的邮箱账号进入工作台。</p>
          </div>
        </template>

        <n-form label-placement="top">
          <n-form-item label="邮箱">
            <n-input v-model:value="form.email" clearable placeholder="name@example.com" />
          </n-form-item>
          <n-form-item label="密码">
            <n-input
              v-model:value="form.password"
              type="password"
              show-password-on="click"
              placeholder="请输入密码"
            />
          </n-form-item>

          <n-button
            type="primary"
            block
            size="large"
            class="auth-page__submit"
            :loading="loading"
            @click="handleSubmit"
          >
            登录
          </n-button>

          <router-link :to="{ name: 'register', query: route.query }" class="auth-page__link">
            还没有账号？去注册
          </router-link>
        </n-form>
      </n-card>
    </section>
  </div>
</template>

<style scoped>
.auth-page {
  min-height: 100%;
}

.auth-page__hero {
  display: grid;
  grid-template-columns: minmax(0, 1.08fr) minmax(360px, 430px);
  gap: 34px;
  align-items: center;
  min-height: calc(100vh - 168px);
  padding: 34px;
}

.auth-page__copy {
  position: relative;
  overflow: hidden;
  min-height: 100%;
  padding: 34px;
  border-radius: 34px;
  background:
    radial-gradient(circle at 16% 12%, rgba(75, 107, 255, 0.2), transparent 22%),
    radial-gradient(circle at 84% 18%, rgba(75, 199, 187, 0.18), transparent 22%),
    linear-gradient(135deg, rgba(29, 43, 71, 0.92), rgba(93, 114, 151, 0.56) 54%, rgba(244, 247, 251, 0.8));
  box-shadow: var(--shadow-panel);
}

.auth-page__copy::after {
  position: absolute;
  inset: 0;
  pointer-events: none;
  content: '';
  background-image:
    linear-gradient(rgba(255, 255, 255, 0.08) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.08) 1px, transparent 1px);
  background-size: 44px 44px;
  mask-image: linear-gradient(to bottom, rgba(0, 0, 0, 0.62), transparent 88%);
}

.auth-page__eyebrow {
  position: relative;
  z-index: 1;
  color: #9fc3ff;
  font-family: var(--font-accent);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.2em;
  background: rgba(255, 255, 255, 0.08);
}

.auth-page h1,
.auth-page p {
  position: relative;
  z-index: 1;
  margin: 0;
}

.auth-page h1 {
  max-width: 620px;
  margin-top: 26px;
  color: var(--text-inverse);
  font-family: var(--font-display);
  font-size: clamp(42px, 6vw, 76px);
  line-height: 1.04;
  letter-spacing: -0.05em;
}

.auth-page__copy p {
  max-width: 580px;
  margin-top: 18px;
  color: rgba(241, 246, 255, 0.78);
  font-size: 20px;
  line-height: 1.8;
}

.auth-page__proofs {
  position: relative;
  z-index: 1;
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 30px;
}

.auth-page__proofs span {
  padding: 9px 14px;
  border: 1px solid rgba(255, 255, 255, 0.22);
  border-radius: 999px;
  color: #dbe7ff;
  background: rgba(255, 255, 255, 0.08);
}

.auth-page__card {
  padding-top: 8px;
}

.auth-page__card-head span {
  display: block;
  color: var(--text-main);
  font-family: var(--font-display);
  font-size: 24px;
  font-weight: 700;
}

.auth-page__card-head p {
  margin-top: 8px;
  color: var(--text-sub);
  font-size: 14px;
  line-height: 1.7;
}

.auth-page__submit {
  margin-top: 6px;
  min-height: 50px;
}

.auth-page__link {
  display: block;
  margin-top: 16px;
  color: var(--primary);
  text-align: center;
}

.auth-page__link:hover {
  color: var(--primary-hover);
}

.auth-page :deep(.n-form-item-label__text) {
  color: var(--text-sub);
}

.auth-page :deep(.n-input) {
  --n-color: rgba(247, 250, 255, 0.96) !important;
  --n-color-focus: rgba(255, 255, 255, 1) !important;
  --n-border: 1px solid rgba(121, 144, 184, 0.2) !important;
  --n-border-hover: 1px solid rgba(75, 107, 255, 0.34) !important;
  --n-border-focus: 1px solid rgba(75, 107, 255, 0.46) !important;
  --n-box-shadow-focus: 0 0 0 3px rgba(75, 107, 255, 0.12) !important;
}

@media (max-width: 980px) {
  .auth-page__hero {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 640px) {
  .auth-page__hero {
    padding: 18px;
  }

  .auth-page__copy {
    padding: 24px 20px;
  }

  .auth-page h1 {
    font-size: 40px;
  }

  .auth-page__copy p {
    font-size: 16px;
  }
}
</style>
