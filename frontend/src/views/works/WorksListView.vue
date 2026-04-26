<script setup lang="ts">
import { NButton, NCard, NDataTable, NEmpty, NSpace, NTag, NText, useMessage } from 'naive-ui'
import type { DataTableColumns } from 'naive-ui'
import { h, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { getTask, listWorks } from '@/api/task'
import type { TaskStatus, WorkItem } from '@/types/domain'

const router = useRouter()
const message = useMessage()
const items = ref<WorkItem[]>([])
const loading = ref(true)

const columns: DataTableColumns<WorkItem> = [
  { title: '标题', key: 'title', ellipsis: { tooltip: true } },
  {
    title: '状态',
    key: 'status',
    width: 140,
    render(row) {
      return h(NTag, { size: 'small', type: statusType(row.status) }, { default: () => row.status })
    },
  },
  { title: '创建时间', key: 'createdAt', width: 200 },
  {
    title: '操作',
    key: 'actions',
    width: 120,
    render(row) {
      return h(
        NButton,
        {
          size: 'small',
          type: 'primary',
          quaternary: true,
          onClick: () => void openTask(row.id),
        },
        { default: () => '打开' },
      )
    },
  },
]

function statusType(s: TaskStatus) {
  if (s === 'success') return 'success'
  if (s === 'failed') return 'error'
  return 'info'
}

async function openTask(id: string) {
  try {
    const t = await getTask(id)
    if (t.status === 'success') {
      await router.push({ name: 'task-result', params: { id } })
      return
    }
    if (t.status === 'failed') {
      await router.push({ name: 'task-progress', params: { id } })
      return
    }
    if (t.flags.renderStarted || ['voice_generating', 'avatar_generating', 'rendering'].includes(t.status)) {
      await router.push({ name: 'task-progress', params: { id } })
      return
    }
    if (t.rewrite) {
      await router.push({ name: 'task-settings', params: { id } })
      return
    }
    if (t.flags.transcriptAvailable) {
      await router.push({ name: 'task-rewrite', params: { id } })
      return
    }
    await router.push({ name: 'task-transcript', params: { id } })
  } catch {
    message.error('打开任务失败')
  }
}

onMounted(async () => {
  try {
    items.value = await listWorks()
  } catch {
    message.error('加载作品列表失败')
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div class="wrap">
    <n-card title="我的作品" class="card">
      <n-space vertical :size="12">
        <n-text depth="2">数据来源：<n-text code>GET /api/v1/works</n-text></n-text>
        <n-empty v-if="!loading && items.length === 0" description="暂无作品，去首页创建一条任务吧" />
        <n-data-table v-else :columns="columns" :data="items" :loading="loading" :bordered="false" />
      </n-space>
    </n-card>
  </div>
</template>

<style scoped>
.wrap {
  max-width: 1080px;
  margin: 32px auto;
  padding: 0 16px;
}

.card {
  background: rgba(15, 23, 42, 0.96);
  border: 1px solid rgba(148, 163, 184, 0.35);
}

@media (max-width: 900px) {
  .wrap {
    margin: 20px auto;
    padding: 0 max(12px, var(--app-safe-left, 0px)) 0 max(12px, var(--app-safe-right, 0px));
  }
}

@media (max-width: 480px) {
  .wrap {
    margin: 12px auto 24px;
    max-width: 100%;
  }
}
</style>
