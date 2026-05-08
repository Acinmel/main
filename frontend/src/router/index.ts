import { createRouter, createWebHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'
import { useDigitalHumanStore } from '@/stores/digitalHuman'
import { useUserStore } from '@/stores/user'

const PUBLIC_ROUTE_NAMES = new Set(['landing', 'login', 'register'])

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    component: () => import('@/layouts/AppShellLayout.vue'),
    children: [
      {
        path: '',
        name: 'landing',
        meta: { title: 'AI 口播视频生成工具' },
        component: () => import('@/views/LandingView.vue'),
      },
      {
        path: 'digital-human',
        name: 'home',
        meta: { title: '专属数字人' },
        component: () => import('@/views/digital-human/DigitalHumanSetupView.vue'),
      },
      {
        path: 'resources',
        name: 'resource-library',
        meta: { title: '资源库', requiresActiveAccount: true },
        component: () => import('@/views/resources/ResourceLibraryView.vue'),
      },
      {
        path: 'exclusive-voice',
        name: 'exclusive-voice',
        meta: { title: '专属声音', requiresActiveAccount: true },
        component: () => import('@/views/voice/ExclusiveVoiceView.vue'),
      },
      {
        path: 'resources/avatars',
        name: 'avatar-library',
        redirect: { name: 'resource-library' },
      },
      {
        path: 'resources/voices',
        name: 'voice-library',
        redirect: { name: 'resource-library' },
      },
      {
        path: 'resources/subtitle-templates',
        name: 'subtitle-template-library',
        redirect: { name: 'resource-library' },
      },
      {
        path: 'studio',
        name: 'studio',
        meta: { title: '视频创作', requiresActiveAccount: true },
        component: () => import('@/views/CreativeStudioView.vue'),
      },
      {
        path: 'lip-sync',
        name: 'lip-sync',
        meta: { title: '视频对口型', requiresActiveAccount: true },
        redirect: { name: 'studio', query: { tab: 'lip-sync' } },
      },
      {
        path: 'login',
        name: 'login',
        meta: { title: '登录' },
        component: () => import('@/views/auth/LoginView.vue'),
      },
      {
        path: 'register',
        name: 'register',
        meta: { title: '注册' },
        component: () => import('@/views/auth/RegisterView.vue'),
      },
      {
        path: 'account-pending',
        name: 'account-pending',
        meta: { title: '账号审核中' },
        component: () => import('@/views/misc/AccountPendingView.vue'),
      },
      {
        path: 'tasks/new',
        name: 'task-create',
        meta: {
          title: '创建任务',
          requiresDigitalHuman: true,
          requiresActiveAccount: true,
        },
        component: () => import('@/views/task/TaskCreateView.vue'),
      },
      {
        path: 'tasks/:id/transcript',
        name: 'task-transcript',
        meta: {
          title: '文案提取',
          requiresDigitalHuman: true,
          requiresActiveAccount: true,
        },
        component: () => import('@/views/task/TaskTranscriptView.vue'),
      },
      {
        path: 'tasks/:id/rewrite',
        name: 'task-rewrite',
        meta: {
          title: '文案改写',
          requiresDigitalHuman: true,
          requiresActiveAccount: true,
        },
        component: () => import('@/views/task/TaskRewriteView.vue'),
      },
      {
        path: 'tasks/:id/settings',
        name: 'task-settings',
        meta: {
          title: '生成设置',
          requiresDigitalHuman: true,
          requiresActiveAccount: true,
        },
        component: () => import('@/views/task/TaskSettingsView.vue'),
      },
      {
        path: 'tasks/:id/progress',
        name: 'task-progress',
        meta: {
          title: '生成进度',
          requiresDigitalHuman: true,
          requiresActiveAccount: true,
        },
        component: () => import('@/views/task/TaskProgressView.vue'),
      },
      {
        path: 'tasks/:id/result',
        name: 'task-result',
        meta: {
          title: '成片结果',
          requiresDigitalHuman: true,
          requiresActiveAccount: true,
        },
        component: () => import('@/views/task/TaskResultView.vue'),
      },
    ],
  },
  {
    path: '/forbidden-admin',
    name: 'forbidden-admin',
    meta: { title: '权限不足' },
    component: () => import('@/views/misc/AdminForbiddenView.vue'),
  },
  /** 与 `/admin` 同义（避免旧链接或误记路径落到 404） */
  {
    path: '/erp',
    meta: { requiresAdmin: true },
    redirect: '/admin/dashboard',
  },
  {
    path: '/admin',
    name: 'admin',
    meta: { requiresAdmin: true },
    component: () => import('@/views/admin/AdminErpLayout.vue'),
    children: [
      {
        path: 'dashboard',
        name: 'erp-dashboard',
        meta: { title: '数据看板', requiresAdmin: true },
        component: () => import('@/views/admin/erp/ErpDashboardView.vue'),
      },
      {
        path: 'users',
        name: 'erp-users',
        meta: { title: '用户审核', requiresAdmin: true },
        component: () => import('@/views/admin/erp/ErpUsersView.vue'),
      },
      {
        path: 'audit',
        name: 'erp-audit',
        meta: { title: '操作日志', requiresAdmin: true },
        component: () => import('@/views/admin/erp/ErpAuditView.vue'),
      },
      /** 勿与父级同时写 redirect：部分环境下子路由无法匹配 → 客户端走通配 404 */
      { path: '', redirect: { name: 'erp-dashboard' } },
    ],
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    component: () => import('@/views/misc/NotFoundView.vue'),
  },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior() {
    return { top: 0 }
  },
})

router.afterEach((to) => {
  const base = '口播重制'
  document.title = to.meta.title ? `${to.meta.title} · ${base}` : base
})

const DIGITAL_HUMAN_REFRESH_MS = 12_000

router.beforeEach(async (to, _from, next) => {
  if (PUBLIC_ROUTE_NAMES.has(String(to.name))) {
    next()
    return
  }

  if (!localStorage.getItem('kb_token')) {
    next({ name: 'login', query: { redirect: to.fullPath } })
    return
  }

  const user = useUserStore()
  if (user.token && !user.profile) {
    try {
      await user.hydrateProfile()
    } catch {
      user.clearSession()
      next({ name: 'login', query: { redirect: to.fullPath } })
      return
    }
  }

  if (to.meta.requiresAdmin) {
    /** 进入后台前拉最新资料，避免已写入 ADMIN_EMAILS 但 Pinia 仍为旧 role */
    await user.hydrateProfile()
    if (!user.token) {
      next({ name: 'login', query: { redirect: to.fullPath } })
      return
    }
    if (user.profile?.role !== 'admin') {
      next({ name: 'forbidden-admin' })
      return
    }
    next()
    return
  }

  const pending =
    user.profile?.accountStatus === 'pending' && user.profile?.role !== 'admin'

  if (pending) {
    const allowedWhilePending = new Set([
      'account-pending',
      'login',
      'register',
      'forbidden-admin',
      'not-found',
    ])
    if (allowedWhilePending.has(String(to.name))) {
      next()
      return
    }
    next({ name: 'account-pending' })
    return
  }

  if (to.name === 'account-pending') {
    next({ name: 'home' })
    return
  }

  if (!to.meta.requiresDigitalHuman) {
    next()
    return
  }

  const store = useDigitalHumanStore()
  try {
    await Promise.race([
      store.refresh(),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('digitalHuman.refresh:timeout')), DIGITAL_HUMAN_REFRESH_MS)
      }),
    ])
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.includes('timeout')) {
      store.markReadyFromTimeout()
    }
  }
  if (!store.hasTemplate) {
    next({ name: 'home', query: { needDh: '1' } })
    return
  }
  next()
})

export default router
