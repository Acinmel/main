import 'vue-router'

declare module 'vue-router' {
  interface RouteMeta {
    /** 浏览器标题与面包屑用 */
    title?: string
    /** 需已创建数字人形象（无则回专属数字人页） */
    requiresDigitalHuman?: boolean
    /** 需已审核开通（pending 不可进） */
    requiresActiveAccount?: boolean
    /** 仅管理员 */
    requiresAdmin?: boolean
  }
}
