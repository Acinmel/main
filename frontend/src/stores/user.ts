import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { UserProfile } from '@/types/domain'
import { fetchAuthMe } from '@/api/auth'

/**
 * 用户会话：Bearer token + 资料（注册/登录后由后端 JWT 签发）
 */
export const useUserStore = defineStore('user', () => {
  const token = ref<string | null>(localStorage.getItem('kb_token'))
  const profile = ref<UserProfile | null>(null)

  const isLoggedIn = computed(() => Boolean(token.value))

  function setSession(nextToken: string, nextProfile?: UserProfile) {
    token.value = nextToken
    localStorage.setItem('kb_token', nextToken)
    if (nextProfile) profile.value = nextProfile
  }

  function clearSession() {
    token.value = null
    profile.value = null
    localStorage.removeItem('kb_token')
  }

  /** 应用启动或刷新后根据 token 拉取 /auth/me */
  async function hydrateProfile() {
    if (!token.value) return
    try {
      const { user } = await fetchAuthMe()
      profile.value = user
    } catch {
      clearSession()
    }
  }

  return { token, profile, isLoggedIn, setSession, clearSession, hydrateProfile }
})
