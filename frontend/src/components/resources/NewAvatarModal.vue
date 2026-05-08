<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import {
  NAlert,
  NButton,
  NForm,
  NFormItem,
  NIcon,
  NInput,
  NModal,
  NProgress,
  NRadio,
  NRadioGroup,
  NSpace,
  NText,
  NUpload,
  NUploadDragger,
  useMessage,
} from 'naive-ui'
import type { UploadFileInfo } from 'naive-ui'
import { CloudUploadOutline } from '@vicons/ionicons5'
import { fetchDigitalHumanImageBlob, generateDigitalHumanImage, getDigitalHumanStyles } from '@/api/task'
import type { CreateAvatarResourceBody } from '@/types/resources'

const props = defineProps<{
  show: boolean
  loading?: boolean
}>()

const emit = defineEmits<{
  'update:show': [value: boolean]
  submit: [body: CreateAvatarResourceBody]
}>()

const visible = computed({
  get: () => props.show,
  set: (value) => emit('update:show', value),
})

const message = useMessage()

const fallbackStyles: { id: string; label: string }[] = [
  { id: 'suit', label: '西装版' },
  { id: 'ancient', label: '古风版' },
  { id: 'casual', label: '休闲版' },
  { id: 'taoist', label: '道士版' },
  { id: 'fashion', label: '时尚版' },
  { id: 'lawyer', label: '律师版' },
  { id: 'programmer', label: '程序员版' },
  { id: 'finance', label: '财务版' },
  { id: 'chef', label: '厨师版' },
]

const form = reactive({
  name: '',
  originalVideoUrl: '',
  styleId: 'suit',
})

const styles = ref([...fallbackStyles])
const selfieFile = ref<File | null>(null)
const selfiePreview = ref<string | null>(null)
const generating = ref(false)
const progress = ref(0)
const progressProcessing = ref(false)
const hint = ref('')
let progressTimer: ReturnType<typeof window.setInterval> | null = null

const busy = computed(() => props.loading || generating.value)

function clearProgressTimer() {
  if (progressTimer) {
    window.clearInterval(progressTimer)
    progressTimer = null
  }
}

function startProgress() {
  clearProgressTimer()
  progress.value = 6
  progressProcessing.value = true
  progressTimer = window.setInterval(() => {
    if (progress.value >= 88) return
    const delta = progress.value < 38 ? 2.8 : progress.value < 62 ? 1.4 : 0.5
    progress.value = Math.min(88, Math.round((progress.value + delta) * 10) / 10)
  }, 380)
}

function revokeSelfiePreview() {
  if (selfiePreview.value) {
    URL.revokeObjectURL(selfiePreview.value)
    selfiePreview.value = null
  }
}

function onUploadChange(options: { fileList: UploadFileInfo[] }) {
  const raw = options.fileList[0]?.file
  const file = raw instanceof File ? raw : null
  revokeSelfiePreview()
  selfieFile.value = file
  hint.value = ''
  if (file) selfiePreview.value = URL.createObjectURL(file)
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

async function loadStyles() {
  try {
    const list = await getDigitalHumanStyles()
    if (list.length) styles.value = list
  } catch {
    styles.value = [...fallbackStyles]
  }
}

async function submit() {
  const file = selfieFile.value
  if (!file?.size) {
    message.warning('请先上传一张自拍照')
    return
  }

  generating.value = true
  hint.value = ''
  startProgress()
  try {
    const result = await generateDigitalHumanImage({ file, styleId: form.styleId })
    clearProgressTimer()
    progress.value = 100
    progressProcessing.value = false

    let coverUrl = result.imageUrl || ''
    if (!coverUrl) {
      const blob = await fetchDigitalHumanImageBlob()
      coverUrl = await blobToDataUrl(blob)
    }

    hint.value = result.hint ?? ''
    message.success(`已生成数字人形象（${result.styleLabel}）`)
    await new Promise((resolve) => window.setTimeout(resolve, 260))

  emit('submit', {
    name: form.name.trim() || '我的数字人',
      coverUrl,
    originalVideoUrl: form.originalVideoUrl.trim() || undefined,
      styleId: result.styleId,
  })
  } catch {
    clearProgressTimer()
    progress.value = 0
    progressProcessing.value = false
    message.error('数字人生成失败，请稍后重试')
  } finally {
    clearProgressTimer()
    generating.value = false
    progress.value = 0
    progressProcessing.value = false
  }
}

onMounted(() => {
  void loadStyles()
})

onBeforeUnmount(() => {
  clearProgressTimer()
  revokeSelfiePreview()
})
</script>

<template>
  <n-modal v-model:show="visible" preset="card" class="resource-modal" title="添加数字人">
    <n-form label-placement="top">
      <n-form-item label="名称">
        <n-input v-model:value="form.name" placeholder="例如：商务讲解数字人" />
      </n-form-item>
      <n-form-item label="上传自拍照">
        <n-upload
          directory-dnd
          :max="1"
          accept=".jpg,.jpeg,.png,image/jpeg,image/png"
          :default-upload="false"
          :disabled="busy"
          list-type="image"
          @change="onUploadChange"
        >
          <n-upload-dragger>
            <div class="upload-icon">
              <n-icon size="38" :depth="3">
                <CloudUploadOutline />
              </n-icon>
            </div>
            <n-text>拖拽或点击上传（单张最大 8MB）</n-text>
          </n-upload-dragger>
        </n-upload>
      </n-form-item>

      <div v-if="selfiePreview" class="selfie-preview">
        <img :src="selfiePreview" alt="自拍照预览" />
      </div>

      <n-form-item label="数字人风格">
        <n-radio-group v-model:value="form.styleId" name="avatar-style">
          <n-space size="small" class="style-options">
            <n-radio v-for="style in styles" :key="style.id" :value="style.id" :disabled="busy">
              {{ style.label }}
            </n-radio>
          </n-space>
        </n-radio-group>
      </n-form-item>

      <n-form-item label="原始视频 URL">
        <n-input v-model:value="form.originalVideoUrl" placeholder="可选，用于弹窗预览" />
      </n-form-item>

      <div v-if="generating" class="progress">
        <n-text depth="3">正在上传并调用大模型生成形象，请稍候...</n-text>
        <n-progress
          type="line"
          :percentage="progress"
          :processing="progressProcessing"
          indicator-placement="inside"
        />
      </div>

      <n-alert v-if="hint" type="info" :show-icon="false">{{ hint }}</n-alert>
    </n-form>
    <template #footer>
      <n-space justify="end">
        <n-button :disabled="busy" @click="visible = false">取消</n-button>
        <n-button type="primary" :loading="busy" @click="submit">生成并添加</n-button>
      </n-space>
    </template>
  </n-modal>
</template>

<style scoped>
.resource-modal {
  width: min(760px, calc(100vw - 32px));
}

.upload-icon {
  margin-bottom: 8px;
}

.selfie-preview {
  width: min(220px, 100%);
  margin: -8px 0 18px;
  overflow: hidden;
  border: 1px solid var(--border-soft);
  border-radius: 16px;
  background: var(--bg-soft);
}

.selfie-preview img {
  display: block;
  width: 100%;
  max-height: 260px;
  object-fit: cover;
}

.style-options {
  flex-wrap: wrap;
}

.progress {
  display: grid;
  gap: 8px;
  margin-bottom: 16px;
}
</style>
