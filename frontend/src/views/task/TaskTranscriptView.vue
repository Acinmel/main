<script setup lang="ts">
import {
  NButton,
  NCard,
  NList,
  NListItem,
  NSpace,
  NSpin,
  NText,
  useMessage,
} from 'naive-ui'
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getTask, getTranscript } from '@/api/task'
import { pollUntil } from '@/composables/poll'
import type { Transcript } from '@/types/domain'

const route = useRoute()
const router = useRouter()
const message = useMessage()

const taskId = String(route.params.id)
const loading = ref(true)
const transcript = ref<Transcript | null>(null)

onMounted(async () => {
  try {
    const polled = await pollUntil(
      () => getTask(taskId),
      (t) => t.flags.transcriptAvailable || t.status === 'failed',
      { intervalMs: 600, timeoutMs: 120_000 },
    )
    if (polled.status === 'failed') {
      message.error(polled.failReason ?? '任务失败')
      return
    }
    transcript.value = await getTranscript(taskId)
  } catch (e: unknown) {
    message.error(e instanceof Error ? e.message : '加载失败')
  } finally {
    loading.value = false
  }
})

function goNext() {
  void router.push({ name: 'task-rewrite', params: { id: taskId } })
}
</script>

<template>
  <div class="wrap">
    <n-card title="文案提取结果" class="card">
      <n-space vertical :size="14">
        <n-text depth="2">
          轮询
          <n-text code>GET /api/v1/tasks/:id</n-text>
          直至转写完成，再拉取
          <n-text code>GET /api/v1/tasks/:id/transcript</n-text>
        </n-text>

        <div v-if="loading" class="center">
          <n-spin size="large" />
          <n-text depth="2" style="margin-top: 12px">正在调用千问 ASR 抽取口播文案…</n-text>
        </div>

        <template v-else-if="transcript">
          <n-text strong>整段文案</n-text>
          <n-card embedded :bordered="false" class="mono">
            <pre>{{ transcript.fullText }}</pre>
          </n-card>

          <n-text strong>时间轴片段（示例）</n-text>
          <n-list bordered>
            <n-list-item v-for="(s, idx) in transcript.segments" :key="idx">
              <n-space vertical :size="4">
                <n-text depth="3" style="font-size: 12px">
                  {{ s.startMs }}ms → {{ s.endMs }}ms
                </n-text>
                <n-text>{{ s.text }}</n-text>
              </n-space>
            </n-list-item>
          </n-list>

          <n-button type="primary" @click="goNext">进入文案改写</n-button>
        </template>
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

.center {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 24px 0;
}

.mono pre {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 13px;
  line-height: 1.7;
}

@media (max-width: 480px) {
  .wrap {
    margin: 16px auto;
    padding: 0 max(12px, var(--app-safe-left, 0px)) 0 max(12px, var(--app-safe-right, 0px));
    max-width: 100%;
  }

  .center {
    padding: 16px 0;
  }
}
</style>
