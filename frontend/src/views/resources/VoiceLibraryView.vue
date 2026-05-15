<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { NAlert, NButton, NEmpty, NSpin, useMessage } from 'naive-ui'
import {
  cloneVoiceResource,
  cloneVoiceResourceUpload,
  listVoiceResources,
} from '@/api/resources'
import DeleteConfirmModal from '@/components/resources/DeleteConfirmModal.vue'
import HeaderFilter from '@/components/resources/HeaderFilter.vue'
import VoiceCloneModal from '@/components/resources/VoiceCloneModal.vue'
import VoiceResourceCard from '@/components/resources/VoiceResourceCard.vue'
import { useCursorList } from '@/composables/useCursorList'
import { useDebouncedInfiniteScroll } from '@/composables/useDebouncedInfiniteScroll'
import { useResourceActions } from '@/composables/useResourceActions'
import { useSingleAudioPlayer } from '@/composables/useSingleAudioPlayer'
import type { CreateVoiceResourceDraft, ResourceScope, VoiceResource } from '@/types/resources'
import { describeHttpOrNetworkError } from '@/utils/httpErrorMessage'

const props = withDefaults(
  defineProps<{
    title?: string
    subtitle?: string
    actionText?: string
    showSearch?: boolean
  }>(),
  {
    title: '音色库',
    subtitle: '管理推荐音色与自定义声音克隆，试听时始终只播放一个音频。',
    actionText: '自定义声音克隆',
    showSearch: false,
  },
)

const message = useMessage()
const scope = ref<ResourceScope>('all')
const scrollRef = ref<HTMLElement | null>(null)
const selectedIds = ref<string[]>([])
const keyword = ref('')
const cloneOpen = ref(false)
const cloning = ref(false)
const deleteOpen = ref(false)
const deleting = ref(false)
const pendingDeleteIds = ref<string[]>([])

const list = useCursorList<VoiceResource>((cursor) =>
  listVoiceResources({ scope: scope.value, cursor, limit: 18 }),
)
const actions = useResourceActions('voices')
const player = useSingleAudioPlayer()
const batchDeleteDisabled = computed(() => selectedIds.value.length === 0)
const visibleItems = computed(() => {
  const q = keyword.value.trim().toLowerCase()
  if (!q) return list.items.value
  return list.items.value.filter((item) => item.name.toLowerCase().includes(q))
})

useDebouncedInfiniteScroll(() => scrollRef.value, () => void list.loadMore())

watch(scope, () => {
  selectedIds.value = []
  void list.refresh()
})

onMounted(() => {
  void list.refresh()
})

function toggleSelected(id: string, checked: boolean) {
  selectedIds.value = checked ? [...selectedIds.value, id] : selectedIds.value.filter((x) => x !== id)
}

async function rename(item: VoiceResource, name: string) {
  try {
    const patch = await actions.rename(item.id, name)
    list.updateItem(item.id, patch)
    message.success('名称已更新')
  } catch {
    message.error('名称更新失败')
  }
}

function requestDelete(ids: string[]) {
  pendingDeleteIds.value = ids
  deleteOpen.value = true
}

async function confirmDelete() {
  deleting.value = true
  try {
    const ids =
      pendingDeleteIds.value.length === 1
        ? await actions.remove(pendingDeleteIds.value[0])
        : await actions.removeMany(pendingDeleteIds.value)
    list.removeItems(ids)
    selectedIds.value = selectedIds.value.filter((id) => !ids.includes(id))
    if (player.playingId.value && ids.includes(player.playingId.value)) player.stop()
    deleteOpen.value = false
    message.success('已删除资源')
  } catch {
    message.error('删除失败')
  } finally {
    deleting.value = false
  }
}

async function cloneVoice(body: CreateVoiceResourceDraft) {
  cloning.value = true
  try {
    const item = body.sampleFile
      ? await cloneVoiceResourceUpload(body)
      : await cloneVoiceResource(body)
    list.prepend(item)
    cloneOpen.value = false
    if (item.provider === 'local-upload') {
      const reason = item.cloneError ? `原因：${item.cloneError.slice(0, 160)}` : '可先作为本地音频样本使用'
      message.warning(`音频已保存到音色库；模型克隆未通过，已保存为本地样本。${reason}`)
      return
    }
    message.success('声音克隆已创建')
  } catch (e) {
    message.error(describeHttpOrNetworkError(e))
  } finally {
    cloning.value = false
  }
}
</script>

<template>
  <main ref="scrollRef" class="resource-page">
    <HeaderFilter
      v-model="scope"
      v-model:search-value="keyword"
      :title="props.title"
      :subtitle="props.subtitle"
      :action-text="props.actionText"
      :batch-delete-disabled="batchDeleteDisabled"
      :show-search="props.showSearch"
      search-placeholder="搜索..."
      @action="cloneOpen = true"
      @batch-delete="requestDelete(selectedIds)"
    />

    <n-alert v-if="list.error.value" type="error" class="resource-state">
      {{ list.error.value }}
      <n-button text type="primary" @click="list.refresh">重试</n-button>
    </n-alert>

    <n-spin :show="list.loading.value">
      <n-empty v-if="list.empty.value" description="暂无音色资源" class="resource-state" />
      <n-empty v-else-if="visibleItems.length === 0" description="没有匹配的音色" class="resource-state" />
      <div v-else class="voice-grid">
        <VoiceResourceCard
          v-for="item in visibleItems"
          :key="item.id"
          :item="item"
          :selected="selectedIds.includes(item.id)"
          :playing="player.playingId.value === item.id"
          @update:selected="toggleSelected(item.id, $event)"
          @rename="rename(item, $event)"
          @delete="requestDelete([item.id])"
          @play="player.toggle(item.id, item.audioUrl)"
        />
      </div>
      <div v-if="list.loadingMore.value" class="resource-loading">继续加载中...</div>
      <div v-else-if="!list.hasMore.value && list.items.value.length" class="resource-loading">
        已加载全部
      </div>
    </n-spin>

    <VoiceCloneModal v-model:show="cloneOpen" :loading="cloning" @submit="cloneVoice" />
    <DeleteConfirmModal
      v-model:show="deleteOpen"
      title="删除音色"
      :count="pendingDeleteIds.length"
      :loading="deleting"
      @confirm="confirmDelete"
    />
  </main>
</template>

<style scoped>
.resource-page {
  height: calc(100vh - 88px);
  overflow: auto;
  padding: 26px 28px 48px;
  color: var(--text-main);
  background:
    radial-gradient(circle at 88% 18%, rgba(75, 107, 255, 0.1), transparent 24%),
    linear-gradient(180deg, transparent, rgba(255, 255, 255, 0.16));
}

.voice-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(138px, 1fr));
  gap: 22px;
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
