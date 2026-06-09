import { http } from './http'
import type { UserProfile } from '@/types/domain'

export interface AuthResponse {
  token: string
  user: UserProfile
}

export interface RegisterAuthBody {
  email: string
  password: string
  phoneNumber: string
  idCardNumber: string
}

export async function registerAuth(body: RegisterAuthBody) {
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

export async function changePasswordAuth(body: {
  currentPassword: string
  newPassword: string
}) {
  const { data } = await http.post<{ ok: true }>('v1/auth/change-password', body, {
    timeout: 30_000,
  })
  return data
}

export async function resetPasswordAuth(body: {
  email: string
  phoneNumber: string
  idCardNumber: string
  newPassword: string
}) {
  const { data } = await http.post<{ ok: true }>('v1/auth/reset-password', body, {
    timeout: 30_000,
  })
  return data
}
