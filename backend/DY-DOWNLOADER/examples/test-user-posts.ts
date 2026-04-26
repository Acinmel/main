/**
 * 用户作品列表测试脚本
 *
 * 使用方法:
 *   npx tsx examples/test-user-posts.ts <用户链接> [数量]
 *
 * 示例:
 *   npx tsx examples/test-user-posts.ts "https://v.douyin.com/xxx"       # 获取全部作品
 *   npx tsx examples/test-user-posts.ts "https://v.douyin.com/xxx" 10    # 获取前10个
 */

import { getSecUserId } from '../src/utils/fetcher.js'
import { DouyinHandler } from '../src/handler/index.js'

const cookies = "enter_pc_once=1; UIFID_TEMP=f718f562fcd874811d9c30568517194c189689a7c74491d0ed9c7c2e831358f157cc5b6d0556daca065c731a264246b8a1229af19193ada0aed45f5072a73fb77107b69298a6d17b2ea66005ed9e1677; hevc_supported=true; d_ticket=323c59fee4b68926c02ca4c600481e6b0cfa1; n_mh=DrWuFn46n2jJmrtj6U9dGz56jPuDfdNErJwZWTVQIdo; UIFID=f718f562fcd874811d9c30568517194c189689a7c74491d0ed9c7c2e831358f157cc5b6d0556daca065c731a264246b8cd213ca852a1efbce01143196cf0578989b145ace083eb1bd7cb4b6812e6b1f211dd0ec6d35869000aa576de80c81228f5b50a3ecbb92a1c620734671ce27db6071604ad99366f849ca29aeefdf8435bd71323368004e8fea6451c26a5d045eac4a43c2449dcfa7db2b63392079b456b; my_rd=2; volume_info=%7B%22isUserMute%22%3Afalse%2C%22isMute%22%3Atrue%2C%22volume%22%3A0.5%7D; is_staff_user=false; passport_csrf_token=cdc0805448f3273d99edc5fba9502cea; passport_csrf_token_default=cdc0805448f3273d99edc5fba9502cea; bd_ticket_guard_client_web_domain=2; passport_assist_user=CkHoAuBGf4_exFJ5z7mLuxT6ZeaBBguFzN0ljLFIZK4WSgaXoeRWR1ZZrn7hDxoEUyK2mzQ4b7sPUEnORc1xM0a6_RpKCjwAAAAAAAAAAAAAT8nTGyVAyv7_CgQk4y6HI_A-fWP5W1XYRuY9-PExlgvEqPkDHa16iCpWjh50zNToDA8Qs5WDDhiJr9ZUIAEiAQO2jaK4; uid_tt=ce23355432bbf327f09a4aec54684e4b; uid_tt_ss=ce23355432bbf327f09a4aec54684e4b; sid_tt=8b3119dc94349d43c34703f4ed77704b; sessionid=8b3119dc94349d43c34703f4ed77704b; sessionid_ss=8b3119dc94349d43c34703f4ed77704b; session_tlb_tag_bk=sttt%7C18%7CizEZ3JQ0nUPDRwP07XdwS__________b1vdKsilGtJz4Y3lcovoj2N-6iL9J3cnp0dcS8ZUCIVM%3D; login_time=1764728454313; _bd_ticket_crypt_cookie=b25504990dc9ac40708928498d81a684; __druidClientInfo=JTdCJTIyY2xpZW50V2lkdGglMjIlM0E0MzIlMkMlMjJjbGllbnRIZWlnaHQlMjIlM0E3NzUlMkMlMjJ3aWR0aCUyMiUzQTQzMiUyQyUyMmhlaWdodCUyMiUzQTc3NSUyQyUyMmRldmljZVBpeGVsUmF0aW8lMjIlM0EyJTJDJTIydXNlckFnZW50JTIyJTNBJTIyTW96aWxsYSUyRjUuMCUyMChNYWNpbnRvc2glM0IlMjBJbnRlbCUyME1hYyUyME9TJTIwWCUyMDEwXzE1XzcpJTIwQXBwbGVXZWJLaXQlMkY1MzcuMzYlMjAoS0hUTUwlMkMlMjBsaWtlJTIwR2Vja28pJTIwQ2hyb21lJTJGMTQzLjAuMC4wJTIwU2FmYXJpJTJGNTM3LjM2JTIyJTdE; __security_mc_1_s_sdk_crypt_sdk=73d5b064-4f08-9bc5; __security_mc_1_s_sdk_cert_key=1c2d6984-49d4-8354; __security_mc_1_s_sdk_sign_data_key_web_protect=d3744cb5-46f3-8e5a; is_dash_user=1; sid_guard=8b3119dc94349d43c34703f4ed77704b%7C1768709769%7C5184000%7CThu%2C+19-Mar-2026+04%3A16%3A09+GMT; session_tlb_tag=sttt%7C13%7CizEZ3JQ0nUPDRwP07XdwS__________uORfZ2C8tu_ueMJuheVsi5htrXiAJTclh0b1xFAKhmOQ%3D; sid_ucp_v1=1.0.0-KGZlNjcxNDRhMjM2MmE2MWQxYjk2ZjcwNmVjMmY4ODExMzBjOTczYTMKIQjMzaDFwYyfBhCJvbHLBhjvMSAMMMCXhpoGOAVA-wdIBBoCaGwiIDhiMzExOWRjOTQzNDlkNDNjMzQ3MDNmNGVkNzc3MDRi; ssid_ucp_v1=1.0.0-KGZlNjcxNDRhMjM2MmE2MWQxYjk2ZjcwNmVjMmY4ODExMzBjOTczYTMKIQjMzaDFwYyfBhCJvbHLBhjvMSAMMMCXhpoGOAVA-wdIBBoCaGwiIDhiMzExOWRjOTQzNDlkNDNjMzQ3MDNmNGVkNzc3MDRi; playRecommendGuideTagCount=1; totalRecommendGuideTagCount=1; SelfTabRedDotControl=%5B%7B%22id%22%3A%227596735640780163110%22%2C%22u%22%3A15%2C%22c%22%3A0%7D%2C%7B%22id%22%3A%227591725521630103604%22%2C%22u%22%3A39%2C%22c%22%3A0%7D%5D; FOLLOW_LIVE_POINT_INFO=%22MS4wLjABAAAAbfDjt0OjofvFrM5QXurzGhXD6A1Z0e6S27q7U7K8nvSx79vSGxExCpl1VffSoEaJ%2F1769184000000%2F0%2F1769173714468%2F0%22; IsDouyinActive=true; home_can_add_dy_2_desktop=%220%22; stream_recommend_feed_params=%22%7B%5C%22cookie_enabled%5C%22%3Atrue%2C%5C%22screen_width%5C%22%3A1512%2C%5C%22screen_height%5C%22%3A982%2C%5C%22browser_online%5C%22%3Atrue%2C%5C%22cpu_core_num%5C%22%3A12%2C%5C%22device_memory%5C%22%3A8%2C%5C%22downlink%5C%22%3A10%2C%5C%22effective_type%5C%22%3A%5C%224g%5C%22%2C%5C%22round_trip_time%5C%22%3A0%7D%22; strategyABtestKey=%221769353715.151%22; FOLLOW_NUMBER_YELLOW_POINT_INFO=%22MS4wLjABAAAAbfDjt0OjofvFrM5QXurzGhXD6A1Z0e6S27q7U7K8nvSx79vSGxExCpl1VffSoEaJ%2F1769356800000%2F0%2F1769353715181%2F0%22; bd_ticket_guard_client_data=eyJiZC10aWNrZXQtZ3VhcmQtdmVyc2lvbiI6MiwiYmQtdGlja2V0LWd1YXJkLWl0ZXJhdGlvbi12ZXJzaW9uIjoxLCJiZC10aWNrZXQtZ3VhcmQtcmVlLXB1YmxpYy1rZXkiOiJCT1pENDFlNy9XK2RDOC8vbjZkeklvdE9ldDlJUjlZWGt4cWR1MXlDWnczNnoyM2NxR25nMjZXeGNob296QW1UWFROY0g1bjkvRlhsYzRKTjBHUXJmQTA9IiwiYmQtdGlja2V0LWd1YXJkLXdlYi12ZXJzaW9uIjoyfQ%3D%3D; ttwid=1%7Cpu11GBqAbKf95GpIlekg0eRfVZpUeXpuXVYgzccsFsw%7C1769353715%7C77b9f87cf93e2a1ad84fd071e77388bb4d457312579d2963d0a25bbfafda5069; publish_badge_show_info=%220%2C0%2C0%2C1769353715326%22; bd_ticket_guard_client_data_v2=eyJyZWVfcHVibGljX2tleSI6IkJPWkQ0MWU3L1crZEM4Ly9uNmR6SW90T2V0OUlSOVlYa3hxZHUxeUNadzM2ejIzY3FHbmcyNld4Y2hvb3pBbVRYVE5jSDVuOS9GWGxjNEpOMEdRcmZBMD0iLCJ0c19zaWduIjoidHMuMi4zMzhjZjkwZWFiOGE2ODE3NjFlOTY5YWFmN2M0MWE4YmMxNTZmMjViMjBhYmNiNDQyNDliZGQ2MjU0OTg1OWJjYzRmYmU4N2QyMzE5Y2YwNTMxODYyNGNlZGExNDkxMWNhNDA2ZGVkYmViZWRkYjJlMzBmY2U4ZDRmYTAyNTc1ZCIsInJlcV9jb250ZW50Ijoic2VjX3RzIiwicmVxX3NpZ24iOiI0WFMvay9QRzhOZG1LYXNwazA0enhBZzVQQ3pjK0pseTRtT3UrOGxRUWxVPSIsInNlY190cyI6IiNRNEVLS0dISGlwTGI5QUJuTHlMRlNtbnJqMTZCeklxNCsxcW5Va0g1U2RpWm5UQTMzV1VtUDFza3UrRXUifQ%3D%3D; odin_tt=882ed82aa77987affb54bee80a3ae006fae9115ae5c23d239150a9dad4f980d0cc6a1d9fb3ef91aaec322743a6248e38c353cd46fb1192f747b2af7c839bb4d008900d84c1354e13ea7f235e6258e774"

async function main() {
  const args = process.argv.slice(2)

  if (args.length < 1) {
    console.log('用法: npx tsx examples/test-user-posts.ts <用户链接> [数量]')
    console.log('')
    console.log('示例:')
    console.log('  npx tsx examples/test-user-posts.ts "https://v.douyin.com/xxx"       # 获取全部')
    console.log('  npx tsx examples/test-user-posts.ts "https://v.douyin.com/xxx" 10    # 获取前10个')
    process.exit(1)
  }

  const [userUrl, countStr] = args
  // 默认 0 表示获取全部，传入数字则限制数量
  const maxCount = countStr ? parseInt(countStr, 10) : 0

  console.log('='.repeat(60))
  console.log('抖音用户作品列表测试')
  console.log('='.repeat(60))
  console.log('')

  try {
    console.log('1. 解析用户链接...')
    console.log(`   输入: ${userUrl}`)

    const secUserId = await getSecUserId(userUrl)
    console.log(`   sec_user_id: ${secUserId}`)
    console.log('')

    console.log(`2. 获取用户作品 ${maxCount > 0 ? `(最多 ${maxCount} 个)` : '(全部)'}...`)
    console.log('')

    const handler = new DouyinHandler({ cookie: cookies })
    let totalCount = 0

    for await (const postFilter of handler.fetchUserPostVideos(secUserId, { maxCounts: maxCount })) {
      const awemeIds = postFilter.awemeId || []
      const descs = postFilter.desc || []
      const createTimes = postFilter.createTime || []
      const diggCounts = postFilter.diggCount || []
      const commentCounts = postFilter.commentCount || []
      const shareCounts = postFilter.shareCount || []

      for (let i = 0; i < awemeIds.length; i++) {
        totalCount++
        console.log(`[${totalCount}] ${awemeIds[i]}`)
        console.log(`    描述: ${(descs[i] || '无描述').substring(0, 50)}${(descs[i]?.length || 0) > 50 ? '...' : ''}`)
        console.log(`    时间: ${createTimes[i]}`)
        console.log(`    点赞: ${diggCounts[i]} | 评论: ${commentCounts[i]} | 分享: ${shareCounts[i]}`)
        console.log('')

        if (maxCount > 0 && totalCount >= maxCount) break
      }

      if (maxCount > 0 && totalCount >= maxCount) break
    }

    console.log('-'.repeat(60))
    console.log(`✅ 共获取 ${totalCount} 个作品`)

  } catch (error) {
    console.error('')
    console.error('❌ 错误:', error instanceof Error ? error.message : error)
    process.exit(1)
  }
}

main()
