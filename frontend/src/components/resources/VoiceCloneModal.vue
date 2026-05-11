<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import {
  NAlert,
  NButton,
  NForm,
  NFormItem,
  NInput,
  NModal,
  NRadio,
  NRadioGroup,
  NSpace,
  NUpload,
} from 'naive-ui'
import type { UploadFileInfo } from 'naive-ui'
import type { CreateVoiceResourceDraft } from '@/types/resources'

const props = defineProps<{
  show: boolean
  loading?: boolean
}>()

const emit = defineEmits<{
  'update:show': [value: boolean]
  submit: [body: CreateVoiceResourceDraft]
}>()

const visible = computed({
  get: () => props.show,
  set: (value) => emit('update:show', value),
})

const form = reactive({
  name: '',
  audioUrl: '',
})
const sampleMode = reactive<{ value: 'upload' | 'manual' }>({ value: 'upload' })
const sampleFile = ref<File | null>(null)

const submitDisabled = computed(
  () =>
    props.loading ||
    (sampleMode.value === 'upload' ? !sampleFile.value : !form.audioUrl.trim()),
)

function resetForm() {
  form.name = ''
  form.audioUrl = ''
  sampleMode.value = 'upload'
  sampleFile.value = null
}

function submit() {
  if (sampleMode.value === 'upload') {
    if (!sampleFile.value) return
    emit('submit', {
      name: form.name.trim() || '我的克隆音色',
      sampleFile: sampleFile.value,
    })
    return
  }

  emit('submit', {
    name: form.name.trim() || '我的克隆音色',
    audioUrl: form.audioUrl.trim() || undefined,
  })
}

function onUploadChange(fileList: UploadFileInfo[]) {
  const raw = fileList[0]?.file
  sampleFile.value = raw instanceof File ? raw : null
}

watch(
  () => props.loading,
  (loading) => {
    if (!loading && !visible.value) {
      resetForm()
    }
  },
)
</script>

<template>
  <n-modal
    v-model:show="visible"
    preset="card"
    class="resource-modal"
    title="自定义声音克隆"
    @update:show="
      (show) => {
        if (!show && !loading) resetForm()
      }
    "
  >
    <n-form label-placement="top">
      <n-form-item label="音色名称">
        <n-input v-model:value="form.name" placeholder="例如：温柔讲述音" />
      </n-form-item>

      <n-form-item label="样本来源">
        <n-radio-group v-model:value="sampleMode.value" name="voice-sample-mode">
          <n-space size="small">
            <n-radio value="upload">上传本地音频</n-radio>
            <n-radio value="manual">填写音频 URL</n-radio>
          </n-space>
        </n-radio-group>
      </n-form-item>

      <n-form-item v-if="sampleMode.value === 'upload'" label="上传克隆样本">
        <n-upload
          :max="1"
          accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac,.webm"
          :default-upload="false"
          @update:file-list="onUploadChange"
        >
          <n-button secondary>选择 10-15 秒音频</n-button>
        </n-upload>
      </n-form-item>

      <n-form-item v-else label="样本音频 URL">
        <n-input
          v-model:value="form.audioUrl"
          placeholder="填写公网可访问的 10-15 秒样本音频 URL"
        />
      </n-form-item>

      <n-alert type="info" :show-icon="false">
        现在会直接调用阿里云千问声音复刻。样本建议保持 10-15 秒、10MB 以内，成功后会同步进入声音库，并可直接在视频创作第二步使用。
      </n-alert>
    </n-form>
    <template #footer>
      <n-space justify="end">
        <n-button :disabled="loading" @click="visible = false">取消</n-button>
        <n-button type="primary" :loading="loading" :disabled="submitDisabled" @click="submit">
          开始克隆
        </n-button>
      </n-space>
    </template>
  </n-modal>
</template>

<style scoped></style>
