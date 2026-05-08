<script setup lang="ts">
import { NTabPane, NTabs } from 'naive-ui'
import { ref } from 'vue'
import AvatarLibraryView from '@/views/resources/AvatarLibraryView.vue'
import SubtitleTemplateLibraryView from '@/views/resources/SubtitleTemplateLibraryView.vue'
import VoiceLibraryView from '@/views/resources/VoiceLibraryView.vue'

type ResourceTab = 'avatars' | 'voices' | 'subtitle-templates'

const activeTab = ref<ResourceTab>('avatars')
</script>

<template>
  <div class="resource-library">
    <n-tabs
      v-model:value="activeTab"
      type="segment"
      animated
      class="resource-library__tabs"
    >
      <n-tab-pane name="avatars" tab="数字人库" display-directive="show">
        <AvatarLibraryView />
      </n-tab-pane>
      <n-tab-pane name="voices" tab="音色库" display-directive="show">
        <VoiceLibraryView />
      </n-tab-pane>
      <n-tab-pane name="subtitle-templates" tab="字幕模板库" display-directive="show">
        <SubtitleTemplateLibraryView />
      </n-tab-pane>
    </n-tabs>
  </div>
</template>

<style scoped>
.resource-library {
  width: 100%;
  min-height: 100dvh;
  background:
    radial-gradient(circle at 86% 12%, rgba(0, 210, 106, 0.12), transparent 28%),
    linear-gradient(135deg, #000302 0%, var(--bg-main) 42%, #000000 100%);
}

.resource-library__tabs :deep(.n-tabs-nav) {
  position: sticky;
  top: 0;
  z-index: 10;
  padding: 20px 28px 0;
  background: linear-gradient(180deg, rgba(2, 6, 5, 0.96) 0%, rgba(2, 6, 5, 0.88) 78%, transparent 100%);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
}

.resource-library__tabs :deep(.n-tabs-rail) {
  max-width: 560px;
  padding: 5px;
  border: 1px solid var(--border-soft);
  background: linear-gradient(180deg, rgba(8, 28, 21, 0.78), rgba(2, 10, 7, 0.86));
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.04),
    var(--shadow-soft);
}

.resource-library__tabs :deep(.n-tabs-tab) {
  min-width: 120px;
  font-weight: 700;
}

.resource-library__tabs :deep(.n-tabs-tab:hover) {
  color: var(--primary);
}

.resource-library__tabs :deep(.n-tabs-tab--active) {
  color: #02110a;
  background: linear-gradient(135deg, var(--primary), var(--primary-deep));
  box-shadow: 0 10px 26px rgba(22, 242, 139, 0.16);
}

.resource-library__tabs :deep(.n-tab-pane) {
  padding-top: 0;
}

@media (max-width: 760px) {
  .resource-library__tabs :deep(.n-tabs-nav) {
    padding: 14px 16px 0;
  }
}
</style>
