<script setup lang="ts">
import { NButton, NCard, NProgress, NSpace, NSteps, NStep, NText, useMessage } from 'naive-ui'
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getTask } from '@/api/task'
import { pollUntil } from '@/composables/poll'
import type { TaskDetail, TaskStatus } from '@/types/domain'

const route = useRoute()
const router = useRouter()
const message = useMessage()

const taskId = String(route.params.id)
const task = ref<TaskDetail | null>(null)
const polling = ref(true)

/** 与 <n-steps> 顺序对齐的粗粒度阶段映射 */
const stepIndexByStatus: Record<TaskStatus, number> = {
  pending: 0,
  parsing: 1,
  transcribing: 2,
  rewriting: 3,
  voice_generating: 4,
  avatar_generating: 5,
  rendering: 6,
  success: 7,
  failed: 0,
}

const currentIndex = computed(() => {
  const s = task.value?.status
  if (!s) return 0
  return stepIndexByStatus[s] ?? 0
})

onMounted(async () => {
  try {
    const end = await pollUntil(
      () => getTask(taskId),
      (t) => {
        task.value = t
        return t.status === 'success' || t.status === 'failed'
      },
      { intervalMs: 700, timeoutMs: 180_000 },
    )
    task.value = end
    if (end.status === 'failed') {
      message.error(end.failReason ?? '生成失败')
      return
    }
    message.success('生成完成（演示成片为外链示例视频）')
    await router.replace({ name: 'task-result', params: { id: taskId } })
  } catch (e: unknown) {
    message.error(e instanceof Error ? e.message : '轮询失败')
  } finally {
    polling.value = false
  }
})
</script>

<template>
  <div class="wrap">
    <n-card title="生成进度" class="card">
      <n-space vertical :size="16">
        <n-text depth="2">
          轮询
          <n-text code>GET /api/v1/tasks/:id</n-text>
          ，观察状态从配音 → 口型 → 渲染直至 success
        </n-text>

        <n-progress type="line" :percentage="polling ? 66 : 100" :show-indicator="false" processing />

        <n-steps :current="currentIndex" size="small">
          <n-step title="排队/准备" />
          <n-step title="解析下载" />
          <n-step title="语音转写" />
          <n-step title="文案改写" />
          <n-step title="配音合成" />
          <n-step title="口型驱动" />
          <n-step title="视频渲染" />
          <n-step title="完成" />
        </n-steps>

        <n-text v-if="task" depth="2">当前状态：{{ task.status }}</n-text>

        <n-button v-if="!polling && task?.status === 'failed'" type="primary" @click="router.push({ name: 'studio' })">
          返回口播制作
        </n-button>
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
</style>
