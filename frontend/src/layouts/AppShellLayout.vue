<script setup lang="ts">
import { onMounted } from 'vue'
import { RouterLink, RouterView } from 'vue-router'
import { NButton, NText } from 'naive-ui'
import { useUserStore } from '@/stores/user'

const user = useUserStore()

function logout() {
  user.clearSession()
}

onMounted(() => {
  void user.hydrateProfile()
})
</script>

<template>
  <div class="shell">
    <header class="shell__header">
      <RouterLink to="/" class="shell__brand">
        <span class="shell__logo" aria-hidden="true" />
        <span class="shell__title-stack">
          <n-text strong>口播重制</n-text>
          <n-text depth="3" style="margin-left: 8px; font-size: 12px">Koubo Remake</n-text>
        </span>
      </RouterLink>

      <nav class="shell__nav">
        <RouterLink to="/" class="shell__nav-link">专属数字人</RouterLink>
        <RouterLink to="/studio" class="shell__nav-link">口播制作</RouterLink>
        <RouterLink to="/works">我的作品</RouterLink>
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
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px 12px;
  padding: 14px 32px;
  padding-top: max(14px, var(--app-safe-top, 0px));
  padding-left: max(32px, var(--app-safe-left, 0px));
  padding-right: max(32px, var(--app-safe-right, 0px));
  border-bottom: 1px solid rgba(148, 163, 184, 0.25);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  position: sticky;
  top: 0;
  z-index: 100;
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
}

.shell__logo {
  width: 26px;
  height: 26px;
  border-radius: 8px;
  background: linear-gradient(135deg, #38bdf8, #6366f1);
  box-shadow: 0 0 18px rgba(56, 189, 248, 0.55);
}

.shell__nav {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 8px 12px;
  font-size: 13px;
  color: #cbd5f5;
  max-width: 100%;
}

.shell__nav a {
  color: inherit;
}

.shell__nav-link.router-link-active {
  color: #38bdf8;
  font-weight: 600;
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
