<script setup lang="ts">
import {
  NAlert,
  NButton,
  NCard,
  NDataTable,
  NGi,
  NGrid,
  NIcon,
  NInput,
  NSpace,
  NSpin,
  NTag,
  useMessage,
  type DataTableColumns,
} from 'naive-ui'
import {
  AlbumsOutline,
  ArrowForwardOutline,
  BarChartOutline,
  DocumentTextOutline,
  LayersOutline,
  PeopleOutline,
  RefreshOutline,
} from '@vicons/ionicons5'
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  fetchAdminAuditLogs,
  fetchAdminDigitalHumanTemplates,
  fetchAdminStats,
  fetchAdminUserWorks,
  type AdminDigitalHumanRow,
  type AdminUserWorkRow,
} from '@/api/admin'
import { actionLabelZh } from './adminConstants'

const detailPageSize = 15

const router = useRouter()
const message = useMessage()

const stats = ref<Awaited<ReturnType<typeof fetchAdminStats>> | null>(null)
const loadingStats = ref(false)

const auditPreview = ref<
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
const loadingAuditsPreview = ref(false)

async function loadStats() {
  stats.value = await fetchAdminStats()
}

async function loadAuditPreview() {
  loadingAuditsPreview.value = true
  try {
    const r = await fetchAdminAuditLogs({ offset: 0, limit: 8 })
    auditPreview.value = r.items
  } catch (e: unknown) {
    message.error(e instanceof Error ? e.message : '加载预览失败')
  } finally {
    loadingAuditsPreview.value = false
  }
}

const worksQ = ref('')
const worksOffset = ref(0)
const worksRows = ref<AdminUserWorkRow[]>([])
const worksTotal = ref(0)
const loadingWorks = ref(false)

const dhQ = ref('')
const dhOffset = ref(0)
const dhRows = ref<AdminDigitalHumanRow[]>([])
const dhTotal = ref(0)
const loadingDh = ref(false)

const workColumns: DataTableColumns<AdminUserWorkRow> = [
  { title: '用户邮箱', key: 'email', width: 200, ellipsis: { tooltip: true } },
  { title: '用户 ID', key: 'userId', width: 120, ellipsis: { tooltip: true } },
  { title: '作品标题', key: 'title', minWidth: 140, ellipsis: { tooltip: true } },
  { title: '状态', key: 'status', width: 100 },
  {
    title: '源视频',
    key: 'sourceVideoUrl',
    minWidth: 160,
    ellipsis: { tooltip: true },
  },
  { title: '更新于', key: 'updatedAt', width: 168 },
]

const dhColumns: DataTableColumns<AdminDigitalHumanRow> = [
  { title: '用户邮箱', key: 'email', width: 200, ellipsis: { tooltip: true } },
  { title: '用户 ID', key: 'userId', width: 120, ellipsis: { tooltip: true } },
  { title: '风格 styleId', key: 'styleId', width: 140, ellipsis: { tooltip: true } },
  {
    title: '输出相对路径',
    key: 'outputRelativePath',
    minWidth: 160,
    ellipsis: { tooltip: true },
  },
  {
    title: '自拍相对路径',
    key: 'selfieRelativePath',
    minWidth: 160,
    ellipsis: { tooltip: true },
  },
  { title: '更新于', key: 'updatedAt', width: 168 },
]

async function loadWorksList() {
  loadingWorks.value = true
  try {
    const r = await fetchAdminUserWorks({
      q: worksQ.value || undefined,
      offset: worksOffset.value,
      limit: detailPageSize,
    })
    worksRows.value = r.items
    worksTotal.value = r.total
  } catch (e: unknown) {
    message.error(e instanceof Error ? e.message : '加载作品明细失败')
  } finally {
    loadingWorks.value = false
  }
}

async function loadDhList() {
  loadingDh.value = true
  try {
    const r = await fetchAdminDigitalHumanTemplates({
      q: dhQ.value || undefined,
      offset: dhOffset.value,
      limit: detailPageSize,
    })
    dhRows.value = r.items
    dhTotal.value = r.total
  } catch (e: unknown) {
    message.error(e instanceof Error ? e.message : '加载数字人配置明细失败')
  } finally {
    loadingDh.value = false
  }
}

async function refreshDashboard() {
  loadingStats.value = true
  try {
    await loadStats()
    await loadAuditPreview()
    await Promise.all([loadWorksList(), loadDhList()])
  } finally {
    loadingStats.value = false
  }
}

const distributionRows = computed(() => {
  const list = stats.value?.byAction ?? []
  const sum = list.reduce((s, x) => s + x.count, 0) || 1
  return list.map((x) => ({
    ...x,
    pct: Math.round((x.count / sum) * 1000) / 10,
    barWidth: `${Math.max(6, Math.round((x.count / sum) * 100))}%`,
    zh: actionLabelZh[x.action] ?? x.action,
  }))
})

const donutStyle = computed(() => {
  const list = stats.value?.byAction ?? []
  if (list.length === 0) {
    return {
      background: 'conic-gradient(#334155 0deg 360deg)',
    }
  }
  const sum = list.reduce((s, x) => s + x.count, 0) || 1
  const hues = ['#38bdf8', '#a78bfa', '#34d399', '#fbbf24', '#fb7185', '#94a3b8']
  let cursor = 0
  const parts: string[] = []
  list.forEach((x, i) => {
    const deg = (x.count / sum) * 360
    const h = hues[i % hues.length]
    const start = cursor
    const end = cursor + deg
    parts.push(`${h} ${start}deg ${end}deg`)
    cursor = end
  })
  return {
    background: `conic-gradient(${parts.join(', ')})`,
  }
})

const auditsPerUser = computed(() => {
  const n = stats.value?.userCount ?? 0
  const t = stats.value?.auditsTotal ?? 0
  if (n <= 0) return '—'
  return (Math.round((t / n) * 10) / 10).toFixed(1)
})

function actionTagType(
  action: string,
): 'default' | 'success' | 'info' | 'warning' | 'error' {
  if (action === 'render_submit') return 'success'
  if (action === 'task_create') return 'info'
  if (action === 'user_register') return 'success'
  if (action === 'user_login') return 'warning'
  return 'default'
}

onMounted(() => {
  void refreshDashboard()
})
</script>

<template>
  <header class="erp-dash__hdr">
    <div class="adm__brand">
      <n-icon :component="BarChartOutline" :size="28" color="#38bdf8" />
      <div>
        <h1 class="adm__title">数据看板</h1>
        <p class="adm__muted">关键指标 · 操作分布 · 最近审计动态</p>
      </div>
    </div>
    <div class="adm__toolbar">
      <n-button
        :loading="loadingStats && stats === null"
        circle
        quaternary
        @click="refreshDashboard"
      >
        <template #icon><n-icon :component="RefreshOutline" /></template>
      </n-button>
    </div>
  </header>

  <n-alert
    type="info"
    title="权限说明"
    :bordered="false"
    show-icon
    class="glass adm__policy"
  >
    用户在<strong>未开通（pending）</strong>时仅能登录并配置<strong>专属数字人</strong>，
    <strong>无法调用生成类 API</strong>。在「用户审核」中开通 / 停用 / 设管理员后立即生效。
  </n-alert>

  <n-grid cols="1 s:2" responsive="screen" :x-gap="16" :y-gap="16" class="erp-quick">
    <n-gi>
      <n-card
        size="small"
        class="glass"
        :bordered="false"
        hoverable
        style="cursor: pointer"
        @click="router.push({ name: 'erp-users' })"
      >
        <div class="erp-quick__link">
          <div>
            <strong>用户审核</strong>
            <div class="erp-quick__hint">开通、停用、分配管理员</div>
          </div>
          <n-icon :component="ArrowForwardOutline" :size="22" opacity="0.65" />
        </div>
      </n-card>
    </n-gi>
    <n-gi>
      <n-card
        size="small"
        class="glass"
        :bordered="false"
        hoverable
        style="cursor: pointer"
        @click="router.push({ name: 'erp-audit' })"
      >
        <div class="erp-quick__link">
          <div>
            <strong>操作日志</strong>
            <div class="erp-quick__hint">全量审计与时间线</div>
          </div>
          <n-icon :component="ArrowForwardOutline" :size="22" opacity="0.65" />
        </div>
      </n-card>
    </n-gi>
  </n-grid>

  <n-spin :show="loadingStats && stats === null">
    <template v-if="stats">
      <n-grid cols="1 s:2 l:4" responsive="screen" :x-gap="16" :y-gap="16" class="adm__kpi">
        <n-gi>
          <n-card size="small" class="glass kpi" :bordered="false">
            <div class="kpi__inner">
              <div class="kpi__ico kpi__ico--a">
                <n-icon :component="PeopleOutline" :size="26" />
              </div>
              <div class="kpi__meta">
                <span class="kpi__lbl">注册用户</span>
                <strong class="kpi__val">{{ stats.userCount }}</strong>
              </div>
            </div>
          </n-card>
        </n-gi>
        <n-gi>
          <n-card size="small" class="glass kpi" :bordered="false">
            <div class="kpi__inner">
              <div class="kpi__ico kpi__ico--b">
                <n-icon :component="LayersOutline" :size="26" />
              </div>
              <div class="kpi__meta">
                <span class="kpi__lbl">审计记录</span>
                <strong class="kpi__val">{{ stats.auditsTotal }}</strong>
              </div>
            </div>
          </n-card>
        </n-gi>
        <n-gi>
          <n-card size="small" class="glass kpi" :bordered="false">
            <div class="kpi__inner">
              <div class="kpi__ico kpi__ico--c">
                <n-icon :component="AlbumsOutline" :size="26" />
              </div>
              <div class="kpi__meta">
                <span class="kpi__lbl">人均操作（审计/用户）</span>
                <strong class="kpi__val">{{ auditsPerUser }}</strong>
              </div>
            </div>
          </n-card>
        </n-gi>
        <n-gi>
          <n-card size="small" class="glass kpi kpi--ring" :bordered="false">
            <div class="ring-wrap">
              <div class="ring" aria-hidden="true">
                <div class="ring__donut" :style="donutStyle" />
                <div class="ring__hole" />
              </div>
              <div class="ring__caption">
                <span class="kpi__lbl">操作类型占比</span>
                <span class="adm__muted" style="font-size: 12px">
                  {{ stats.byAction?.length ? '右栏为分项条形图' : '暂无统计数据' }}
                </span>
              </div>
            </div>
          </n-card>
        </n-gi>
      </n-grid>

      <n-grid cols="1 s:2" responsive="screen" :x-gap="16" :y-gap="16" class="adm__kpi adm__kpi--sub">
        <n-gi>
          <n-card size="small" class="glass kpi" :bordered="false">
            <div class="kpi__inner">
              <div class="kpi__ico kpi__ico--b">
                <n-icon :component="DocumentTextOutline" :size="26" />
              </div>
              <div class="kpi__meta">
                <span class="kpi__lbl">口播作品条目（user_works）</span>
                <strong class="kpi__val">{{ stats.kouboWorksTotal ?? '—' }}</strong>
              </div>
            </div>
          </n-card>
        </n-gi>
        <n-gi>
          <n-card size="small" class="glass kpi" :bordered="false">
            <div class="kpi__inner">
              <div class="kpi__ico kpi__ico--a">
                <n-icon :component="AlbumsOutline" :size="26" />
              </div>
              <div class="kpi__meta">
                <span class="kpi__lbl">已配专属数字人（模板表）</span>
                <strong class="kpi__val">{{ stats.digitalHumanUsers ?? '—' }}</strong>
              </div>
            </div>
          </n-card>
        </n-gi>
      </n-grid>

      <n-card
        title="口播作品明细（user_works）"
        size="small"
        class="glass chart-card"
        :bordered="false"
      >
        <n-space vertical :size="12" style="width: 100%">
          <n-space align="center" flex-wrap="wrap">
            <n-input
              v-model:value="worksQ"
              clearable
              placeholder="筛选：邮箱 / 标题 / 作品或用户 ID"
              style="width: min(100%, 360px)"
              @keyup.enter="() => ((worksOffset = 0), void loadWorksList())"
            />
            <n-button
              type="primary"
              secondary
              @click="() => ((worksOffset = 0), void loadWorksList())"
            >
              搜索
            </n-button>
            <n-button
              :disabled="worksOffset <= 0"
              @click="
                () => (
                  (worksOffset = Math.max(0, worksOffset - detailPageSize)),
                  void loadWorksList()
                )
              "
            >
              上一页
            </n-button>
            <n-button
              :disabled="worksOffset + detailPageSize >= worksTotal"
              @click="() => ((worksOffset += detailPageSize), void loadWorksList())"
            >
              下一页
            </n-button>
            <span class="adm__muted">共 {{ worksTotal }} 条</span>
          </n-space>
          <n-data-table
            :columns="workColumns"
            :data="worksRows"
            :loading="loadingWorks"
            :bordered="false"
            :single-line="false"
            size="small"
            class="glass-table"
          />
        </n-space>
      </n-card>

      <n-card
        title="专属数字人模板明细（digital_human_templates）"
        size="small"
        class="glass chart-card"
        :bordered="false"
      >
        <n-space vertical :size="12" style="width: 100%">
          <n-space align="center" flex-wrap="wrap">
            <n-input
              v-model:value="dhQ"
              clearable
              placeholder="筛选：邮箱 / 用户 ID / styleId"
              style="width: min(100%, 360px)"
              @keyup.enter="() => ((dhOffset = 0), void loadDhList())"
            />
            <n-button type="primary" secondary @click="() => ((dhOffset = 0), void loadDhList())">
              搜索
            </n-button>
            <n-button
              :disabled="dhOffset <= 0"
              @click="
                () => ((dhOffset = Math.max(0, dhOffset - detailPageSize)), void loadDhList())
              "
            >
              上一页
            </n-button>
            <n-button
              :disabled="dhOffset + detailPageSize >= dhTotal"
              @click="() => ((dhOffset += detailPageSize), void loadDhList())"
            >
              下一页
            </n-button>
            <span class="adm__muted">共 {{ dhTotal }} 条</span>
          </n-space>
          <n-data-table
            :columns="dhColumns"
            :data="dhRows"
            :loading="loadingDh"
            :bordered="false"
            :single-line="false"
            size="small"
            class="glass-table"
          />
        </n-space>
      </n-card>

      <n-card title="操作类型分布（审计打点）" size="small" class="glass chart-card" :bordered="false">
        <div v-if="distributionRows.length" class="bars">
          <div v-for="row in distributionRows" :key="row.action" class="bar-row">
            <span class="bar-row__lbl">{{ row.zh }}</span>
            <div class="bar-row__track">
              <div
                class="bar-row__fill"
                :style="{
                  width: row.barWidth,
                  opacity: Math.max(0.45, row.pct / 100),
                }"
              />
            </div>
            <span class="bar-row__pct">{{ row.pct }}%</span>
            <n-tag size="small" round :bordered="false">{{ row.count }}</n-tag>
          </div>
        </div>
        <n-alert v-else type="info" :bordered="false" style="background: transparent">
          暂无审计数据；用户发起「创建任务」或「生成成片」后会在此聚合展示。
        </n-alert>
      </n-card>

      <n-card title="最近审计（预览）" size="small" class="glass" :bordered="false">
        <n-spin :show="loadingAuditsPreview">
          <n-space vertical :size="10" style="width: 100%">
            <template v-if="auditPreview.length">
              <div
                v-for="row in auditPreview"
                :key="row.id"
                style="
                  display: flex;
                  flex-wrap: wrap;
                  gap: 8px 12px;
                  align-items: center;
                  padding: 10px 0;
                  border-bottom: 1px solid rgba(148, 163, 184, 0.12);
                "
              >
                <span class="adm__muted" style="font-size: 12px; min-width: 148px">
                  {{ row.createdAt }}
                </span>
                <strong>{{ row.email }}</strong>
                <span class="adm__muted" style="font-size: 11px">注册 {{ row.userRegisteredAt }}</span>
                <n-tag size="tiny" round :bordered="false" :type="actionTagType(row.action)">
                  {{ actionLabelZh[row.action] ?? row.action }}
                </n-tag>
                <span v-if="row.detail" class="adm__muted" style="flex: 1; min-width: 120px">
                  {{ row.detail }}
                </span>
              </div>
            </template>
            <div v-else class="adm__muted" style="padding: 8px 0">
              暂无记录
            </div>
            <n-button tertiary size="small" @click="router.push({ name: 'erp-audit' })">
              查看全部日志
            </n-button>
          </n-space>
        </n-spin>
      </n-card>
    </template>
  </n-spin>

  <p class="adm__muted" style="text-align: center; font-size: 12px; margin: 28px 0 12px">
    数据来源：服务端 audit_logs · 柱状与环形为可视化汇总
  </p>
</template>

<style scoped>
.erp-dash__hdr {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 14px;
  flex-wrap: wrap;
}
.kpi__meta {
  min-width: 0;
}
</style>
