<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { NAlert, NButton, NEmpty, NSpin } from 'naive-ui'
import { listSubtitleTemplateResources } from '@/api/resources'
import HeaderFilter from '@/components/resources/HeaderFilter.vue'
import SubtitleTemplateCard from '@/components/resources/SubtitleTemplateCard.vue'
import { useCursorList } from '@/composables/useCursorList'
import { useDebouncedInfiniteScroll } from '@/composables/useDebouncedInfiniteScroll'
import type { ResourceScope, SubtitleTemplateResource } from '@/types/resources'

const scope = ref<ResourceScope>('all')
const scrollRef = ref<HTMLElement | null>(null)

const list = useCursorList<SubtitleTemplateResource>((cursor) =>
  listSubtitleTemplateResources({ scope: scope.value, cursor, limit: 18 }),
)

useDebouncedInfiniteScroll(() => scrollRef.value, () => void list.loadMore())

watch(scope, () => {
  void list.refresh()
})

onMounted(() => {
  void list.refresh()
})
</script>

<template>
  <main ref="scrollRef" class="resource-page">
    <HeaderFilter
      v-model="scope"
      title="字幕模板库"
      subtitle="系统预置模板只读展示，用户可在视频创作流程中选择使用。"
      :show-action="false"
      :show-batch-delete="false"
    />

    <n-alert v-if="list.error.value" type="error" class="resource-state">
      {{ list.error.value }}
      <n-button text type="primary" @click="list.refresh">重试</n-button>
    </n-alert>

    <n-spin :show="list.loading.value">
      <n-empty v-if="list.empty.value" description="暂无可用字幕模板" class="resource-state" />
      <div v-else class="template-grid">
        <SubtitleTemplateCard
          v-for="item in list.items.value"
          :key="item.id"
          :item="item"
          read-only
        />
      </div>
      <div v-if="list.loadingMore.value" class="resource-loading">继续加载中...</div>
      <div v-else-if="!list.hasMore.value && list.items.value.length" class="resource-loading">
        已加载全部
      </div>
    </n-spin>

  </main>
</template>

<style scoped>
.resource-page {
  height: calc(100vh - 88px);
  overflow: auto;
  padding: 22px 28px 48px;
  color: var(--text-main);
  background:
    radial-gradient(circle at 86% 14%, rgba(75, 107, 255, 0.1), transparent 24%),
    linear-gradient(180deg, transparent, rgba(255, 255, 255, 0.16));
}

.template-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 18px;
}

.resource-state {
  margin: 34px auto;
}

.resource-loading {
  padding: 18px;
  color: var(--text-sub);
  text-align: center;
}

@media (max-width: 760px) {
  .resource-page {
    padding: 18px 16px 40px;
  }
}
</style>
