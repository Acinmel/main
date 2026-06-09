<script setup lang="ts">
import { NTabPane, NTabs } from 'naive-ui'
import { defineAsyncComponent, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

const AvatarLibraryView = defineAsyncComponent(() => import('@/views/resources/AvatarLibraryView.vue'))
const VoiceLibraryView = defineAsyncComponent(() => import('@/views/resources/VoiceLibraryView.vue'))
const SubtitleTemplateLibraryView = defineAsyncComponent(
  () => import('@/views/resources/SubtitleTemplateLibraryView.vue'),
)

type ResourceTab = 'avatars' | 'voices' | 'subtitle-templates'

const route = useRoute()
const router = useRouter()
const activeTab = ref<ResourceTab>('avatars')

function normalizeTab(value: unknown): ResourceTab {
  return value === 'voices' || value === 'subtitle-templates' ? value : 'avatars'
}

watch(
  () => route.query.tab,
  (value) => {
    activeTab.value = normalizeTab(value)
  },
  { immediate: true },
)

watch(activeTab, (value) => {
  void router.replace({ query: { ...route.query, tab: value } })
})
</script>

<template>
  <div class="resource-library">
    <n-tabs
      v-model:value="activeTab"
      type="segment"
      animated
      class="resource-library__tabs"
    >
      <n-tab-pane name="avatars" tab="数字人库" display-directive="if">
        <AvatarLibraryView />
      </n-tab-pane>
      <n-tab-pane name="voices" tab="音色库" display-directive="if">
        <VoiceLibraryView />
      </n-tab-pane>
      <n-tab-pane name="subtitle-templates" tab="字幕模板库" display-directive="if">
        <SubtitleTemplateLibraryView />
      </n-tab-pane>
    </n-tabs>
  </div>
</template>

<style scoped>
.resource-library {
  width: 100%;
  min-height: 100dvh;
  overflow-x: hidden;
  background:
    radial-gradient(circle at 88% 10%, rgba(75, 107, 255, 0.1), transparent 22%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.18), transparent 28%);
}

.resource-library__tabs :deep(.n-tabs-nav) {
  position: sticky;
  top: 0;
  z-index: 10;
  padding: 20px 28px 0;
  background: linear-gradient(
    180deg,
    rgba(244, 247, 251, 0.96) 0%,
    rgba(244, 247, 251, 0.82) 78%,
    transparent 100%
  );
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
}

.resource-library__tabs :deep(.n-tabs-nav-scroll-wrapper) {
  overflow-x: auto;
  scrollbar-width: none;
}

.resource-library__tabs :deep(.n-tabs-nav-scroll-wrapper::-webkit-scrollbar) {
  display: none;
}

.resource-library__tabs :deep(.n-tabs-rail) {
  width: min(100%, 560px);
  max-width: 560px;
  padding: 5px;
  border: 1px solid rgba(255, 255, 255, 0.56);
  border-radius: 999px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.86), rgba(246, 249, 255, 0.8));
  box-shadow: var(--shadow-soft);
}

.resource-library__tabs :deep(.n-tabs-capsule) {
  border-radius: 999px;
  background: linear-gradient(135deg, var(--primary), var(--accent-teal));
  box-shadow: var(--shadow-glow);
}

.resource-library__tabs :deep(.n-tabs-tab) {
  z-index: 1;
  min-width: 120px;
  font-weight: 700;
  color: #334155;
}

.resource-library__tabs :deep(.n-tabs-tab:hover) {
  color: var(--primary);
}

.resource-library__tabs :deep(.n-tabs-tab--active),
.resource-library__tabs :deep(.n-tabs-tab--active .n-tabs-tab__label) {
  color: #ffffff !important;
}

.resource-library__tabs :deep(.n-tab-pane) {
  padding-top: 0;
}

@media (max-width: 760px) {
  .resource-library__tabs :deep(.n-tabs-nav) {
    padding: 14px 16px 0;
  }

  .resource-library__tabs :deep(.n-tabs-rail) {
    width: 100%;
    max-width: none;
  }

  .resource-library__tabs :deep(.n-tabs-tab) {
    min-width: 96px;
    padding-inline: 14px;
  }
}
</style>
