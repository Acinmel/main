<script setup lang="ts">
import { computed, h, onMounted, onUnmounted, ref } from 'vue'
import { RouterView, useRoute, useRouter } from 'vue-router'
import {
  NButton,
  NDrawer,
  NDrawerContent,
  NIcon,
  NLayout,
  NLayoutContent,
  NLayoutHeader,
  NLayoutSider,
  NMenu,
  NScrollbar,
  type MenuOption,
} from 'naive-ui'
import {
  AlbumsOutline,
  BarChartOutline,
  CubeOutline,
  DocumentTextOutline,
  HomeOutline,
  MenuOutline,
  PeopleOutline,
} from '@vicons/ionicons5'
import './erp/erp-theme.css'

const route = useRoute()
const router = useRouter()

const isMobile = ref(false)
const menuDrawerOpen = ref(false)

const activeMenu = computed(() => String(route.name ?? 'erp-dashboard'))

const menuOptions: MenuOption[] = [
  {
    label: '数据看板',
    key: 'erp-dashboard',
    icon: () => h(NIcon, { component: BarChartOutline }),
  },
  {
    label: '用户审核',
    key: 'erp-users',
    icon: () => h(NIcon, { component: PeopleOutline }),
  },
  {
    label: '数据管理',
    key: 'erp-data',
    icon: () => h(NIcon, { component: AlbumsOutline }),
  },
  {
    label: '操作日志',
    key: 'erp-audit',
    icon: () => h(NIcon, { component: DocumentTextOutline }),
  },
]

function syncViewport() {
  isMobile.value = window.innerWidth <= 760
  if (!isMobile.value) {
    menuDrawerOpen.value = false
  }
}

function goDashboard() {
  void router.push({ name: 'erp-dashboard' })
  menuDrawerOpen.value = false
}

function handleMenu(key: string) {
  void router.push({ name: key })
  if (isMobile.value) {
    menuDrawerOpen.value = false
  }
}

const pageTitle = computed(() => (route.meta.title as string) ?? '控制台')

onMounted(() => {
  syncViewport()
  window.addEventListener('resize', syncViewport)
})

onUnmounted(() => {
  window.removeEventListener('resize', syncViewport)
})
</script>

<template>
  <n-layout class="erp-shell" :has-sider="!isMobile" position="absolute" style="inset: 0">
    <n-layout-sider
      v-if="!isMobile"
      bordered
      show-trigger
      collapse-mode="width"
      :collapsed-width="72"
      :width="264"
      :native-scrollbar="false"
      content-style="display: flex; flex-direction: column; padding: 22px 16px;"
      class="erp-sider"
    >
      <div class="erp-sider__brand" @click="goDashboard">
        <div class="erp-sider__logo">
          <n-icon :component="CubeOutline" :size="26" />
        </div>
        <div class="erp-sider__titles">
          <strong>运营管理</strong>
          <span>ERP 可视化</span>
        </div>
      </div>
      <n-menu
        class="erp-sider__menu"
        :value="activeMenu"
        :options="menuOptions"
        accordion
        @update:value="handleMenu"
      />
    </n-layout-sider>

    <n-layout content-style="display: flex; flex-direction: column; min-height: 100%">
      <n-layout-header bordered class="erp-header" :class="{ 'erp-header--mobile': isMobile }">
        <div class="erp-header__left">
          <n-button
            v-if="isMobile"
            tertiary
            circle
            class="erp-header__menu-btn"
            @click="menuDrawerOpen = true"
          >
            <template #icon>
              <n-icon :component="MenuOutline" />
            </template>
          </n-button>
          <h1 class="erp-header__title">{{ pageTitle }}</h1>
        </div>
        <div class="erp-header__actions">
          <n-button
            :secondary="!isMobile"
            :quaternary="isMobile"
            :round="!isMobile"
            :circle="isMobile"
            @click="router.push({ name: 'home' })"
          >
            <template #icon>
              <n-icon :component="HomeOutline" />
            </template>
            <span v-if="!isMobile">返回前台</span>
          </n-button>
        </div>
      </n-layout-header>

      <n-layout-content embedded class="erp-content">
        <n-scrollbar style="height: 100%">
          <div class="erp-app adm">
            <RouterView />
          </div>
        </n-scrollbar>
      </n-layout-content>
    </n-layout>

    <n-drawer
      v-model:show="menuDrawerOpen"
      placement="left"
      :width="284"
      :trap-focus="false"
      class="erp-mobile-drawer"
    >
      <n-drawer-content :native-scrollbar="false" body-content-style="padding: 20px 14px;">
        <div class="erp-sider__brand" @click="goDashboard">
          <div class="erp-sider__logo">
            <n-icon :component="CubeOutline" :size="26" />
          </div>
          <div class="erp-sider__titles">
            <strong>运营管理</strong>
            <span>ERP 可视化</span>
          </div>
        </div>
        <n-menu
          class="erp-sider__menu"
          :value="activeMenu"
          :options="menuOptions"
          accordion
          @update:value="handleMenu"
        />
      </n-drawer-content>
    </n-drawer>
  </n-layout>
</template>

<style scoped>
.erp-shell {
  --erp-header-h: 68px;
  background: #edf3fb;
}

.erp-sider :deep(.n-layout-sider-scroll-container),
.erp-mobile-drawer :deep(.n-drawer-body-content-wrapper) {
  background:
    radial-gradient(circle at 10% 0%, rgba(50, 111, 255, 0.16), transparent 30%),
    linear-gradient(180deg, #f8fbff 0%, #eef5ff 100%);
  border-right: 1px solid rgba(115, 135, 171, 0.18);
  box-shadow: 14px 0 34px rgba(42, 66, 110, 0.08);
}

.erp-sider__brand {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 8px 20px;
  margin-bottom: 10px;
  cursor: pointer;
  border-radius: 18px;
  user-select: none;
}

.erp-sider__brand:hover {
  background: rgba(255, 255, 255, 0.74);
}

.erp-sider__logo {
  width: 46px;
  height: 46px;
  border-radius: 16px;
  display: grid;
  place-items: center;
  color: #ffffff;
  background: linear-gradient(145deg, #346bff, #19bca8);
  border: 1px solid rgba(255, 255, 255, 0.66);
  box-shadow: 0 18px 36px rgba(52, 107, 255, 0.22);
  flex-shrink: 0;
}

.erp-sider__titles strong {
  display: block;
  font-size: 16px;
  letter-spacing: 0.03em;
  color: #10203a;
}

.erp-sider__titles span {
  display: block;
  margin-top: 4px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.12em;
  color: #6f7f9d;
}

.erp-sider__menu :deep(.n-menu-item-content) {
  min-height: 46px;
  margin-bottom: 8px;
  padding-left: 14px !important;
  border: 1px solid transparent;
  border-radius: 16px !important;
  color: #334155;
  font-weight: 750;
  transition:
    transform 0.18s ease,
    background 0.18s ease,
    border-color 0.18s ease,
    box-shadow 0.18s ease;
}

.erp-sider__menu :deep(.n-menu-item-content::before) {
  display: none;
}

.erp-sider__menu :deep(.n-menu-item-content:hover) {
  color: #153b7a;
  border-color: rgba(52, 107, 255, 0.2);
  background: rgba(255, 255, 255, 0.82);
  transform: translateX(2px);
}

.erp-sider__menu :deep(.n-menu-item-content--selected) {
  color: #ffffff;
  border-color: rgba(52, 107, 255, 0.26);
  background: linear-gradient(135deg, #346bff, #24b7aa);
  box-shadow: 0 16px 32px rgba(52, 107, 255, 0.2);
}

.erp-sider__menu :deep(.n-menu-item-content--selected .n-menu-item-content__icon),
.erp-sider__menu :deep(.n-menu-item-content--selected .n-menu-item-content-header) {
  color: #ffffff;
}

.erp-header {
  height: var(--erp-header-h);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 0 32px !important;
  background: rgba(248, 251, 255, 0.88) !important;
  backdrop-filter: blur(16px);
  border-bottom-color: rgba(115, 135, 171, 0.16) !important;
}

.erp-header__left {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
}

.erp-header__menu-btn {
  flex-shrink: 0;
}

.erp-header__title {
  margin: 0;
  font-size: 20px;
  font-weight: 800;
  color: #10203a;
  letter-spacing: -0.02em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.erp-header__actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.erp-content {
  flex: 1;
  min-height: 0 !important;
  background:
    radial-gradient(
      ellipse 70% 48% at 50% -16%,
      rgba(52, 107, 255, 0.13),
      transparent 55%
    ),
    linear-gradient(180deg, #f5f8fd 0%, #edf3fb 52%, #eaf1fa 100%) !important;
}

.erp-app {
  min-height: 100%;
  max-width: 1680px;
  box-sizing: border-box;
  margin: 0 auto;
  padding: 30px 36px 52px;
  color: #1d2b42;
}

.erp-app.adm {
  box-sizing: border-box;
}

@media (max-width: 760px) {
  .erp-header {
    padding: 0 12px !important;
    gap: 10px;
  }

  .erp-header--mobile {
    height: 60px;
  }

  .erp-header__title {
    font-size: 17px;
  }

  .erp-app {
    padding: 14px 12px 28px;
  }
}
</style>
