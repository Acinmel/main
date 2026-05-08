<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { NAlert, NButton, NEmpty, NModal, NSpin, useMessage } from 'naive-ui'
import { createAvatarResource, listAvatarResources } from '@/api/resources'
import AvatarResourceCard from '@/components/resources/AvatarResourceCard.vue'
import DeleteConfirmModal from '@/components/resources/DeleteConfirmModal.vue'
import HeaderFilter from '@/components/resources/HeaderFilter.vue'
import NewAvatarModal from '@/components/resources/NewAvatarModal.vue'
import { useCursorList } from '@/composables/useCursorList'
import { useDebouncedInfiniteScroll } from '@/composables/useDebouncedInfiniteScroll'
import { useResourceActions } from '@/composables/useResourceActions'
import type { AvatarResource, CreateAvatarResourceBody, ResourceScope } from '@/types/resources'

const props = withDefaults(
  defineProps<{
    title?: string
    subtitle?: string
    actionText?: string
  }>(),
  {
    title: '数字人库',
    subtitle: '管理你的数字人资产，预览原始视频并快速进入口播创作。',
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

function toggleSelected(id: string, checked: boolean) {
  selectedIds.value = checked ? [...selectedIds.value, id] : selectedIds.value.filter((x) => x !== id)
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

async function createAvatar(body: CreateAvatarResourceBody) {
  creating.value = true
  try {
    const item = await createAvatarResource(body)
    list.prepend(item)
    createOpen.value = false
    message.success('数字人已创建')
  } catch {
    message.error('创建失败')
  } finally {
    creating.value = false
  }
}

function goCreate(item: AvatarResource) {
  void router.push({ name: 'studio', query: { avatarId: item.id } })
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
      <n-empty v-if="list.empty.value" description="暂无数字人资源" class="resource-state" />
      <div v-else class="resource-grid resource-grid--avatar">
        <AvatarResourceCard
          v-for="item in list.items.value"
          :key="item.id"
          :item="item"
          :selected="selectedIds.includes(item.id)"
          @update:selected="toggleSelected(item.id, $event)"
          @rename="rename(item, $event)"
          @delete="requestDelete([item.id])"
          @preview="previewUrl = item.originalVideoUrl"
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
      @update:show="(show) => { if (!show) previewUrl = null }"
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
    radial-gradient(circle at 86% 14%, rgba(22, 242, 139, 0.1), transparent 28%),
    linear-gradient(180deg, transparent, rgba(0, 0, 0, 0.12));
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

.video-modal {
  width: min(860px, calc(100vw - 32px));
}

.video-modal video {
  width: 100%;
  max-height: 70vh;
  border-radius: 14px;
  background: #000;
}

@media (max-width: 760px) {
  .resource-page {
    padding: 18px 16px 40px;
  }
}
</style>
