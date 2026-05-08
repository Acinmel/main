<script setup lang="ts">
import {
  NButton,
  NCard,
  NForm,
  NFormItem,
  NInput,
  NTag,
  NText,
  useMessage,
} from 'naive-ui'
import { reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { registerAuth } from '@/api/auth'
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
  if (form.password.length < 8) {
    message.warning('密码至少 8 位')
    return
  }
  loading.value = true
  try {
    const res = await registerAuth({
      email: form.email.trim(),
      password: form.password,
    })
    user.setSession(res.token, res.user)
    message.success('注册成功，已自动登录')
    const redirect = route.query.redirect
    if (typeof redirect === 'string' && redirect.startsWith('/')) {
      void router.push(redirect)
      return
    }
    void router.push({ name: 'home' })
  } catch (e: unknown) {
    message.error(describeHttpOrNetworkError(e))
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="register">
    <section class="register__shell">
      <div class="register__copy">
        <n-tag :bordered="false" class="register__eyebrow">AI VIDEO GENERATION WORKBENCH</n-tag>
        <h1>创建你的 AI 数字人工作台账号</h1>
        <p>
          注册后即可进入审核流程，开通后使用专属数字人、口播文案提取与 AI 改写能力。
        </p>
        <div class="register__proof">
          <span>数字人形象</span>
          <span>口播任务</span>
          <span>AI 改写</span>
        </div>
      </div>

      <n-card class="register__card" size="large" :bordered="false">
        <template #header>
          <div class="register__card-head">
            <span>注册账号</span>
            <p>使用邮箱创建账号，提交后默认等待管理员审核。</p>
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
              placeholder="至少 8 位密码"
            />
          </n-form-item>

          <n-button
            type="primary"
            block
            size="large"
            class="register__submit"
            :loading="loading"
            @click="handleSubmit"
          >
            注册并登录
          </n-button>

          <n-text depth="3" class="register__notice">
            新账号默认待管理员审核，开通后方可使用专属数字人、口播与任务等功能。
          </n-text>
          <router-link :to="{ name: 'login', query: route.query }" class="register__link">
            已有账号？去登录
          </router-link>
        </n-form>
      </n-card>
    </section>
  </div>
</template>

<style scoped>
.register {
  position: relative;
  min-height: calc(100vh - 64px);
  overflow: hidden;
  padding: 72px 24px 88px;
  color: #f8fafc;
  font-family: var(--font-sans);
  background:
    radial-gradient(circle at 18% 10%, rgba(22, 242, 139, 0.18), transparent 30%),
    radial-gradient(circle at 82% 8%, rgba(0, 210, 106, 0.12), transparent 28%),
    radial-gradient(circle at 72% 70%, rgba(22, 242, 139, 0.08), transparent 28%),
    linear-gradient(135deg, #000302 0%, var(--bg-main) 42%, #000000 100%);
}

.register::before {
  position: absolute;
  inset: 0;
  pointer-events: none;
  content: '';
  background-image:
    linear-gradient(rgba(148, 163, 184, 0.06) 1px, transparent 1px),
    linear-gradient(90deg, rgba(148, 163, 184, 0.06) 1px, transparent 1px);
  background-size: 48px 48px;
  mask-image: linear-gradient(to bottom, rgba(0, 0, 0, 0.85), transparent 82%);
}

.register__shell {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(360px, 440px);
  gap: 44px;
  align-items: center;
  width: min(1080px, 100%);
  min-height: 560px;
  margin: 0 auto;
}

.register__copy {
  max-width: 620px;
}

.register__eyebrow {
  color: var(--primary);
  background: rgba(22, 242, 139, 0.1);
  box-shadow: 0 0 24px rgba(22, 242, 139, 0.18);
}

.register h1,
.register p {
  margin: 0;
}

.register h1 {
  margin-top: 28px;
  font-family: var(--font-display);
  font-size: clamp(38px, 6vw, 68px);
  line-height: 1.08;
  letter-spacing: 1px;
}

.register__copy p {
  max-width: 560px;
  margin-top: 18px;
  color: var(--text-sub);
  font-size: 18px;
  line-height: 1.8;
}

.register__proof {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 28px;
  color: var(--primary);
  font-size: 13px;
}

.register__proof span {
  padding: 7px 11px;
  border: 1px solid rgba(22, 242, 139, 0.24);
  border-radius: 999px;
  background: rgba(22, 242, 139, 0.08);
  transition:
    border-color var(--transition-fast),
    background var(--transition-fast),
    transform var(--transition-smooth);
}

.register__proof span:hover {
  border-color: var(--border-strong);
  background: rgba(22, 242, 139, 0.12);
  transform: translateY(-2px);
}

.register__card {
  border: 1px solid var(--border-soft);
  border-radius: 30px;
  background: linear-gradient(145deg, rgba(8, 28, 21, 0.84), rgba(2, 10, 7, 0.78));
  box-shadow:
    0 30px 90px rgba(0, 0, 0, 0.55),
    0 0 70px rgba(22, 242, 139, 0.13);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
  transition:
    border-color var(--transition-fast),
    box-shadow var(--transition-fast),
    transform var(--transition-smooth);
}

.register__card:hover {
  border-color: var(--border-strong);
  box-shadow:
    0 30px 90px rgba(0, 0, 0, 0.58),
    0 0 70px rgba(22, 242, 139, 0.18);
  transform: translateY(-4px);
}

.register__card-head span {
  display: block;
  color: #f8fafc;
  font-size: 22px;
  font-weight: 700;
}

.register__card-head p {
  margin-top: 8px;
  color: var(--text-sub);
  font-size: 13px;
  line-height: 1.6;
}

.register__submit {
  margin-top: 4px;
  border: 0;
  color: #02110a;
  background: linear-gradient(135deg, var(--primary), var(--primary-deep));
  box-shadow: 0 0 32px rgba(22, 242, 139, 0.22);
}

.register__notice {
  display: block;
  margin-top: 14px;
  font-size: 12px;
  line-height: 1.55;
}

.register__link {
  display: block;
  margin-top: 14px;
  color: var(--primary);
  font-size: 13px;
  text-align: center;
}

.register__link:hover {
  color: var(--primary-hover);
}

.register :deep(.n-form-item-label__text) {
  color: #e2e8f0;
}

.register :deep(.n-input) {
  --n-color: rgba(0, 0, 0, 0.22) !important;
  --n-color-focus: rgba(0, 0, 0, 0.32) !important;
  --n-border: 1px solid rgba(22, 242, 139, 0.2) !important;
  --n-border-hover: 1px solid rgba(22, 242, 139, 0.48) !important;
  --n-border-focus: 1px solid rgba(22, 242, 139, 0.7) !important;
  --n-box-shadow-focus: 0 0 0 2px rgba(22, 242, 139, 0.14) !important;
}

@media (max-width: 480px) {
  .register {
    padding: 0 max(12px, var(--app-safe-left, 0px)) 0 max(12px, var(--app-safe-right, 0px));
  }

  .register__shell {
    grid-template-columns: 1fr;
    gap: 24px;
    min-height: auto;
    padding: 34px 0 56px;
  }

  .register h1 {
    font-size: 36px;
  }
}

@media (min-width: 481px) and (max-width: 860px) {
  .register__shell {
    grid-template-columns: 1fr;
    max-width: 560px;
    min-height: auto;
  }
}
</style>
