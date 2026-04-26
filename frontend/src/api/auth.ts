import { http } from './http'
import type { UserProfile } from '@/types/domain'

export interface AuthResponse {
  token: string
  user: UserProfile
}

export async function registerAuth(body: { email: string; password: string }) {
  const { data } = await http.post<AuthResponse>('v1/auth/register', body, {
    timeout: 30_000,
  })
  return data
}

export async function loginAuth(body: { email: string; password: string }) {
  const { data } = await http.post<AuthResponse>('v1/auth/login', body, {
    timeout: 30_000,
  })
  return data
}

export async function fetchAuthMe() {
  const { data } = await http.get<{ user: UserProfile }>('v1/auth/me', { timeout: 15_000 })
  return data
}
