<script setup lang="ts">
import {
  NAlert,
  NButton,
  NCard,
  NDescriptions,
  NDescriptionsItem,
  NProgress,
  NSpace,
  NStep,
  NSteps,
  NTag,
  NText,
  useMessage,
} from 'naive-ui'
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getTask, retryTask } from '@/api/task'
import { pollUntil } from '@/composables/poll'
import type { TaskDetail, TaskProgressStep, TaskStatus } from '@/types/domain'

const route = useRoute()
const router = useRouter()
const message = useMessage()

const taskId = String(route.params.id)
const task = ref<TaskDetail | null>(null)
const polling = ref(false)
const retrying = ref(false)

const fallbackLabels: Record<TaskStatus, string> = {
  pending: '等待中',
  parsing: '下载中',
  transcribing: '抽音频 / 转写中',
  rewriting: '生成中',
  voice_generating: '生成配音',
  avatar_generating: '驱动数字人',
  rendering: '渲染成片',
  success: '完成',
  failed: '失败',
}

const fallbackOrder: TaskStatus[] = [
  'pending',
  'parsing',
  'transcribing',
  'rewriting',
  'voice_generating',
  'avatar_generating',
  'rendering',
  'success',
]

const currentIndex = computed(() => {
  const steps = normalizedSteps.value
  const runningIndex = steps.findIndex((item) => item.status === 'running' || item.status === 'failed')
  return runningIndex >= 0 ? runningIndex + 1 : Math.max(1, steps.length)
})

const normalizedSteps = computed<TaskProgressStep[]>(() => {
  if (task.value?.progress?.steps?.length) return task.value.progress.steps
  const status = task.value?.status ?? 'pending'
  const activeIndex = Math.max(0, fallbackOrder.indexOf(status === 'failed' ? 'pending' : status))
  return fallbackOrder.map((key, index) => ({
    key,
    label: fallbackLabels[key],
    status:
      status === 'failed' && index === activeIndex
        ? 'failed'
        : index < activeIndex
          ? 'done'
          : index === activeIndex
            ? 'running'
            : 'waiting',
  }))
})

const progressPercent = computed(() => task.value?.progress?.percentage ?? (polling.value ? 66 : 100))
const progressLabel = computed(() => task.value?.progress?.label ?? fallbackLabels[task.value?.status ?? 'pending'])
const canRetry = computed(() => task.value?.status === 'failed' && !polling.value)

function formatDuration(ms?: number) {
  if (!ms) return '未记录'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

async function startPolling() {
  polling.value = true
  try {
    const end = await pollUntil(
      () => getTask(taskId),
      (next) => {
        task.value = next
        return next.status === 'success' || next.status === 'failed'
      },
      { intervalMs: 900, timeoutMs: 0 },
    )
    task.value = end
    if (end.status === 'failed') {
      message.error(end.failReason ?? '任务失败')
      return
    }
    message.success('生成完成')
    await router.replace({ name: 'task-result', params: { id: taskId } })
  } catch (e: unknown) {
    message.error(e instanceof Error ? e.message : '轮询失败')
  } finally {
    polling.value = false
  }
}

async function onRetry() {
  retrying.value = true
  try {
    task.value = await retryTask(taskId)
    message.success('已重新提交，任务会继续在后台执行')
    await startPolling()
  } catch (e: unknown) {
    message.error(e instanceof Error ? e.message : '重新执行失败')
  } finally {
    retrying.value = false
  }
}

onMounted(startPolling)
</script>

<template>
  <div class="wrap">
    <n-card title="生成进度" class="card">
      <n-space vertical :size="18">
        <div class="status-head">
          <div>
            <n-text depth="3">后台任务</n-text>
            <h2>{{ progressLabel }}</h2>
          </div>
          <n-tag :type="task?.status === 'failed' ? 'error' : task?.status === 'success' ? 'success' : 'info'">
            {{ task?.status ?? 'pending' }}
          </n-tag>
        </div>

        <n-progress
          type="line"
          :percentage="progressPercent"
          :processing="polling && task?.status !== 'failed'"
          indicator-placement="inside"
        />

        <n-alert v-if="task?.status === 'failed'" type="error" :show-icon="false">
          {{ task.failReason || '任务失败，暂未返回具体原因' }}
        </n-alert>
        <n-alert v-else type="info" :show-icon="false">
          任务已由后端持久化，离开页面后仍会继续执行，回来后会自动读取最新状态。
        </n-alert>

        <n-steps :current="currentIndex" size="small">
          <n-step v-for="step in normalizedSteps" :key="step.key" :title="step.label" />
        </n-steps>

        <n-descriptions bordered size="small" :column="1">
          <n-descriptions-item
            v-for="step in normalizedSteps"
            :key="`detail-${step.key}`"
            :label="step.label"
          >
            <div class="step-row">
              <n-tag
                size="small"
                :type="step.status === 'failed' ? 'error' : step.status === 'done' ? 'success' : step.status === 'running' ? 'info' : 'default'"
              >
                {{ step.status }}
              </n-tag>
              <span>{{ formatDuration(step.durationMs) }}</span>
              <n-text v-if="step.error" type="error">{{ step.error }}</n-text>
            </div>
          </n-descriptions-item>
        </n-descriptions>

        <n-space>
          <n-button v-if="canRetry" type="primary" :loading="retrying" @click="onRetry">
            重新执行失败任务
          </n-button>
          <n-button secondary @click="router.push({ name: 'studio' })">返回制作台</n-button>
        </n-space>
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

.status-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.status-head h2 {
  margin: 4px 0 0;
  color: #f8fafc;
  font-size: 26px;
  line-height: 1.2;
}

.step-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
}

@media (max-width: 560px) {
  .wrap {
    margin: 16px auto;
    padding: 0 12px;
  }

  .status-head {
    flex-direction: column;
  }
}
</style>
