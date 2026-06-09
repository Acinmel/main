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
  phoneNumber: '',
  idCardNumber: '',
})

const proofs = ['数字人形象', '口播任务', 'AI 改写']

async function handleSubmit() {
  if (!form.email?.trim() || !form.password || !form.phoneNumber?.trim() || !form.idCardNumber?.trim()) {
    message.warning('请填写邮箱、密码、手机号和身份证号')
    return
  }
  if (form.password.length < 8) {
    message.warning('密码至少 8 位')
    return
  }
  const normalizedPhone = form.phoneNumber.replace(/\s+/g, '')
  if (!/^1\d{10}$/.test(normalizedPhone)) {
    message.warning('请输入 11 位手机号')
    return
  }
  const normalizedIdCard = form.idCardNumber.trim().toUpperCase()
  if (!/^\d{17}[\dX]$/.test(normalizedIdCard)) {
    message.warning('请输入 18 位身份证号')
    return
  }
  loading.value = true
  try {
    const res = await registerAuth({
      email: form.email.trim(),
      password: form.password,
      phoneNumber: normalizedPhone,
      idCardNumber: normalizedIdCard,
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
  <div class="auth-page page-entrance">
    <section class="auth-page__hero glass-panel">
      <div class="auth-page__copy auth-page__copy--register">
        <n-tag :bordered="false" class="auth-page__eyebrow">
          AI VIDEO GENERATION WORKBENCH
        </n-tag>
        <h1>创建你的 AI 数字人工作台账号</h1>
        <p>
          注册后即可进入创作工作台，素材、声音和成片流程都归属当前账号。
        </p>
        <div class="auth-page__proofs">
          <span v-for="item in proofs" :key="item">{{ item }}</span>
        </div>
      </div>

      <n-card class="auth-page__card" size="large" :bordered="false">
        <template #header>
          <div class="auth-page__card-head">
            <span>注册账号</span>
            <p>注册后会自动登录，新账号默认进入待审核状态。</p>
          </div>
        </template>

        <n-form label-placement="top">
          <n-form-item label="邮箱">
            <n-input
              v-model:value="form.email"
              clearable
              placeholder="name@example.com"
            />
          </n-form-item>
          <n-form-item label="密码">
            <n-input
              v-model:value="form.password"
              type="password"
              show-password-on="click"
              placeholder="至少 8 位密码"
            />
          </n-form-item>
          <n-form-item label="手机号">
            <n-input
              v-model:value="form.phoneNumber"
              clearable
              maxlength="11"
              placeholder="11 位手机号"
            />
          </n-form-item>
          <n-form-item label="身份证号">
            <n-input
              v-model:value="form.idCardNumber"
              type="password"
              show-password-on="click"
              placeholder="18 位身份证号"
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
            注册并登录
          </n-button>

          <n-text depth="3" class="auth-page__notice">
            普通用户默认只进入前台工作台，后台仅固定管理员账号可见。
          </n-text>
          <router-link
            :to="{ name: 'login', query: route.query }"
            class="auth-page__link"
          >
            已有账号？去登录
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
    radial-gradient(
      circle at 12% 10%,
      rgba(75, 107, 255, 0.18),
      transparent 20%
    ),
    radial-gradient(
      circle at 82% 20%,
      rgba(75, 199, 187, 0.16),
      transparent 22%
    ),
    linear-gradient(
      135deg,
      rgba(35, 48, 76, 0.88),
      rgba(92, 112, 150, 0.54) 52%,
      rgba(244, 247, 251, 0.8)
    );
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

.auth-page__copy--register {
  background:
    radial-gradient(
      circle at 16% 10%,
      rgba(75, 107, 255, 0.16),
      transparent 18%
    ),
    radial-gradient(
      circle at 86% 20%,
      rgba(239, 177, 75, 0.18),
      transparent 22%
    ),
    linear-gradient(
      135deg,
      rgba(33, 45, 72, 0.9),
      rgba(104, 116, 148, 0.56) 52%,
      rgba(244, 247, 251, 0.8)
    );
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
  font-size: clamp(42px, 6vw, 72px);
  line-height: 1.04;
  letter-spacing: -0.05em;
}

.auth-page__copy p {
  max-width: 580px;
  margin-top: 18px;
  color: rgba(241, 246, 255, 0.8);
  font-size: 19px;
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

.auth-page__notice {
  display: block;
  margin-top: 14px;
  font-size: 12px;
  line-height: 1.7;
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
