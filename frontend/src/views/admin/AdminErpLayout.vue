<script setup lang="ts">
import { computed, h } from 'vue'
import { RouterView, useRoute, useRouter } from 'vue-router'
import {
  NButton,
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
  BarChartOutline,
  CubeOutline,
  DocumentTextOutline,
  HomeOutline,
  PeopleOutline,
} from '@vicons/ionicons5'
import './erp/erp-theme.css'

const route = useRoute()
const router = useRouter()

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
    label: '操作日志',
    key: 'erp-audit',
    icon: () => h(NIcon, { component: DocumentTextOutline }),
  },
]

function handleMenu(key: string) {
  router.push({ name: key })
}

const pageTitle = computed(() => (route.meta.title as string) ?? '控制台')
</script>

<template>
  <n-layout class="erp-shell" has-sider position="absolute" style="inset: 0">
    <n-layout-sider
      bordered
      show-trigger
      collapse-mode="width"
      :collapsed-width="72"
      :width="230"
      :native-scrollbar="false"
      content-style="display: flex; flex-direction: column; padding: 16px 10px;"
      class="erp-sider"
    >
      <div class="erp-sider__brand" @click="router.push({ name: 'erp-dashboard' })">
        <div class="erp-sider__logo">
          <n-icon :component="CubeOutline" :size="26" />
        </div>
        <div class="erp-sider__titles">
          <strong>运营管理</strong>
          <span>ERP · 可视化</span>
        </div>
      </div>
      <n-menu
        class="erp-sider__menu"
        inverted
        :value="activeMenu"
        :options="menuOptions"
        accordion
        @update:value="handleMenu"
      />
    </n-layout-sider>
    <n-layout content-style="display: flex; flex-direction: column; min-height: 100%">
      <n-layout-header bordered class="erp-header">
        <div class="erp-header__left">
          <h1 class="erp-header__title">{{ pageTitle }}</h1>
        </div>
        <div class="erp-header__actions">
          <n-button secondary round @click="router.push({ name: 'home' })">
            <template #icon>
              <n-icon :component="HomeOutline" />
            </template>
            返回前台
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
  </n-layout>
</template>

<style scoped>
.erp-shell {
  --erp-header-h: 56px;
}

.erp-sider :deep(.n-layout-sider-scroll-container) {
  background: linear-gradient(
    165deg,
    rgba(17, 24, 39, 0.98) 0%,
    rgba(2, 6, 23, 0.99) 100%
  );
  border-right: 1px solid rgba(148, 163, 184, 0.12);
}

.erp-sider__brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 6px 16px;
  margin-bottom: 4px;
  cursor: pointer;
  border-radius: 10px;
  user-select: none;
}
.erp-sider__brand:hover {
  background: rgba(56, 189, 248, 0.08);
}
.erp-sider__logo {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  display: grid;
  place-items: center;
  color: #e0f2fe;
  background: linear-gradient(145deg, rgba(56, 189, 248, 0.45), rgba(15, 23, 42, 0.4));
  border: 1px solid rgba(56, 189, 248, 0.25);
  flex-shrink: 0;
}
.erp-sider__titles strong {
  display: block;
  font-size: 14px;
  letter-spacing: 0.03em;
  color: #f1f5f9;
}
.erp-sider__titles span {
  display: block;
  margin-top: 2px;
  font-size: 11px;
  opacity: 0.55;
  color: #94a3b8;
}

.erp-sider__menu :deep(.n-menu-item-content) {
  border-radius: 8px !important;
  margin-bottom: 2px;
}
.erp-sider__menu :deep(.n-menu-item-content::before) {
  display: none;
}

.erp-header {
  height: var(--erp-header-h);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 0 20px 0 22px !important;
  background: rgba(15, 23, 42, 0.75) !important;
  backdrop-filter: blur(10px);
  border-bottom-color: rgba(148, 163, 184, 0.12) !important;
}

.erp-header__title {
  margin: 0;
  font-size: 17px;
  font-weight: 650;
  color: #f1f5f9;
  letter-spacing: -0.02em;
}

.erp-header__actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.erp-content {
  flex: 1;
  min-height: 0 !important;
  background:
    radial-gradient(ellipse 80% 60% at 50% -20%, rgba(56, 189, 248, 0.12), transparent 55%),
    linear-gradient(180deg, #0b1224 0%, #020617 45%, #000 100%) !important;
}

.erp-app {
  min-height: 100%;
  padding: 18px 24px 36px;
  color: #e2e8f0;
}

.erp-app.adm {
  box-sizing: border-box;
}
</style>
