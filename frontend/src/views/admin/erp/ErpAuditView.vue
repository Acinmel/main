<script setup lang="ts">
import type { DataTableColumns } from 'naive-ui'
import {
  NButton,
  NCard,
  NDataTable,
  NIcon,
  NInput,
  NScrollbar,
  NSpace,
  NSpin,
  NTag,
  NTimeline,
  NTimelineItem,
  useMessage,
} from 'naive-ui'
import { DocumentTextOutline } from '@vicons/ionicons5'
import { h, onMounted, ref } from 'vue'
import { fetchAdminAuditLogs } from '@/api/admin'
import { actionLabelZh } from './adminConstants'

const message = useMessage()

const auditTotal = ref(0)
const auditRows = ref<
  {
    id: string
    userId: string
    email: string
    userRegisteredAt: string
    action: string
    detail: string | null
    ip: string | null
    createdAt: string
  }[]
>([])
const auditQ = ref('')
const auditOffset = ref(0)
const auditViewMode = ref<'table' | 'timeline'>('timeline')
const loadingAudits = ref(false)

async function loadAudits() {
  loadingAudits.value = true
  try {
    const r = await fetchAdminAuditLogs({
      q: auditQ.value || undefined,
      offset: auditOffset.value,
      limit: 40,
    })
    auditRows.value = r.items
    auditTotal.value = r.total
  } catch (e: unknown) {
    message.error(e instanceof Error ? e.message : '加载日志失败')
  } finally {
    loadingAudits.value = false
  }
}

const auditColumns: DataTableColumns<(typeof auditRows.value)[0]> = [
  { title: '本条时间', key: 'createdAt', width: 178 },
  { title: '用户邮箱', key: 'email', width: 200, ellipsis: { tooltip: true } },
  {
    title: '账号注册时间',
    key: 'userRegisteredAt',
    width: 178,
    ellipsis: { tooltip: true },
  },
  {
    title: '动作',
    key: 'action',
    width: 130,
    render: (row) =>
      h(
        NTag,
        {
          size: 'small',
          bordered: false,
          type:
            row.action === 'render_submit'
              ? 'success'
              : row.action === 'task_create'
                ? 'info'
                : row.action === 'user_register'
                  ? 'success'
                  : row.action === 'user_login'
                    ? 'warning'
                    : 'default',
        },
        { default: () => actionLabelZh[row.action] ?? row.action },
      ),
  },
  { title: '详情', key: 'detail', ellipsis: { tooltip: true } },
  { title: 'IP', key: 'ip', width: 120 },
]

function actionTone(action: string): 'default' | 'success' | 'info' | 'warning' | 'error' {
  if (action === 'render_submit') return 'success'
  if (action === 'task_create') return 'info'
  if (action === 'user_register') return 'success'
  if (action === 'user_login') return 'warning'
  return 'default'
}

onMounted(() => {
  void loadAudits()
})
</script>

<template>
  <header class="erp-page__hdr">
    <div class="adm__brand">
      <n-icon :component="DocumentTextOutline" :size="28" color="#34d399" />
      <div>
        <h1 class="adm__title">操作日志</h1>
        <p class="adm__muted">审计流水 · 含<strong>账号注册</strong>、<strong>登录</strong>及口播任务操作；可查注册邮箱与每条操作时间。</p>
      </div>
    </div>
  </header>

  <n-space vertical :size="14" style="width: 100%">
    <n-space align="center" wrap>
      <n-input
        v-model:value="auditQ"
        clearable
        placeholder="搜索动作 / 详情 / 邮箱 / IP · 含注册与登录审计"
        style="width: min(100%, 360px)"
        @keyup.enter="() => ((auditOffset = 0), void loadAudits())"
      />
      <n-button
        type="primary"
        secondary
        @click="() => ((auditOffset = 0), void loadAudits())"
      >
        搜索
      </n-button>
      <n-button
        size="small"
        :secondary="auditViewMode === 'timeline'"
        @click="auditViewMode = auditViewMode === 'timeline' ? 'table' : 'timeline'"
      >
        {{ auditViewMode === 'timeline' ? '切换为表格' : '切换为时间线' }}
      </n-button>
      <n-button
        :disabled="auditOffset <= 0"
        @click="() => ((auditOffset = Math.max(0, auditOffset - 40)), void loadAudits())"
      >
        上一页
      </n-button>
      <n-button
        :disabled="auditOffset + 40 >= auditTotal"
        @click="() => ((auditOffset += 40), void loadAudits())"
      >
        下一页
      </n-button>
      <span class="adm__muted">共 {{ auditTotal }} 条</span>
    </n-space>

    <template v-if="auditViewMode === 'table'">
      <n-data-table
        :columns="auditColumns"
        :data="auditRows"
        :loading="loadingAudits"
        :bordered="false"
        :single-line="false"
        size="small"
        class="glass-table"
      />
    </template>
    <n-card v-else class="glass timeline-card" :bordered="false">
      <n-spin :show="loadingAudits">
        <n-scrollbar style="max-height: 560px">
          <n-timeline v-if="auditRows.length" size="large">
            <n-timeline-item
              v-for="row in auditRows"
              :key="row.id"
              :title="`${row.createdAt}`"
              :type="actionTone(row.action)"
            >
              <template #icon>
                <n-icon :component="DocumentTextOutline" />
              </template>
              <div class="tl-body">
                <div class="tl-line">
                  <strong>{{ row.email }}</strong>
                  <n-tag size="tiny" round :bordered="false">
                    {{ actionLabelZh[row.action] ?? row.action }}
                  </n-tag>
                </div>
                <div class="adm__muted" style="font-size: 12px">
                  账号注册 {{ row.userRegisteredAt }}
                </div>
                <div v-if="row.detail" class="adm__muted tl-detail">{{ row.detail }}</div>
                <div class="adm__muted" style="font-size: 12px">IP {{ row.ip ?? '—' }}</div>
              </div>
            </n-timeline-item>
          </n-timeline>
          <div v-else class="adm__muted" style="padding: 24px; text-align: center">
            暂无日志
          </div>
        </n-scrollbar>
      </n-spin>
    </n-card>
  </n-space>
</template>

<style scoped>
.erp-page__hdr {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 18px;
  flex-wrap: wrap;
}
</style>
