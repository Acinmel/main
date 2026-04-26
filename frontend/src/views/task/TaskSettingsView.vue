<script setup lang="ts">
import {
  NButton,
  NCard,
  NForm,
  NFormItem,
  NRadio,
  NRadioGroup,
  NSelect,
  NSpace,
  NText,
  useMessage,
} from 'naive-ui'
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getTask, submitRender } from '@/api/task'
import { useTaskDraftStore } from '@/stores/taskDraft'
import type { AspectRatio, RenderMode, TaskDetail } from '@/types/domain'

const route = useRoute()
const router = useRouter()
const message = useMessage()
const draft = useTaskDraftStore()

const taskId = String(route.params.id)
const loading = ref(true)
const submitting = ref(false)
const task = ref<TaskDetail | null>(null)

const mode = ref<RenderMode>(draft.renderMode)
const aspect = ref<AspectRatio>(draft.aspectRatio)
const voiceStyleId = ref(draft.voiceStyleId)
const subtitleStyleId = ref(draft.subtitleStyleId)

const modeOptions = [
  { label: '照片口播 + 虚拟背景', value: 'virtual_bg' as RenderMode },
  { label: '照片口播 + 原视频背景复用', value: 'reuse_source_bg' as RenderMode },
  { label: '纯字幕快剪版', value: 'subtitle_fast' as RenderMode },
]

const voiceOptions = [
  { label: '中性女声', value: 'neutral_female' },
  { label: '磁性男声', value: 'magnetic_male' },
  { label: '轻快解说', value: 'bright_narration' },
]

const subtitleOptions = [
  { label: '极简白字', value: 'minimal_white' },
  { label: '高对比黄字', value: 'high_contrast_yellow' },
  { label: '新闻字幕条', value: 'news_bar' },
]

onMounted(async () => {
  try {
    const t = await getTask(taskId)
    task.value = t
    if (!t.rewrite) {
      message.warning('请先完成改写后再进入本页')
      await router.replace({ name: 'task-rewrite', params: { id: taskId } })
      return
    }
    if (t.renderConfig) {
      mode.value = t.renderConfig.mode
      aspect.value = t.renderConfig.aspect
      voiceStyleId.value = t.renderConfig.voiceStyleId
      subtitleStyleId.value = t.renderConfig.subtitleStyleId
    }
  } catch {
    message.error('加载任务失败')
  } finally {
    loading.value = false
  }
})

async function onSubmit() {
  submitting.value = true
  try {
    await submitRender(taskId, {
      mode: mode.value,
      aspect: aspect.value,
      voiceStyleId: voiceStyleId.value,
      subtitleStyleId: subtitleStyleId.value,
    })
    draft.renderMode = mode.value
    draft.aspectRatio = aspect.value
    draft.voiceStyleId = voiceStyleId.value
    draft.subtitleStyleId = subtitleStyleId.value
    message.success('已提交渲染任务（后端模拟流水线）')
    await router.push({ name: 'task-progress', params: { id: taskId } })
  } catch (e: unknown) {
    message.error('提交失败')
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="wrap">
    <n-card title="视频生成设置" class="card">
      <n-space vertical :size="14">
        <n-text depth="2">
          调用
          <n-text code>POST /api/v1/tasks/:id/render</n-text>
          ，body 包含 mode / aspect / voiceStyleId / subtitleStyleId
        </n-text>

        <n-form v-if="!loading" label-placement="top">
          <n-form-item label="生成模式">
            <n-select v-model:value="mode" :options="modeOptions" />
          </n-form-item>

          <n-form-item label="视频比例">
            <n-radio-group v-model:value="aspect" name="aspect">
              <n-space>
                <n-radio value="9:16">9:16（竖屏）</n-radio>
                <n-radio value="16:9">16:9（横屏）</n-radio>
              </n-space>
            </n-radio-group>
          </n-form-item>

          <n-form-item label="配音风格">
            <n-select v-model:value="voiceStyleId" :options="voiceOptions" />
          </n-form-item>

          <n-form-item label="字幕样式">
            <n-select v-model:value="subtitleStyleId" :options="subtitleOptions" />
          </n-form-item>

          <n-button type="primary" :loading="submitting" @click="onSubmit">开始生成</n-button>
        </n-form>
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
