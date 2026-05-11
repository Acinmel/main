<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { NAlert, NButton, NEmpty, NModal, NSpin, useMessage } from 'naive-ui'
import { createAvatarResource, listAvatarResources, uploadAvatarResource } from '@/api/resources'
import { fetchSavedVideoBlob } from '@/api/task'
import AvatarResourceCard from '@/components/resources/AvatarResourceCard.vue'
import DeleteConfirmModal from '@/components/resources/DeleteConfirmModal.vue'
import HeaderFilter from '@/components/resources/HeaderFilter.vue'
import NewAvatarModal from '@/components/resources/NewAvatarModal.vue'
import { useCursorList } from '@/composables/useCursorList'
import { useDebouncedInfiniteScroll } from '@/composables/useDebouncedInfiniteScroll'
import { useResourceActions } from '@/composables/useResourceActions'
import type { AvatarResource, CreateAvatarResourceDraft, ResourceScope } from '@/types/resources'

const props = withDefaults(
  defineProps<{
    title?: string
    subtitle?: string
    actionText?: string
  }>(),
  {
    title: '数字人库',
    subtitle: '管理你的数字人视频素材，直接挑选已保存视频进入后续创作。',
    actionText: '添加数字人',
  },
)

const message = useMessage()
const router = useRouter()
const scope = ref<ResourceScope>('all')
const scrollRef = ref<HTMLElement | null>(null)
const selectedIds = ref<string[]>([])
const createOpen = ref(false)
const creating = ref(false)
const deleteOpen = ref(false)
const deleting = ref(false)
const pendingDeleteIds = ref<string[]>([])
const previewUrl = ref<string | null>(null)
let previewObjectUrl: string | null = null

const list = useCursorList<AvatarResource>((cursor) =>
  listAvatarResources({ scope: scope.value, cursor, limit: 18 }),
)
const actions = useResourceActions('avatars')
const batchDeleteDisabled = computed(() => selectedIds.value.length === 0)

useDebouncedInfiniteScroll(() => scrollRef.value, () => void list.loadMore())

watch(scope, () => {
  selectedIds.value = []
  void list.refresh()
})

onMounted(() => {
  void list.refresh()
})

onBeforeUnmount(() => {
  if (previewObjectUrl) {
    URL.revokeObjectURL(previewObjectUrl)
  }
})

function toggleSelected(id: string, checked: boolean) {
  selectedIds.value = checked
    ? [...selectedIds.value, id]
    : selectedIds.value.filter((x) => x !== id)
}

function revokePreviewObjectUrl() {
  if (previewObjectUrl) {
    URL.revokeObjectURL(previewObjectUrl)
    previewObjectUrl = null
  }
}

async function rename(item: AvatarResource, name: string) {
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
    deleteOpen.value = false
    message.success('已删除资源')
  } catch {
    message.error('删除失败')
  } finally {
    deleting.value = false
  }
}

async function createAvatar(body: CreateAvatarResourceDraft) {
  creating.value = true
  try {
    const item = body.uploadFile
      ? await uploadAvatarResource(body)
      : await createAvatarResource(body)
    list.prepend(item)
    createOpen.value = false
    message.success('视频素材已添加')
  } catch {
    message.error('创建失败')
  } finally {
    creating.value = false
  }
}

function goCreate(item: AvatarResource) {
  if (!item.originalVideoUrl) {
    message.warning('这个数字人还没有绑定原始视频，请先补充视频素材。')
    return
  }
  void router.push({ name: 'studio', query: { avatarId: item.id } })
}

async function preview(item: AvatarResource) {
  const source = item.originalVideoUrl?.trim()
  if (!source) return
  revokePreviewObjectUrl()
  if (/^(https?:|data:|blob:)/i.test(source)) {
    previewUrl.value = source
    return
  }
  try {
    const blob = await fetchSavedVideoBlob(source)
    previewObjectUrl = URL.createObjectURL(blob)
    previewUrl.value = previewObjectUrl
  } catch {
    message.error('本地视频预览加载失败')
  }
}
</script>

<template>
  <main ref="scrollRef" class="resource-page">
    <HeaderFilter
      v-model="scope"
      :title="props.title"
      :subtitle="props.subtitle"
      :action-text="props.actionText"
      :batch-delete-disabled="batchDeleteDisabled"
      @action="createOpen = true"
      @batch-delete="requestDelete(selectedIds)"
    />

    <n-alert v-if="list.error.value" type="error" class="resource-state">
      {{ list.error.value }}
      <n-button text type="primary" @click="list.refresh">重试</n-button>
    </n-alert>

    <n-spin :show="list.loading.value">
      <n-empty v-if="list.empty.value" description="暂无数字人视频素材" class="resource-state" />
      <div v-else class="resource-grid resource-grid--avatar">
        <AvatarResourceCard
          v-for="item in list.items.value"
          :key="item.id"
          :item="item"
          :selected="selectedIds.includes(item.id)"
          @update:selected="toggleSelected(item.id, $event)"
          @rename="rename(item, $event)"
          @delete="requestDelete([item.id])"
          @preview="preview(item)"
          @create="goCreate(item)"
        />
      </div>
      <div v-if="list.loadingMore.value" class="resource-loading">继续加载中...</div>
      <div v-else-if="!list.hasMore.value && list.items.value.length" class="resource-loading">
        已加载全部
      </div>
    </n-spin>

    <NewAvatarModal v-model:show="createOpen" :loading="creating" @submit="createAvatar" />
    <DeleteConfirmModal
      v-model:show="deleteOpen"
      title="删除数字人"
      :count="pendingDeleteIds.length"
      :loading="deleting"
      @confirm="confirmDelete"
    />
    <n-modal
      :show="Boolean(previewUrl)"
      preset="card"
      class="video-modal"
      title="原始视频预览"
      @update:show="
        (show) => {
          if (!show) {
            previewUrl = null
            revokePreviewObjectUrl()
          }
        }
      "
    >
      <video v-if="previewUrl" controls :src="previewUrl" preload="metadata" />
    </n-modal>
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

.resource-grid {
  display: grid;
  gap: 18px;
}

.resource-grid--avatar {
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
}

.resource-state {
  margin: 34px auto;
}

.resource-loading {
  padding: 18px;
  color: var(--text-sub);
  text-align: center;
}

.video-modal video {
  width: 100%;
  max-height: 70vh;
  border-radius: 14px;
  background: #0f172a;
}

@media (max-width: 760px) {
  .resource-page {
    padding: 18px 16px 40px;
  }
}
</style>
