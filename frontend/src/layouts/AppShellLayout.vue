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
const isLanding = computed(() => route.name === 'landing')

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
    <aside v-if="!isLanding" class="shell__sidebar">
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
          <template v-if="user.isLoggedIn">
            <RouterLink :to="{ name: 'home' }" class="shell__nav-link">专属数字人</RouterLink>
            <RouterLink :to="{ name: 'exclusive-voice' }" class="shell__nav-link">专属声音</RouterLink>
            <RouterLink :to="{ name: 'resource-library' }" class="shell__nav-link">资源库</RouterLink>
            <RouterLink :to="{ name: 'studio' }" class="shell__nav-link">视频创作</RouterLink>
          </template>
        </template>
      </nav>

      <div class="shell__account">
        <template v-if="user.isLoggedIn">
          <n-button block quaternary size="small" @click="logout">退出</n-button>
        </template>
        <template v-else>
          <RouterLink to="/login">
            <n-button block size="small" type="primary" quaternary>登录</n-button>
          </RouterLink>
          <RouterLink to="/register">
            <n-button block size="small" type="primary">注册</n-button>
          </RouterLink>
        </template>
      </div>
    </aside>

    <n-alert
      v-if="isPendingNonAdmin && route.name !== 'account-pending'"
      type="warning"
      show-icon
      class="shell__banner"
    >
      账号待管理员审核，开通后方可使用专属数字人、口播制作、任务与作品功能。
    </n-alert>

    <main :class="['shell__main', { 'shell__main--with-sidebar': !isLanding }]">
      <RouterView />
    </main>

    <footer v-if="!isLanding" class="shell__footer">
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
  --sidebar-width: 224px;
  color: var(--text-main);
  background:
    radial-gradient(circle at 84% 14%, rgba(0, 210, 106, 0.12), transparent 28%),
    radial-gradient(circle at 38% 54%, rgba(22, 242, 139, 0.06), transparent 36%),
    linear-gradient(135deg, #000302 0%, var(--bg-main) 42%, #000000 100%);
}

.shell__sidebar {
  position: fixed;
  top: 0;
  bottom: 0;
  left: 0;
  z-index: 100;
  display: flex;
  flex-direction: column;
  gap: 18px;
  width: var(--sidebar-width);
  padding: max(18px, var(--app-safe-top, 0px)) 16px max(18px, var(--app-safe-bottom, 0px));
  border-right: 1px solid var(--border-soft);
  background:
    linear-gradient(180deg, rgba(8, 28, 21, 0.9), rgba(2, 8, 6, 0.94)),
    rgba(0, 0, 0, 0.72);
  box-shadow:
    inset -1px 0 0 rgba(255, 255, 255, 0.03),
    10px 0 34px rgba(0, 0, 0, 0.34);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
}

.shell__sidebar::before {
  position: absolute;
  inset: 0;
  pointer-events: none;
  content: '';
  background:
    radial-gradient(circle at 0% 12%, rgba(22, 242, 139, 0.14), transparent 34%),
    radial-gradient(circle at 100% 82%, rgba(0, 210, 106, 0.12), transparent 30%);
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
  color: var(--text-main);
  text-decoration: none;
  transition: transform var(--transition-smooth);
}

.shell__brand:hover {
  transform: translateX(2px);
}

.shell__logo {
  width: 30px;
  height: 30px;
  border: 1px solid rgba(22, 242, 139, 0.28);
  border-radius: 10px;
  background:
    radial-gradient(circle at 30% 22%, rgba(255, 255, 255, 0.38), transparent 18%),
    linear-gradient(135deg, var(--primary), var(--primary-deep) 52%, #0ea766);
  box-shadow: 0 0 20px rgba(22, 242, 139, 0.34);
}

.shell__title-stack :deep(> *:first-child) {
  color: var(--text-main);
  letter-spacing: 0.04em;
}

.shell__title-stack :deep(> *:last-child) {
  color: var(--text-light);
}

.shell__nav {
  position: relative;
  z-index: 1;
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: stretch;
  gap: 10px;
  font-size: 13px;
  color: var(--text-sub);
}

.shell__nav a {
  color: inherit;
  text-decoration: none;
}

.shell__nav-link {
  display: block;
  padding: 10px 12px;
  border: 1px solid transparent;
  border-radius: 14px;
  transition:
    color 0.2s ease,
    border-color 0.2s ease,
    background 0.2s ease,
    box-shadow 0.2s ease,
    transform var(--transition-smooth);
}

.shell__nav-link:hover {
  color: var(--primary);
  border-color: rgba(22, 242, 139, 0.3);
  background: rgba(22, 242, 139, 0.1);
  box-shadow:
    inset 0 0 0 1px rgba(22, 242, 139, 0.08),
    0 14px 28px rgba(22, 242, 139, 0.08);
  transform: translateX(4px);
}

.shell__nav-link.router-link-active {
  color: var(--primary);
  font-weight: 600;
  border-color: var(--border-strong);
  background:
    radial-gradient(circle at 0% 50%, rgba(22, 242, 139, 0.18), transparent 46%),
    rgba(22, 242, 139, 0.1);
  box-shadow:
    inset 0 0 0 1px rgba(22, 242, 139, 0.1),
    0 0 26px rgba(22, 242, 139, 0.12);
}

.shell__account {
  position: relative;
  z-index: 1;
  display: grid;
  gap: 8px;
}

.shell__account a {
  text-decoration: none;
}

.shell__banner {
  margin-left: var(--sidebar-width);
}

.shell__main {
  min-height: 100vh;
  min-height: 100dvh;
}

.shell__main--with-sidebar {
  margin-left: var(--sidebar-width);
}

.shell__footer {
  margin-left: var(--sidebar-width);
  padding: 10px 32px 16px;
  padding-bottom: max(16px, var(--app-safe-bottom, 0px));
  text-align: center;
}

@media (max-width: 900px) {
  .shell {
    --sidebar-width: 188px;
  }

  .shell__sidebar {
    padding-left: 12px;
    padding-right: 12px;
  }

  .shell__footer {
    padding-left: 16px;
    padding-right: 16px;
  }
}

@media (max-width: 640px) {
  .shell {
    --sidebar-width: 92px;
  }

  .shell__brand {
    justify-content: center;
    flex-direction: column;
    gap: 8px;
  }

  .shell__title-stack {
    justify-content: center;
  }

  .shell__title-stack :deep(> *:first-child),
  .shell__title-stack :deep(> *:last-child) {
    display: none;
  }

  .shell__nav {
    font-size: 11px;
    gap: 8px;
  }

  .shell__nav-link {
    padding: 9px 6px;
    text-align: center;
  }

  .shell__footer {
    padding-bottom: max(20px, var(--app-safe-bottom, 0px));
  }
}
</style>
