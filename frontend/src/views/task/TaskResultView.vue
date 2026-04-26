<script setup lang="ts">
import { NButton, NCard, NSpace, NText, useMessage } from 'naive-ui'
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { downloadTaskAsset, getTaskResult } from '@/api/task'
import type { TaskResultPayload } from '@/types/domain'

const route = useRoute()
const router = useRouter()
const message = useMessage()

const taskId = String(route.params.id)
const result = ref<TaskResultPayload | null>(null)

onMounted(async () => {
  try {
    result.value = await getTaskResult(taskId)
  } catch {
    message.error('暂无法获取成片（请确认任务已成功完成）')
  }
})

async function dl(kind: 'subtitle' | 'script') {
  try {
    await downloadTaskAsset(
      taskId,
      kind,
      kind === 'subtitle' ? `task-${taskId}.srt` : `task-${taskId}-script.txt`,
    )
  } catch {
    message.error('下载失败')
  }
}
</script>

<template>
  <div class="wrap">
    <n-card title="成片结果" class="card">
      <n-space vertical :size="14">
        <n-text depth="2">
          调用
          <n-text code>GET /api/v1/tasks/:id/result</n-text>
          ；字幕/文案通过带鉴权的下载接口拉取 blob
        </n-text>

        <video
          v-if="result?.mp4Url"
          class="player"
          :src="result.mp4Url"
          controls
          playsinline
        />

        <n-space>
          <n-button v-if="result?.mp4Url" tag="a" :href="result.mp4Url" target="_blank" rel="noreferrer">
            新窗口打开视频链接
          </n-button>
          <n-button v-else disabled>新窗口打开视频链接</n-button>
          <n-button secondary @click="dl('subtitle')">下载字幕</n-button>
          <n-button secondary @click="dl('script')">下载文案</n-button>
          <n-button type="primary" @click="router.push({ name: 'studio' })">再次制作（口播流程）</n-button>
        </n-space>

        <n-text depth="3" style="font-size: 12px">
          说明：当前 mp4 为 Blender 官方示例片外链，仅用于验证播放器与下载链路；真实环境替换为对象存储上的成片 URL。
        </n-text>
      </n-space>
    </n-card>
  </div>
</template>

<style scoped>
.wrap {
  max-width: 960px;
  margin: 32px auto;
  padding: 0 16px;
}

.card {
  background: rgba(15, 23, 42, 0.96);
  border: 1px solid rgba(148, 163, 184, 0.35);
}

.player {
  width: 100%;
  max-height: 420px;
  border-radius: 12px;
  border: 1px solid rgba(148, 163, 184, 0.35);
  background: #000;
}
</style>
