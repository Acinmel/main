<script setup lang="ts">
import {
  NButton,
  NCard,
  NForm,
  NFormItem,
  NInput,
  NSelect,
  NSpace,
  NText,
  useMessage,
} from 'naive-ui'
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getTask, getTranscript, submitRewrite, suggestRewrite } from '@/api/task'
import { useTaskDraftStore } from '@/stores/taskDraft'
import type { RewriteStyle, Transcript } from '@/types/domain'

const route = useRoute()
const router = useRouter()
const message = useMessage()
const draft = useTaskDraftStore()

const taskId = String(route.params.id)

const loading = ref(true)
const saving = ref(false)
const suggesting = ref(false)

const transcript = ref<Transcript | null>(null)

const style = ref<RewriteStyle>(draft.rewriteStyle)
const text = ref('')

const styleOptions: { label: string; value: RewriteStyle }[] = [
  { label: '保守改写', value: 'conservative' },
  { label: '爆款增强', value: 'viral' },
  { label: '带货转化', value: 'commerce' },
  { label: '知识分享', value: 'knowledge' },
]

onMounted(async () => {
  try {
    const [t, tr] = await Promise.all([getTask(taskId), getTranscript(taskId)])
    transcript.value = tr
    if (t.rewrite?.text) {
      text.value = t.rewrite.text
      style.value = t.rewrite.style
    } else if (draft.rewriteSuggestionDraft.trim()) {
      /** 首页抖音流水线已生成改写建议时，直接进入改写页预填 */
      text.value = draft.rewriteSuggestionDraft.trim()
    } else {
      text.value = tr.fullText
    }
  } catch (e: unknown) {
    message.error(e instanceof Error ? e.message : '加载失败')
  } finally {
    loading.value = false
  }
})

async function onSuggest() {
  suggesting.value = true
  try {
    const res = await suggestRewrite(taskId, style.value)
    text.value = res.text
    message.success('已生成改写建议（后端 mock，可继续手动编辑）')
  } catch (e: unknown) {
    message.error('生成建议失败')
  } finally {
    suggesting.value = false
  }
}

async function onSave() {
  saving.value = true
  try {
    await submitRewrite(taskId, { text: text.value, style: style.value })
    draft.rewriteStyle = style.value
    message.success('改写已保存')
    await router.push({ name: 'task-settings', params: { id: taskId } })
  } catch (e: unknown) {
    message.error('保存失败，请检查文案长度等校验')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="wrap">
    <n-card title="文案改写" class="card">
      <n-space vertical :size="14">
        <n-text depth="2">
          调用
          <n-text code>POST /api/v1/tasks/:id/rewrite/suggest</n-text>
          与
          <n-text code>POST /api/v1/tasks/:id/rewrite</n-text>
        </n-text>

        <n-card v-if="transcript" title="原文案（只读对照）" size="small" embedded>
          <pre class="mono">{{ transcript.fullText }}</pre>
        </n-card>

        <n-form v-if="!loading" label-placement="top">
          <n-form-item label="改写风格">
            <n-select v-model:value="style" :options="styleOptions" />
          </n-form-item>
          <n-form-item label="改写结果（可编辑）">
            <n-input v-model:value="text" type="textarea" :rows="10" placeholder="在此编辑口播文案" />
          </n-form-item>
          <n-space>
            <n-button :loading="suggesting" @click="onSuggest">一键改写</n-button>
            <n-button type="primary" :loading="saving" @click="onSave">保存并进入生成设置</n-button>
          </n-space>
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

.mono {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 13px;
  line-height: 1.7;
}
</style>
