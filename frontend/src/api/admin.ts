import { http } from '@/api/http'

export interface AdminUserRow {
  id: string
  email: string
  role: 'user' | 'admin'
  accountStatus: 'pending' | 'active' | 'disabled'
  createdAt: string
  auditCounts?: Record<string, number>
  /** 与前接口播任务、「我的作品」表 user_works + digital_human_templates 对齐 */
  koubo: {
    worksCount: number
    lastWorkAt: string | null
    digitalHumanConfigured: boolean
  }
}

export interface AdminStats {
  userCount: number
  auditsTotal: number
  byAction: { action: string; count: number }[]
  /** 全库 user_works 行数，与前台「我的作品」列表同源 */
  kouboWorksTotal: number
  /** 已在 digital_human_templates 中的用户数 */
  digitalHumanUsers: number
}

export async function fetchAdminStats() {
  const { data } = await http.get<AdminStats>('v1/admin/stats', { timeout: 30_000 })
  return data
}

export async function fetchAdminUsers(opts: { q?: string; offset?: number; limit?: number }) {
  const { data } = await http.get<{ items: AdminUserRow[]; total: number }>('v1/admin/users', {
    params: opts,
    timeout: 30_000,
  })
  return data
}

export async function patchAdminUser(
  id: string,
  body: Partial<{ role: 'user' | 'admin'; accountStatus: 'pending' | 'active' | 'disabled' }>,
) {
  const { data } = await http.patch<{ ok: true }>(
    `v1/admin/users/${encodeURIComponent(id)}`,
    body,
    { timeout: 30_000 },
  )
  return data
}

export async function fetchAdminAuditLogs(opts: { q?: string; offset?: number; limit?: number }) {
  const { data } = await http.get<{
    total: number
    items: {
      id: string
      userId: string
      email: string
      userRegisteredAt: string
      action: string
      detail: string | null
      ip: string | null
      createdAt: string
    }[]
  }>('v1/admin/audit-logs', { params: opts, timeout: 30_000 })
  return data
}

export interface AdminUserWorkRow {
  id: string
  userId: string
  email: string
  title: string
  status: string
  sourceVideoUrl: string
  createdAt: string
  updatedAt: string
}

export interface AdminDigitalHumanRow {
  userId: string
  email: string
  styleId: string
  outputRelativePath: string
  selfieRelativePath: string
  createdAt: string
  updatedAt: string
}

export async function fetchAdminUserWorks(opts: { q?: string; offset?: number; limit?: number }) {
  const { data } = await http.get<{ items: AdminUserWorkRow[]; total: number }>('v1/admin/user-works', {
    params: opts,
    timeout: 30_000,
  })
  return data
}

export async function fetchAdminDigitalHumanTemplates(opts: {
  q?: string
  offset?: number
  limit?: number
}) {
  const { data } = await http.get<{ items: AdminDigitalHumanRow[]; total: number }>(
    'v1/admin/digital-human-templates',
    { params: opts, timeout: 30_000 },
  )
  return data
}
