import { createRouter, createWebHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'
import { useDigitalHumanStore } from '@/stores/digitalHuman'

const PUBLIC_ROUTE_NAMES = new Set(['login', 'register'])

/**
 * 路由表：与 PRD 页面一一对应，后续可挂路由守卫（登录态）
 */
const routes: RouteRecordRaw[] = [
  {
    path: '/',
    component: () => import('@/layouts/AppShellLayout.vue'),
    children: [
      {
        path: '',
        name: 'home',
        meta: { title: '专属数字人' },
        component: () => import('@/views/digital-human/DigitalHumanSetupView.vue'),
      },
      {
        path: 'studio',
        name: 'studio',
        meta: { title: '口播制作' },
        component: () => import('@/views/HomeView.vue'),
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
        path: 'tasks/new',
        name: 'task-create',
        meta: { title: '创建任务', requiresDigitalHuman: true },
        component: () => import('@/views/task/TaskCreateView.vue'),
      },
      {
        path: 'tasks/:id/transcript',
        name: 'task-transcript',
        meta: { title: '文案提取', requiresDigitalHuman: true },
        component: () => import('@/views/task/TaskTranscriptView.vue'),
      },
      {
        path: 'tasks/:id/rewrite',
        name: 'task-rewrite',
        meta: { title: '文案改写', requiresDigitalHuman: true },
        component: () => import('@/views/task/TaskRewriteView.vue'),
      },
      {
        path: 'tasks/:id/settings',
        name: 'task-settings',
        meta: { title: '生成设置', requiresDigitalHuman: true },
        component: () => import('@/views/task/TaskSettingsView.vue'),
      },
      {
        path: 'tasks/:id/progress',
        name: 'task-progress',
        meta: { title: '生成进度', requiresDigitalHuman: true },
        component: () => import('@/views/task/TaskProgressView.vue'),
      },
      {
        path: 'tasks/:id/result',
        name: 'task-result',
        meta: { title: '成片结果', requiresDigitalHuman: true },
        component: () => import('@/views/task/TaskResultView.vue'),
      },
      {
        path: 'works',
        name: 'works',
        meta: { title: '我的作品', requiresDigitalHuman: true },
        component: () => import('@/views/works/WorksListView.vue'),
      },
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

/** 除登录/注册外必须已登录；任务/作品等还需已创建数字人 */
router.beforeEach(async (to, _from, next) => {
  if (PUBLIC_ROUTE_NAMES.has(String(to.name))) {
    next()
    return
  }
  if (!localStorage.getItem('kb_token')) {
    next({ name: 'login', query: { redirect: to.fullPath } })
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
