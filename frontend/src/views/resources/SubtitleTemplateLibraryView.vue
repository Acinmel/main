<script setup lang="ts">
import { computed, reactive, ref, onMounted, watch } from 'vue'
import { NAlert, NButton, NEmpty, NForm, NFormItem, NInput, NModal, NSpace, NSpin, useMessage } from 'naive-ui'
import {
  copySubtitleTemplateResource,
  createSubtitleTemplateResource,
  listSubtitleTemplateResources,
  updateSubtitleTemplateResource,
} from '@/api/resources'
import DeleteConfirmModal from '@/components/resources/DeleteConfirmModal.vue'
import HeaderFilter from '@/components/resources/HeaderFilter.vue'
import SubtitleTemplateCard from '@/components/resources/SubtitleTemplateCard.vue'
import { useCursorList } from '@/composables/useCursorList'
import { useDebouncedInfiniteScroll } from '@/composables/useDebouncedInfiniteScroll'
import { useResourceActions } from '@/composables/useResourceActions'
import type {
  CreateSubtitleTemplateBody,
  ResourceScope,
  SubtitleTemplateResource,
} from '@/types/resources'

const message = useMessage()
const scope = ref<ResourceScope>('all')
const scrollRef = ref<HTMLElement | null>(null)
const selectedIds = ref<string[]>([])
const editorOpen = ref(false)
const saving = ref(false)
const editingItem = ref<SubtitleTemplateResource | null>(null)
const deleteOpen = ref(false)
const deleting = ref(false)
const pendingDeleteIds = ref<string[]>([])

const form = reactive({
  name: '',
  coverUrl: '',
  previewCoverUrl: '',
  styleJson: '{\n  "color": "#ffffff",\n  "stroke": "#111827",\n  "size": 42\n}',
})

const list = useCursorList<SubtitleTemplateResource>((cursor) =>
  listSubtitleTemplateResources({ scope: scope.value, cursor, limit: 18 }),
)
const actions = useResourceActions('subtitle-templates')
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

function openCreate() {
  editingItem.value = null
  form.name = ''
  form.coverUrl = ''
  form.previewCoverUrl = ''
  form.styleJson = '{\n  "color": "#ffffff",\n  "stroke": "#111827",\n  "size": 42\n}'
  editorOpen.value = true
}

function openEdit(item: SubtitleTemplateResource) {
  editingItem.value = item
  form.name = item.name
  form.coverUrl = item.coverUrl
  form.previewCoverUrl = item.previewCoverUrl
  form.styleJson = JSON.stringify(item.styleJson, null, 2)
  editorOpen.value = true
}

function templatePayload(): CreateSubtitleTemplateBody | null {
  try {
    const styleJson = JSON.parse(form.styleJson) as Record<string, unknown>
    return {
      name: form.name.trim() || '我的字幕模板',
      coverUrl: form.coverUrl.trim() || undefined,
      previewCoverUrl: form.previewCoverUrl.trim() || undefined,
      styleJson,
    }
  } catch {
    message.error('样式 JSON 格式不正确')
    return null
  }
}

async function saveTemplate() {
  const payload = templatePayload()
  if (!payload) return
  saving.value = true
  try {
    if (editingItem.value) {
      const item = await updateSubtitleTemplateResource(editingItem.value.id, payload)
      list.updateItem(item.id, item)
      message.success('模板已更新')
    } else {
      const item = await createSubtitleTemplateResource(payload)
      list.prepend(item)
      message.success('模板已创建')
    }
    editorOpen.value = false
  } catch {
    message.error('保存失败')
  } finally {
    saving.value = false
  }
}

async function rename(item: SubtitleTemplateResource, name: string) {
  try {
    const patch = await actions.rename(item.id, name)
    list.updateItem(item.id, patch)
    message.success('名称已更新')
  } catch {
    message.error('名称更新失败')
  }
}

async function copyTemplate(item: SubtitleTemplateResource) {
  try {
    const copied = await copySubtitleTemplateResource(item.id)
    list.prepend(copied)
    message.success('已复制模板样式')
  } catch {
    message.error('复制失败')
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
</script>

<template>
  <main ref="scrollRef" class="resource-page">
    <HeaderFilter
      v-model="scope"
      title="字幕模板库"
      subtitle="管理字幕封面、样式 JSON 和双态预览，快速复用成熟模板。"
      action-text="新建模板"
      :batch-delete-disabled="batchDeleteDisabled"
      @action="openCreate"
      @batch-delete="requestDelete(selectedIds)"
    />

    <n-alert v-if="list.error.value" type="error" class="resource-state">
      {{ list.error.value }}
      <n-button text type="primary" @click="list.refresh">重试</n-button>
    </n-alert>

    <n-spin :show="list.loading.value">
      <n-empty v-if="list.empty.value" description="暂无字幕模板" class="resource-state" />
      <div v-else class="template-grid">
        <SubtitleTemplateCard
          v-for="item in list.items.value"
          :key="item.id"
          :item="item"
          :selected="selectedIds.includes(item.id)"
          @update:selected="toggleSelected(item.id, $event)"
          @rename="rename(item, $event)"
          @delete="requestDelete([item.id])"
          @copy="copyTemplate(item)"
          @edit="openEdit(item)"
        />
      </div>
      <div v-if="list.loadingMore.value" class="resource-loading">继续加载中...</div>
      <div v-else-if="!list.hasMore.value && list.items.value.length" class="resource-loading">
        已加载全部
      </div>
    </n-spin>

    <n-modal
      v-model:show="editorOpen"
      preset="card"
      class="template-modal"
      :title="editingItem ? '编辑字幕模板' : '新建字幕模板'"
    >
      <n-form label-placement="top">
        <n-form-item label="模板名称">
          <n-input v-model:value="form.name" />
        </n-form-item>
        <n-form-item label="默认封面 URL">
          <n-input v-model:value="form.coverUrl" />
        </n-form-item>
        <n-form-item label="预览态封面 URL">
          <n-input v-model:value="form.previewCoverUrl" />
        </n-form-item>
        <n-form-item label="样式 JSON">
          <n-input v-model:value="form.styleJson" type="textarea" :autosize="{ minRows: 5, maxRows: 10 }" />
        </n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button :disabled="saving" @click="editorOpen = false">取消</n-button>
          <n-button type="primary" :loading="saving" @click="saveTemplate">保存</n-button>
        </n-space>
      </template>
    </n-modal>

    <DeleteConfirmModal
      v-model:show="deleteOpen"
      title="删除字幕模板"
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
  padding: 22px 28px 48px;
  color: var(--text-main);
  background:
    radial-gradient(circle at 86% 14%, rgba(22, 242, 139, 0.1), transparent 28%),
    linear-gradient(180deg, transparent, rgba(0, 0, 0, 0.12));
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

.template-modal {
  width: min(620px, calc(100vw - 32px));
}

@media (max-width: 760px) {
  .resource-page {
    padding: 18px 16px 40px;
  }
}
</style>
