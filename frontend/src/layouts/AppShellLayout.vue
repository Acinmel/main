<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router'
import { NButton, NIcon } from 'naive-ui'
import {
  AlbumsOutline,
  HomeOutline,
  LogInOutline,
  PersonCircleOutline,
  SparklesOutline,
  VideocamOutline,
} from '@vicons/ionicons5'
import { isFixedAdminEmail } from '@/constants/admin'
import { useDigitalHumanStore } from '@/stores/digitalHuman'
import { useTaskDraftStore } from '@/stores/taskDraft'
import { useUserStore } from '@/stores/user'

const route = useRoute()
const router = useRouter()
const user = useUserStore()
const draft = useTaskDraftStore()
const digitalHuman = useDigitalHumanStore()

const canSeeAdmin = computed(() => isFixedAdminEmail(user.profile?.email))
const isPendingNonAdmin = computed(
  () => user.profile?.accountStatus === 'pending' && !canSeeAdmin.value,
)

const navItems = computed(() => {
  if (isPendingNonAdmin.value) {
    return [
      {
        label: '账号审核',
        name: 'account-pending',
        icon: SparklesOutline,
      },
    ]
  }

  const base = [
    { label: '首页', name: 'landing', icon: HomeOutline },
    { label: '视频创作', name: 'studio', icon: VideocamOutline },
  ]

  if (!user.isLoggedIn) {
    return [
      ...base,
      { label: '登录 / 注册', name: 'login', icon: LogInOutline },
    ]
  }

  const loggedInItems = [
    ...base,
    { label: '数字人库', name: 'home', icon: PersonCircleOutline },
    { label: '资源库', name: 'resource-library', icon: AlbumsOutline },
  ]
  if (canSeeAdmin.value) {
    loggedInItems.push({ label: '后台', name: 'erp-dashboard', icon: SparklesOutline })
  }
  return loggedInItems
})

const pageTitle = computed(() => String(route.meta.title || 'AI 内容工作台'))

const primaryTo = computed(() => {
  if (isPendingNonAdmin.value) return { name: 'account-pending' as const }
  return user.isLoggedIn
    ? { name: 'studio' as const }
    : { name: 'register' as const }
})

const primaryText = computed(() =>
  user.isLoggedIn ? '立即创作' : '免费注册 / 登录',
)

const secondaryTo = computed(() => {
  if (user.isLoggedIn) return { name: 'resource-library' as const }
  return { name: 'login' as const }
})

const secondaryText = computed(() =>
  user.isLoggedIn ? '进入资源库' : '账号入口',
)

const memberTitle = computed(() => {
  if (!user.profile?.email) return '未登录'
  return user.profile.email
})

const memberSubtitle = computed(() => {
  if (!user.isLoggedIn) return 'AI Ready'
  if (canSeeAdmin.value) return '管理员已登录'
  if (user.profile?.accountStatus === 'pending') return '等待审核中'
  return '工作台已就绪'
})

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
    // ignore
  }
  void router.replace({ name: 'landing' })
}

onMounted(() => {
  if (user.token && !user.profile) {
    void user.hydrateProfile()
  }
})
</script>

<template>
  <div class="shell">
    <aside class="shell__sidebar glass-panel">
      <RouterLink :to="{ name: 'landing' }" class="shell__brand">
        <span class="shell__logo">K</span>
        <span class="shell__brand-copy">
          <strong>数字人创作智能体</strong>
          <small>AI CREATION STUDIO</small>
        </span>
      </RouterLink>

      <nav class="shell__nav" aria-label="主导航">
        <RouterLink
          v-for="item in navItems"
          :key="item.name"
          :to="{ name: item.name as never }"
          class="shell__nav-link"
        >
          <n-icon size="18">
            <component :is="item.icon" />
          </n-icon>
          <span>{{ item.label }}</span>
        </RouterLink>
      </nav>

      <section class="shell__member surface-card">
        <div class="shell__member-head">
          <span class="shell__member-badge">会员中心</span>
          <span class="shell__member-dot" />
        </div>
        <div class="shell__member-body">
          <div class="shell__member-icon">✦</div>
          <div>
            <strong>{{ memberTitle }}</strong>
            <small>{{ memberSubtitle }}</small>
          </div>
        </div>
        <div class="shell__member-footer">
          <span>AI READY</span>
          <span>{{ user.isLoggedIn ? '在线' : '24ms' }}</span>
        </div>
      </section>
    </aside>

    <div class="shell__content">
      <header class="shell__topbar glass-panel">
        <div class="shell__headline">
          <span class="shell__eyebrow">AI CONTENT WORKBENCH</span>
          <strong>{{ pageTitle }}</strong>
        </div>

        <div class="shell__actions">
          <span class="shell__hint">为短视频团队打造的 AI 内容工作台</span>
          <RouterLink :to="secondaryTo">
            <n-button secondary class="shell__secondary-action">{{
              secondaryText
            }}</n-button>
          </RouterLink>
          <RouterLink :to="primaryTo">
            <n-button type="primary" class="shell__primary-action">{{
              primaryText
            }}</n-button>
          </RouterLink>
          <n-button v-if="user.isLoggedIn" quaternary @click="logout"
            >退出</n-button
          >
        </div>
      </header>

      <main class="shell__main">
        <RouterView v-slot="{ Component, route: childRoute }">
          <Transition name="route-fade" mode="out-in">
            <component :is="Component" :key="childRoute.fullPath" />
          </Transition>
        </RouterView>
      </main>
    </div>
  </div>
</template>

<style scoped>
.shell {
  --shell-sidebar-width: 252px;
  --shell-gap: 18px;
  --shell-pad: 18px;
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: var(--shell-sidebar-width) minmax(0, 1fr);
  min-height: 100vh;
  min-height: 100dvh;
  gap: var(--shell-gap);
  padding: var(--shell-pad);
}

.shell__sidebar {
  position: sticky;
  top: 18px;
  display: flex;
  flex-direction: column;
  gap: 18px;
  height: calc(100dvh - 36px);
  padding: 16px;
}

.shell__brand {
  display: flex;
  align-items: center;
  gap: 12px;
  color: var(--text-main);
}

.shell__logo {
  display: grid;
  width: 40px;
  height: 40px;
  place-items: center;
  border-radius: 16px;
  color: #ffffff;
  font-family: var(--font-display);
  font-weight: 700;
  background: linear-gradient(135deg, var(--primary), var(--accent-teal));
  box-shadow: var(--shadow-glow);
}

.shell__brand-copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.shell__brand-copy strong {
  font-size: 14px;
  letter-spacing: 0.01em;
}

.shell__brand-copy small {
  color: var(--text-light);
  font-size: 11px;
  letter-spacing: 0.22em;
}

.shell__nav {
  display: grid;
  gap: 10px;
  margin-top: 8px;
}

.shell__nav-link {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 56px;
  padding: 0 16px;
  border: 1px solid transparent;
  border-radius: 20px;
  color: var(--text-sub);
  background: rgba(255, 255, 255, 0.2);
}

.shell__nav-link:hover {
  color: var(--text-main);
  border-color: rgba(75, 107, 255, 0.22);
  background: rgba(255, 255, 255, 0.54);
  box-shadow: var(--shadow-soft);
}

.shell__nav-link.router-link-active {
  color: var(--primary);
  border-color: rgba(75, 107, 255, 0.18);
  background: linear-gradient(
    135deg,
    rgba(75, 107, 255, 0.08),
    rgba(75, 107, 255, 0.02)
  );
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.72),
    0 16px 34px rgba(75, 107, 255, 0.12);
}

.shell__member {
  margin-top: auto;
  padding: 14px;
}

.shell__member-head,
.shell__member-body,
.shell__member-footer {
  display: flex;
  align-items: center;
}

.shell__member-head,
.shell__member-footer {
  justify-content: space-between;
}

.shell__member-head {
  margin-bottom: 16px;
}

.shell__member-badge {
  color: var(--primary);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
}

.shell__member-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: var(--accent-gold);
  box-shadow: 0 0 12px rgba(239, 177, 75, 0.52);
}

.shell__member-body {
  gap: 12px;
}

.shell__member-icon {
  display: grid;
  width: 42px;
  height: 42px;
  place-items: center;
  border-radius: 16px;
  color: var(--primary);
  background: linear-gradient(
    180deg,
    rgba(75, 107, 255, 0.12),
    rgba(75, 107, 255, 0.04)
  );
  font-size: 18px;
}

.shell__member-body strong,
.shell__member-body small {
  display: block;
}

.shell__member-body strong {
  font-size: 14px;
  word-break: break-word;
}

.shell__member-body small,
.shell__member-footer {
  color: var(--text-light);
  font-size: 11px;
}

.shell__content {
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 18px;
}

.shell__topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  padding: 14px 18px;
}

.shell__headline {
  display: grid;
  gap: 2px;
}

.shell__eyebrow {
  color: var(--primary);
  font-family: var(--font-accent);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.24em;
}

.shell__headline strong {
  font-family: var(--font-display);
  font-size: 18px;
}

.shell__actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
}

.shell__hint {
  color: var(--text-sub);
  font-size: 12px;
  white-space: nowrap;
}

.shell__secondary-action {
  --n-text-color: var(--text-main) !important;
  --n-text-color-hover: var(--text-main) !important;
  --n-color: rgba(255, 255, 255, 0.4) !important;
  --n-color-hover: rgba(255, 255, 255, 0.68) !important;
  --n-border: 1px solid rgba(121, 144, 184, 0.18) !important;
  --n-border-hover: 1px solid rgba(75, 107, 255, 0.22) !important;
}

.shell__primary-action {
  min-width: 138px;
}

.shell__main {
  min-width: 0;
  min-height: 0;
}

@media (max-width: 1320px) {
  .shell__topbar {
    align-items: flex-start;
    flex-direction: column;
  }

  .shell__actions {
    flex-wrap: wrap;
    justify-content: flex-start;
  }

  .shell__hint {
    white-space: normal;
  }
}

@media (max-width: 1100px) {
  .shell {
    --shell-sidebar-width: 96px;
  }

  .shell__sidebar {
    padding: 14px 10px;
  }

  .shell__brand {
    justify-content: center;
  }

  .shell__brand-copy,
  .shell__hint,
  .shell__member-body small,
  .shell__member-footer {
    display: none;
  }

  .shell__nav-link {
    justify-content: center;
    padding: 0;
  }

  .shell__nav-link span {
    display: none;
  }

  .shell__member {
    padding: 12px;
  }

  .shell__member-head {
    justify-content: center;
  }

  .shell__member-dot,
  .shell__member-badge,
  .shell__member-body strong {
    display: none;
  }

  .shell__member-body {
    justify-content: center;
  }
}

@media (max-width: 760px) {
  .shell {
    --shell-sidebar-width: 0px;
    --shell-gap: 14px;
    --shell-pad: 14px;
    grid-template-columns: 1fr;
  }

  .shell__sidebar {
    position: relative;
    top: 0;
    height: auto;
    gap: 12px;
  }

  .shell__nav {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .shell__brand-copy,
  .shell__member {
    display: none;
  }

  .shell__nav-link {
    min-height: 48px;
  }

  .shell__nav-link span {
    display: inline;
    font-size: 12px;
  }

  .shell__topbar {
    align-items: flex-start;
    flex-direction: column;
  }

  .shell__actions {
    flex-wrap: wrap;
    justify-content: flex-start;
  }
}
</style>
