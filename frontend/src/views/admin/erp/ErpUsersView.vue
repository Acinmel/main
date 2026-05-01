<script setup lang="ts">
import type { DataTableColumns } from 'naive-ui'
import {
  NButton,
  NDataTable,
  NIcon,
  NInput,
  NProgress,
  NSpace,
  NTag,
  useMessage,
} from 'naive-ui'
import { PeopleOutline } from '@vicons/ionicons5'
import { computed, h, onMounted, ref } from 'vue'
import { fetchAdminStats, fetchAdminUsers, patchAdminUser, type AdminUserRow } from '@/api/admin'

const message = useMessage()

const userRows = ref<AdminUserRow[]>([])
const userTotal = ref(0)
const userQ = ref('')
const userOffset = ref(0)
const pageSize = 30
const loadingUsers = ref(false)

async function loadUsers() {
  loadingUsers.value = true
  try {
    const r = await fetchAdminUsers({
      q: userQ.value || undefined,
      offset: userOffset.value,
      limit: pageSize,
    })
    userRows.value = r.items
    userTotal.value = r.total
  } catch (e: unknown) {
    message.error(e instanceof Error ? e.message : '加载用户失败')
  } finally {
    loadingUsers.value = false
  }
}

const maxUsagesOnPage = computed(() => {
  let m = 1
  for (const row of userRows.value) {
    const c = row.auditCounts
    if (!c) continue
    const a = (c.task_create ?? 0) + (c.render_submit ?? 0)
    if (a > m) m = a
  }
  return m
})

const userColumns: DataTableColumns<AdminUserRow> = [
  { title: '邮箱', key: 'email', ellipsis: { tooltip: true } },
  {
    title: '角色',
    key: 'role',
    width: 90,
    render: (row) =>
      h(
        NTag,
        { size: 'small', type: row.role === 'admin' ? 'success' : 'default' },
        { default: () => row.role },
      ),
  },
  {
    title: '状态',
    key: 'accountStatus',
    width: 96,
    render: (row) => {
      const map: Record<string, 'default' | 'warning' | 'error' | 'success'> = {
        active: 'success',
        pending: 'warning',
        disabled: 'error',
      }
      return h(NTag, { size: 'small', type: map[row.accountStatus] ?? 'default' }, {
        default: () => row.accountStatus,
      })
    },
  },
  {
    title: '口播与作品（与前台同源）',
    key: 'kouboBiz',
    minWidth: 216,
    render: (row) => {
      const k = row.koubo
      return h(NSpace, { vertical: true, size: 6 }, {
        default: () => [
          h(
            'div',
            { class: 'usage-cap' },
            `作品条目 ${k?.worksCount ?? 0} · user_works`,
          ),
          h(
            'div',
            {
              class: 'adm__muted',
              style: 'font-size:12px;line-height:1.4',
            },
            k?.lastWorkAt ? `最近更新 ${k.lastWorkAt}` : '尚无任务/作品入库',
          ),
          h(
            NTag,
            {
              size: 'small',
              bordered: false,
              type: k?.digitalHumanConfigured ? 'success' : 'default',
            },
            {
              default: () =>
                k?.digitalHumanConfigured ? '专属数字人已配置' : '未保存专属数字人',
            },
          ),
        ],
      })
    },
  },
  {
    title: '审计打点（相对本页）',
    key: 'usage',
    minWidth: 200,
    render: (row) => {
      const c = row.auditCounts
      const tc = c?.task_create ?? 0
      const rs = c?.render_submit ?? 0
      const denom = maxUsagesOnPage.value
      const p1 = denom ? Math.min(100, Math.round((tc / denom) * 100)) : 0
      const p2 = denom ? Math.min(100, Math.round((rs / denom) * 100)) : 0
      return h(NSpace, { vertical: true, size: 4 }, {
        default: () => [
          h('div', { class: 'usage-cap' }, `任务 ${tc}`),
          h(NProgress, {
            type: 'line',
            percentage: p1,
            height: 6,
            showIndicator: false,
            railColor: 'rgba(148, 163, 184, 0.15)',
            color: '#38bdf8',
          }),
          h('div', { class: 'usage-cap' }, `生成 ${rs}`),
          h(NProgress, {
            type: 'line',
            percentage: p2,
            height: 6,
            showIndicator: false,
            railColor: 'rgba(148, 163, 184, 0.15)',
            color: '#a78bfa',
          }),
        ],
      })
    },
  },
  {
    title: '操作',
    key: 'actions',
    width: 220,
    render: (row) =>
      h(
        NSpace,
        { size: 8 },
        {
          default: () => [
            h(
              NButton,
              {
                size: 'tiny',
                type: 'primary',
                tertiary: true,
                disabled: row.accountStatus === 'active',
                onClick: () => void setStatus(row, 'active'),
              },
              { default: () => '开通' },
            ),
            h(
              NButton,
              {
                size: 'tiny',
                secondary: true,
                disabled: row.accountStatus === 'disabled',
                onClick: () => void setStatus(row, 'disabled'),
              },
              { default: () => '停用' },
            ),
            h(
              NButton,
              {
                size: 'tiny',
                quaternary: true,
                disabled: row.role === 'admin',
                onClick: () => void makeAdmin(row),
              },
              { default: () => '设管理员' },
            ),
          ],
        },
      ),
  },
]

async function setStatus(row: AdminUserRow, accountStatus: 'active' | 'disabled') {
  try {
    await patchAdminUser(row.id, { accountStatus })
    message.success('已更新')
    await loadUsers()
    await fetchAdminStats()
  } catch (e: unknown) {
    message.error(e instanceof Error ? e.message : '更新失败')
  }
}

async function makeAdmin(row: AdminUserRow) {
  try {
    await patchAdminUser(row.id, { role: 'admin', accountStatus: 'active' })
    message.success('已设为管理员并开通')
    await loadUsers()
    await fetchAdminStats()
  } catch (e: unknown) {
    message.error(e instanceof Error ? e.message : '更新失败')
  }
}

onMounted(() => {
  void loadUsers()
})
</script>

<template>
  <header class="erp-page__hdr">
    <div class="adm__brand">
      <n-icon :component="PeopleOutline" :size="28" color="#a78bfa" />
      <div>
        <h1 class="adm__title">用户审核</h1>
        <p class="adm__muted">搜索、分页、开通与角色管理</p>
      </div>
    </div>
  </header>

  <n-space vertical :size="14" style="width: 100%">
    <n-space align="center" flex-wrap="wrap">
      <n-input
        v-model:value="userQ"
        clearable
        placeholder="搜索邮箱 / ID"
        style="width: min(100%, 280px)"
        @keyup.enter="() => ((userOffset = 0), void loadUsers())"
      />
      <n-button
        type="primary"
        secondary
        @click="() => ((userOffset = 0), void loadUsers())"
      >
        搜索
      </n-button>
      <n-button
        :disabled="userOffset <= 0"
        @click="() => ((userOffset = Math.max(0, userOffset - pageSize)), void loadUsers())"
      >
        上一页
      </n-button>
      <n-button
        :disabled="userOffset + pageSize >= userTotal"
        @click="() => ((userOffset += pageSize), void loadUsers())"
      >
        下一页
      </n-button>
      <span class="adm__muted">共 {{ userTotal }} 条</span>
    </n-space>
    <n-data-table
      :columns="userColumns"
      :data="userRows"
      :loading="loadingUsers"
      :bordered="false"
      :single-line="false"
      size="small"
      class="glass-table"
    />
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
