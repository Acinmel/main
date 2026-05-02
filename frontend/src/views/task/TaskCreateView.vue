<script setup lang="ts">
import { NButton, NCard, NDescriptions, NDescriptionsItem, NSpace, NText, useMessage } from 'naive-ui'
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { createTask, startExtract, uploadTaskPhoto } from '@/api/task'
import { useTaskDraftStore } from '@/stores/taskDraft'
import { validateSourceVideoInput } from '@/utils/douyinShareUrl'

const draft = useTaskDraftStore()
const router = useRouter()
const message = useMessage()
const loading = ref(false)

function goHome() {
  void router.push({ name: 'studio' })
}

async function submit() {
  const link = validateSourceVideoInput(draft.videoUrl)
  if (!link.ok || !link.normalizedUrl) {
    message.error(link.message ?? '缺少或无法识别视频链接，请返回口播制作页重新粘贴')
    return
  }
  draft.videoUrl = link.normalizedUrl
  if (!draft.photoFile) {
    message.error('缺少照片，请返回口播制作页上传')
    return
  }

  loading.value = true
  try {
    const initial = draft.transcriptDraft.trim()
    const task = await createTask({
      sourceVideoUrl: link.normalizedUrl,
      ...(initial ? { initialTranscript: initial } : {}),
    })
    await uploadTaskPhoto(task.id, draft.photoFile)
    await startExtract(task.id)
    message.success('任务已创建，已开始抽取口播（模拟流水线）')
    await router.push({ name: 'task-transcript', params: { id: task.id } })
  } catch (e: unknown) {
    const err = e as { response?: { data?: { message?: string } }; message?: string }
    const msg = err.response?.data?.message ?? err.message ?? '创建任务失败'
    message.error(String(msg))
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="wrap">
    <n-card title="创建任务 · 提交到后端" size="large" class="card">
      <n-space vertical :size="16">
        <n-text depth="2">
          将依次调用：
          <n-text code>POST /api/v1/tasks</n-text>
          →
          <n-text code>POST /api/v1/tasks/:id/photo</n-text>
          →
          <n-text code>POST /api/v1/tasks/:id/extract</n-text>
        </n-text>
        <n-descriptions label-placement="top" bordered size="small" :column="1">
          <n-descriptions-item label="视频链接">
            {{ draft.videoUrl || '（空）' }}
          </n-descriptions-item>
          <n-descriptions-item v-if="draft.videoMeta" label="视频信息（口播制作页抓取）">
            {{
              draft.videoMeta.title
                ? `${draft.videoMeta.title.slice(0, 40)}${draft.videoMeta.title.length > 40 ? '…' : ''}`
                : '已抓取，无标题'
            }}
          </n-descriptions-item>
          <n-descriptions-item label="口播照片来源">
            {{
              draft.portraitMode === 'digital_human'
                ? '专属数字人形象（默认）'
                : '自行上传'
            }}
          </n-descriptions-item>
          <n-descriptions-item label="照片文件">
            {{ draft.photoFile ? draft.photoFile.name : '（未选择）' }}
          </n-descriptions-item>
          <n-descriptions-item label="口播文案草稿">
            {{
              draft.transcriptDraft.trim()
                ? `已填写 ${draft.transcriptDraft.trim().length} 字（将作为 initialTranscript 提交）`
                : '（空，后端将调用千问 ASR 转写）'
            }}
          </n-descriptions-item>
        </n-descriptions>
        <n-space>
          <n-button :disabled="loading" @click="goHome">返回修改</n-button>
          <n-button type="primary" :loading="loading" @click="submit">确认并抽取口播</n-button>
        </n-space>
      </n-space>
    </n-card>
  </div>
</template>

<style scoped>
.wrap {
  max-width: 880px;
  margin: 32px auto;
  padding: 0 16px;
}

.card {
  background: rgba(15, 23, 42, 0.96);
  border: 1px solid rgba(148, 163, 184, 0.35);
}
</style>
