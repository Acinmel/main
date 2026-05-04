<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router'
import { NAlert, NButton, NText } from 'naive-ui'
import { useDigitalHumanStore } from '@/stores/digitalHuman'
import { useTaskDraftStore } from '@/stores/taskDraft'
import { useUserStore } from '@/stores/user'

const route = useRoute()
const router = useRouter()
const user = useUserStore()
const draft = useTaskDraftStore()
const digitalHuman = useDigitalHumanStore()

const isPendingNonAdmin = computed(
  () => user.profile?.accountStatus === 'pending' && user.profile?.role !== 'admin',
)

const brandTo = computed(() =>
  isPendingNonAdmin.value ? { name: 'account-pending' as const } : { name: 'landing' as const },
)

async function clearBrowserCaches() {
  sessionStorage.clear()
  if (!('caches' in window)) return
  const keys = await caches.keys()
  await Promise.all(keys.map((key) => caches.delete(key)))
}

async function logout() {
  draft.reset()
  digitalHuman.clearLocalCache()
  user.clearSession()
  try {
    await clearBrowserCaches()
  } catch {
    // Cache API may be unavailable or blocked; session cleanup above is still enough to log out.
  }
  void router.replace({ name: 'landing' })
}

onMounted(() => {
  void user.hydrateProfile()
})
</script>

<template>
  <div class="shell">
    <header class="shell__header">
      <RouterLink :to="brandTo" class="shell__brand">
        <span class="shell__logo" aria-hidden="true" />
        <span class="shell__title-stack">
          <n-text strong>口播重制</n-text>
          <n-text depth="3" style="margin-left: 8px; font-size: 12px">Koubo Remake</n-text>
        </span>
      </RouterLink>

      <nav class="shell__nav">
        <template v-if="isPendingNonAdmin">
          <RouterLink :to="{ name: 'account-pending' }" class="shell__nav-link">账号审核</RouterLink>
        </template>
        <template v-else>
          <RouterLink :to="{ name: 'landing' }" class="shell__nav-link">首页</RouterLink>
          <RouterLink :to="{ name: 'works' }" class="shell__nav-link">作品展示</RouterLink>
          <template v-if="user.isLoggedIn">
            <RouterLink :to="{ name: 'home' }" class="shell__nav-link">专属数字人</RouterLink>
            <RouterLink :to="{ name: 'studio' }" class="shell__nav-link">口播制作</RouterLink>
          </template>
        </template>
        <template v-if="user.isLoggedIn">
          <n-button quaternary size="small" @click="logout">退出</n-button>
        </template>
        <template v-else>
          <RouterLink to="/login">
            <n-button size="small" type="primary" quaternary>登录</n-button>
          </RouterLink>
          <RouterLink to="/register">
            <n-button size="small" type="primary">注册</n-button>
          </RouterLink>
        </template>
      </nav>
    </header>

    <n-alert
      v-if="isPendingNonAdmin && route.name !== 'account-pending'"
      type="warning"
      show-icon
      class="shell__banner"
    >
      账号待管理员审核，开通后方可使用专属数字人、口播制作、任务与作品功能。
    </n-alert>

    <main class="shell__main">
      <RouterView />
    </main>

    <footer class="shell__footer">
      <n-text class="shell__footer-txt" depth="3" style="font-size: 12px">
        MVP · 短视频口播重制工具
      </n-text>
    </footer>
  </div>
</template>

<style scoped>
.shell {
  min-height: 100vh;
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  background: radial-gradient(circle at top, #0f172a 0, #020617 55%, #000 100%);
}

.shell__header {
  position: sticky;
  top: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 10px 18px;
  min-height: 64px;
  padding: 12px 32px;
  padding-top: max(12px, var(--app-safe-top, 0px));
  padding-left: max(32px, var(--app-safe-left, 0px));
  padding-right: max(32px, var(--app-safe-right, 0px));
  border-bottom: 1px solid rgba(216, 180, 254, 0.2);
  background:
    linear-gradient(90deg, rgba(236, 72, 153, 0.08), rgba(56, 189, 248, 0.08)),
    rgba(5, 3, 13, 0.76);
  box-shadow:
    0 16px 42px rgba(0, 0, 0, 0.36),
    inset 0 -1px 0 rgba(125, 211, 252, 0.08);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
}

.shell__header::before {
  position: absolute;
  inset: 0;
  pointer-events: none;
  content: '';
  background:
    radial-gradient(circle at 12% 0%, rgba(168, 85, 247, 0.18), transparent 32%),
    radial-gradient(circle at 86% 0%, rgba(56, 189, 248, 0.14), transparent 28%);
}

.shell__title-stack {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 4px;
  min-width: 0;
}

.shell__brand {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  position: relative;
  z-index: 1;
  color: #f8fafc;
  text-decoration: none;
}

.shell__logo {
  width: 30px;
  height: 30px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 10px;
  background:
    radial-gradient(circle at 30% 22%, rgba(255, 255, 255, 0.88), transparent 18%),
    linear-gradient(135deg, #ec4899, #8b5cf6 52%, #38bdf8);
  box-shadow:
    0 0 22px rgba(56, 189, 248, 0.52),
    0 0 34px rgba(236, 72, 153, 0.28);
}

.shell__title-stack :deep(> *:first-child) {
  color: #f8fafc;
  letter-spacing: 0.04em;
}

.shell__title-stack :deep(> *:last-child) {
  color: #a5b4fc;
}

.shell__nav {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 13px;
  color: #cbd5f5;
  max-width: 100%;
}

.shell__nav a {
  color: inherit;
  text-decoration: none;
}

.shell__nav-link {
  padding: 7px 11px;
  border: 1px solid transparent;
  border-radius: 999px;
  transition:
    color 0.2s ease,
    border-color 0.2s ease,
    background 0.2s ease,
    box-shadow 0.2s ease;
}

.shell__nav-link:hover {
  color: #e0f2fe;
  border-color: rgba(125, 211, 252, 0.28);
  background: rgba(15, 23, 42, 0.56);
  box-shadow: 0 0 22px rgba(56, 189, 248, 0.14);
}

.shell__nav-link.router-link-active {
  color: #7dd3fc;
  font-weight: 600;
  border-color: rgba(125, 211, 252, 0.38);
  background: rgba(14, 165, 233, 0.12);
}

.shell__main {
  flex: 1;
}

.shell__footer {
  padding: 10px 32px 16px;
  padding-bottom: max(16px, var(--app-safe-bottom, 0px));
  text-align: center;
}

@media (max-width: 900px) {
  .shell__header {
    padding: 10px 16px;
    padding-top: max(10px, var(--app-safe-top, 0px));
    padding-left: max(16px, var(--app-safe-left, 0px));
    padding-right: max(16px, var(--app-safe-right, 0px));
  }

  .shell__footer {
    padding-left: 16px;
    padding-right: 16px;
  }
}

@media (max-width: 640px) {
  .shell__header {
    flex-direction: column;
    align-items: stretch;
  }

  .shell__brand {
    justify-content: center;
  }

  .shell__title-stack {
    justify-content: center;
  }

  /* 小屏只保留主标题，副标题隐藏（避免顶栏过挤） */
  .shell__title-stack :deep(> *:last-child) {
    display: none;
  }

  .shell__nav {
    justify-content: center;
    font-size: 12px;
    row-gap: 6px;
  }

  .shell__footer {
    padding-bottom: max(20px, var(--app-safe-bottom, 0px));
  }
}
</style>
