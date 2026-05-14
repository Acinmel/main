<script setup lang="ts">
import type { DataTableColumns } from 'naive-ui'
import {
  NButton,
  NCard,
  NDataTable,
  NIcon,
  NInput,
  NRadioButton,
  NRadioGroup,
  NSpace,
  NTag,
  useMessage,
} from 'naive-ui'
import { AlbumsOutline, RefreshOutline } from '@vicons/ionicons5'
import { computed, h, onMounted, ref } from 'vue'
import {
  fetchAdminDigitalHumanTemplates,
  fetchAdminResources,
  fetchAdminUserWorks,
  type AdminDigitalHumanRow,
  type AdminResourceKind,
  type AdminResourceRow,
  type AdminUserWorkRow,
} from '@/api/admin'

const pageSize = 20
const message = useMessage()

const q = ref('')
const resourceKind = ref<AdminResourceKind>('avatars')

const resourceRows = ref<AdminResourceRow[]>([])
const resourceTotal = ref(0)
const resourceOffset = ref(0)
const loadingResources = ref(false)

const workRows = ref<AdminUserWorkRow[]>([])
const workTotal = ref(0)
const workOffset = ref(0)
const loadingWorks = ref(false)

const dhRows = ref<AdminDigitalHumanRow[]>([])
const dhTotal = ref(0)
const dhOffset = ref(0)
const loadingDh = ref(false)

const kindLabel: Record<AdminResourceKind, string> = {
  avatars: '数字人视频',
  voices: '声音克隆',
  'subtitle-templates': '字幕模板',
}

const totalManagedRows = computed(
  () => resourceTotal.value + workTotal.value + dhTotal.value,
)

function ownerTag(row: { recommended?: boolean; owner?: string }) {
  return h(
    NTag,
    {
      size: 'small',
      bordered: false,
      type: row.recommended || row.owner === 'recommended' ? 'success' : 'info',
    },
    {
      default: () =>
        row.recommended || row.owner === 'recommended'
          ? '通用案例'
          : '用户私有',
    },
  )
}

const resourceColumns: DataTableColumns<AdminResourceRow> = [
  { title: '名称', key: 'name', minWidth: 160, ellipsis: { tooltip: true } },
  {
    title: '类型',
    key: 'kind',
    width: 112,
    render: (row) => kindLabel[row.kind],
  },
  { title: '归属', key: 'owner', width: 106, render: ownerTag },
  { title: '用户', key: 'email', minWidth: 180, ellipsis: { tooltip: true } },
  {
    title: '状态 / 服务',
    key: 'status',
    minWidth: 140,
    render: (row) => row.cloneStatus || row.provider || 'ready',
  },
  {
    title: '媒体 / 详情',
    key: 'mediaUrl',
    minWidth: 220,
    ellipsis: { tooltip: true },
  },
  { title: '更新于', key: 'updatedAt', width: 168 },
]

const workColumns: DataTableColumns<AdminUserWorkRow> = [
  { title: '标题', key: 'title', minWidth: 160, ellipsis: { tooltip: true } },
  { title: '用户', key: 'email', minWidth: 180, ellipsis: { tooltip: true } },
  { title: '状态', key: 'status', width: 100 },
  {
    title: '源视频',
    key: 'sourceVideoUrl',
    minWidth: 220,
    ellipsis: { tooltip: true },
  },
  { title: '更新于', key: 'updatedAt', width: 168 },
]

const dhColumns: DataTableColumns<AdminDigitalHumanRow> = [
  { title: '用户', key: 'email', minWidth: 180, ellipsis: { tooltip: true } },
  { title: '风格', key: 'styleId', width: 132, ellipsis: { tooltip: true } },
  {
    title: '输出路径',
    key: 'outputRelativePath',
    minWidth: 220,
    ellipsis: { tooltip: true },
  },
  {
    title: '自拍路径',
    key: 'selfieRelativePath',
    minWidth: 220,
    ellipsis: { tooltip: true },
  },
  { title: '更新于', key: 'updatedAt', width: 168 },
]

async function loadResources() {
  loadingResources.value = true
  try {
    const r = await fetchAdminResources({
      kind: resourceKind.value,
      q: q.value || undefined,
      offset: resourceOffset.value,
      limit: pageSize,
    })
    resourceRows.value = r.items
    resourceTotal.value = r.total
  } catch (e: unknown) {
    message.error(e instanceof Error ? e.message : '加载素材数据失败')
  } finally {
    loadingResources.value = false
  }
}

async function loadWorks() {
  loadingWorks.value = true
  try {
    const r = await fetchAdminUserWorks({
      q: q.value || undefined,
      offset: workOffset.value,
      limit: pageSize,
    })
    workRows.value = r.items
    workTotal.value = r.total
  } catch (e: unknown) {
    message.error(e instanceof Error ? e.message : '加载作品数据失败')
  } finally {
    loadingWorks.value = false
  }
}

async function loadDigitalHumans() {
  loadingDh.value = true
  try {
    const r = await fetchAdminDigitalHumanTemplates({
      q: q.value || undefined,
      offset: dhOffset.value,
      limit: pageSize,
    })
    dhRows.value = r.items
    dhTotal.value = r.total
  } catch (e: unknown) {
    message.error(e instanceof Error ? e.message : '加载数字人模板失败')
  } finally {
    loadingDh.value = false
  }
}

async function refreshAll() {
  await Promise.all([loadResources(), loadWorks(), loadDigitalHumans()])
}

function searchAll() {
  resourceOffset.value = 0
  workOffset.value = 0
  dhOffset.value = 0
  void refreshAll()
}

function page(delta: number, target: 'resources' | 'works' | 'dh') {
  if (target === 'resources') {
    resourceOffset.value = Math.max(0, resourceOffset.value + delta * pageSize)
    void loadResources()
  } else if (target === 'works') {
    workOffset.value = Math.max(0, workOffset.value + delta * pageSize)
    void loadWorks()
  } else {
    dhOffset.value = Math.max(0, dhOffset.value + delta * pageSize)
    void loadDigitalHumans()
  }
}

onMounted(() => {
  void refreshAll()
})
</script>

<template>
  <header class="erp-page__hdr">
    <div class="adm__brand">
      <n-icon :component="AlbumsOutline" :size="28" color="#38bdf8" />
      <div>
        <h1 class="adm__title">数据管理</h1>
        <p class="adm__muted">
          统一查看素材库、作品流水和数字人模板，方便联调权限与数据归属。
        </p>
      </div>
    </div>
    <n-button circle quaternary @click="refreshAll">
      <template #icon><n-icon :component="RefreshOutline" /></template>
    </n-button>
  </header>

  <section class="data-hero glass">
    <div>
      <span class="data-hero__eyebrow">ADMIN DATA HUB</span>
      <strong>{{ totalManagedRows }}</strong>
      <p>当前筛选下的可管理数据总量</p>
    </div>
    <n-space align="center" wrap>
      <n-input
        v-model:value="q"
        clearable
        placeholder="搜索邮箱 / 标题 / 名称 / ID"
        class="data-hero__search"
        @keyup.enter="searchAll"
      />
      <n-button type="primary" @click="searchAll">搜索全部</n-button>
    </n-space>
  </section>

  <n-space vertical :size="16" style="width: 100%">
    <n-card title="素材库数据" size="small" class="glass" :bordered="false">
      <n-space vertical :size="12">
        <n-space justify="space-between" align="center" wrap>
          <n-radio-group
            v-model:value="resourceKind"
            size="small"
            @update:value="() => ((resourceOffset = 0), void loadResources())"
          >
            <n-radio-button value="avatars">数字人视频</n-radio-button>
            <n-radio-button value="voices">声音克隆</n-radio-button>
            <n-radio-button value="subtitle-templates">字幕模板</n-radio-button>
          </n-radio-group>
          <span class="adm__muted">共 {{ resourceTotal }} 条</span>
        </n-space>
        <n-data-table
          :columns="resourceColumns"
          :data="resourceRows"
          :loading="loadingResources"
          :bordered="false"
          :single-line="false"
          size="small"
          class="glass-table"
        />
        <n-space justify="end">
          <n-button
            :disabled="resourceOffset <= 0"
            @click="page(-1, 'resources')"
            >上一页</n-button
          >
          <n-button
            :disabled="resourceOffset + pageSize >= resourceTotal"
            @click="page(1, 'resources')"
          >
            下一页
          </n-button>
        </n-space>
      </n-space>
    </n-card>

    <n-card title="口播作品数据" size="small" class="glass" :bordered="false">
      <n-data-table
        :columns="workColumns"
        :data="workRows"
        :loading="loadingWorks"
        :bordered="false"
        :single-line="false"
        size="small"
        class="glass-table"
      />
      <n-space justify="space-between" align="center" class="data-card__pager">
        <span class="adm__muted">共 {{ workTotal }} 条</span>
        <n-space>
          <n-button :disabled="workOffset <= 0" @click="page(-1, 'works')"
            >上一页</n-button
          >
          <n-button
            :disabled="workOffset + pageSize >= workTotal"
            @click="page(1, 'works')"
          >
            下一页
          </n-button>
        </n-space>
      </n-space>
    </n-card>

    <n-card title="数字人模板数据" size="small" class="glass" :bordered="false">
      <n-data-table
        :columns="dhColumns"
        :data="dhRows"
        :loading="loadingDh"
        :bordered="false"
        :single-line="false"
        size="small"
        class="glass-table"
      />
      <n-space justify="space-between" align="center" class="data-card__pager">
        <span class="adm__muted">共 {{ dhTotal }} 条</span>
        <n-space>
          <n-button :disabled="dhOffset <= 0" @click="page(-1, 'dh')"
            >上一页</n-button
          >
          <n-button
            :disabled="dhOffset + pageSize >= dhTotal"
            @click="page(1, 'dh')"
          >
            下一页
          </n-button>
        </n-space>
      </n-space>
    </n-card>
  </n-space>
</template>

<style scoped>
.erp-page__hdr {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 24px;
  flex-wrap: wrap;
}

.data-hero {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 24px;
  padding: 24px 26px;
  border-radius: 24px;
}

.data-hero__eyebrow {
  display: block;
  color: #346bff;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.16em;
}

.data-hero strong {
  display: block;
  margin-top: 4px;
  color: #16243a;
  font-size: 34px;
  line-height: 1;
}

.data-hero p {
  margin: 6px 0 0;
  color: #64748b;
  font-size: 13px;
}

.data-hero__search {
  width: min(56vw, 380px);
}

.data-card__pager {
  margin-top: 12px;
}

@media (max-width: 760px) {
  .data-hero {
    align-items: stretch;
    flex-direction: column;
  }

  .data-hero__search {
    width: 100%;
  }
}
</style>
