export const FIXED_ADMIN_EMAIL = '447519854@qq.com'

export function isFixedAdminEmail(email?: string | null) {
  return email?.trim().toLowerCase() === FIXED_ADMIN_EMAIL
}
