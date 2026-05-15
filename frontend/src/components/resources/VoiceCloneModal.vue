<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { NButton, NInput, NModal, NUpload, NUploadDragger, useMessage } from 'naive-ui'
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

const MAX_AUDIO_BYTES = 10 * 1024 * 1024
const message = useMessage()

const visible = computed({
  get: () => props.show,
  set: (value) => emit('update:show', value),
})

const form = reactive({
  name: '',
})
const sampleFile = ref<File | null>(null)
const sampleFileList = ref<UploadFileInfo[]>([])

const submitDisabled = computed(() => props.loading || !sampleFile.value)

function resetForm() {
  form.name = ''
  sampleFile.value = null
  sampleFileList.value = []
}

function submit() {
  if (!sampleFile.value) {
    message.warning('请先上传一段清晰的音频')
    return
  }

  emit('submit', {
    name: form.name.trim() || '我的克隆声音',
    sampleFile: sampleFile.value,
  })
}

function onUploadChange(fileList: UploadFileInfo[]) {
  const nextList = fileList.slice(-1)
  const raw = nextList[0]?.file

  if (!(raw instanceof File)) {
    sampleFile.value = null
    sampleFileList.value = []
    return
  }

  if (raw.size > MAX_AUDIO_BYTES) {
    sampleFile.value = null
    sampleFileList.value = []
    message.warning('音频文件最大支持 10MB')
    return
  }

  sampleFile.value = raw
  sampleFileList.value = nextList
}

function clearSampleFile() {
  sampleFile.value = null
  sampleFileList.value = []
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
    class="resource-modal voice-clone-modal"
    title="声音复制"
    :mask-closable="!loading"
    @update:show="
      (show) => {
        if (!show && !loading) resetForm()
      }
    "
  >
    <div class="clone-modal-body">
      <section class="clone-field">
        <label class="clone-field__label">上传音频</label>
        <n-upload
          v-model:file-list="sampleFileList"
          :max="1"
          :show-file-list="false"
          accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac,.webm"
          :default-upload="false"
          @update:file-list="onUploadChange"
        >
          <n-upload-dragger
            class="media-upload-card"
            :class="{ 'media-upload-card--ready': sampleFile }"
          >
            <span class="media-upload-icon">↑</span>
            <strong>{{ sampleFile ? '已选择音频文件' : '点击或拖拽上传音频文件' }}</strong>
            <p>
              {{
                sampleFile
                  ? sampleFile.name
                  : '支持 MP3、WAV、M4A 等格式，最大 10MB'
              }}
            </p>
            <div v-if="sampleFile" class="media-upload-actions" @click.stop>
              <button type="button" class="media-upload-remove" @click.prevent.stop="clearSampleFile">
                移除文件
              </button>
            </div>
            <span class="media-upload-tip">音频建议：15秒内 + 情绪饱满 + 内容完整 + 无杂音</span>
          </n-upload-dragger>
        </n-upload>
      </section>

      <section class="clone-field">
        <label class="clone-field__label">语音名称</label>
        <n-input
          v-model:value="form.name"
          class="clone-name-input"
          placeholder="请输入名称"
          clearable
        />
      </section>
    </div>

    <template #footer>
      <div class="clone-actions">
        <n-button size="large" :disabled="loading" @click="visible = false">取消</n-button>
        <n-button
          size="large"
          type="primary"
          :loading="loading"
          :disabled="submitDisabled"
          @click="submit"
        >
          开始复制
        </n-button>
      </div>
    </template>
  </n-modal>
</template>

<style scoped>
.clone-modal-body {
  display: grid;
  gap: 34px;
  padding-top: 12px;
}

.clone-field {
  display: grid;
  gap: 14px;
}

.clone-field__label {
  color: #101828;
  font-size: 18px;
  font-weight: 800;
  letter-spacing: -0.01em;
}

.media-upload-card {
  display: grid;
  min-height: 304px;
  place-items: center;
  padding: 38px 28px;
  border: 2px dashed rgba(148, 163, 184, 0.34) !important;
  border-radius: 28px !important;
  background:
    radial-gradient(circle at 50% 26%, rgba(145, 96, 226, 0.08), transparent 24%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.92), rgba(249, 250, 255, 0.82)) !important;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.96);
  transition:
    border-color var(--transition-fast),
    background var(--transition-fast),
    box-shadow var(--transition-fast),
    transform var(--transition-smooth);
}

.media-upload-card:hover,
.media-upload-card--ready {
  border-color: rgba(140, 92, 226, 0.5) !important;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.98),
    0 22px 42px rgba(115, 78, 194, 0.12);
  transform: translateY(-2px);
}

.media-upload-card :deep(.n-upload-dragger) {
  background: transparent;
}

.media-upload-icon {
  display: grid;
  width: 72px;
  height: 72px;
  place-items: center;
  margin-bottom: 18px;
  border-radius: 50%;
  color: #8d57d8;
  font-size: 34px;
  font-weight: 800;
  background: #ffffff;
  box-shadow:
    0 16px 32px rgba(79, 53, 124, 0.1),
    inset 0 0 0 1px rgba(145, 96, 226, 0.12);
}

.media-upload-card strong {
  color: #111827;
  font-size: 20px;
  font-weight: 900;
  text-align: center;
}

.media-upload-card p {
  max-width: 360px;
  margin: 8px 0 18px;
  color: #98a2b3;
  font-size: 16px;
  font-weight: 700;
  line-height: 1.5;
  text-align: center;
  word-break: break-all;
}

.media-upload-actions {
  display: flex;
  justify-content: center;
  width: 100%;
  margin: 0 0 16px;
}

.media-upload-remove {
  height: 34px;
  padding: 0 16px;
  border: 1px solid rgba(239, 68, 68, 0.24);
  border-radius: 999px;
  color: #dc2626;
  font-size: 13px;
  font-weight: 800;
  background: rgba(254, 242, 242, 0.92);
  cursor: pointer;
  transition:
    border-color var(--transition-fast),
    background var(--transition-fast),
    transform var(--transition-fast);
}

.media-upload-remove:hover {
  border-color: rgba(239, 68, 68, 0.42);
  background: #fff1f2;
  transform: translateY(-1px);
}

.media-upload-tip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  max-width: 100%;
  padding: 10px 18px;
  border-radius: 14px;
  color: #7337ff;
  font-size: 14px;
  font-weight: 800;
  line-height: 1.35;
  text-align: center;
  background: linear-gradient(135deg, rgba(130, 85, 255, 0.1), rgba(172, 129, 255, 0.14));
}

.clone-name-input :deep(.n-input-wrapper) {
  min-height: 58px;
  padding: 0 20px;
  border-radius: 20px;
}

.clone-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  width: 100%;
}

.clone-actions :deep(.n-button) {
  min-height: 58px;
  border-radius: 20px !important;
  font-size: 17px;
}

.clone-actions :deep(.n-button--primary-type) {
  background: linear-gradient(135deg, #b491f4, #bd8bf3) !important;
  box-shadow: 0 18px 36px rgba(150, 96, 226, 0.22);
}

:global(.voice-clone-modal) {
  width: min(560px, calc(100vw - 32px)) !important;
}

:global(.voice-clone-modal .n-card-header) {
  padding: 36px 40px 28px !important;
  border-bottom: 1px solid rgba(226, 232, 240, 0.72);
}

:global(.voice-clone-modal .n-card-header__main) {
  color: #101828;
  font-size: 28px;
  font-weight: 900;
  letter-spacing: -0.03em;
}

:global(.voice-clone-modal .n-card-content) {
  padding: 38px 40px 32px !important;
}

:global(.voice-clone-modal .n-card__footer) {
  padding: 8px 40px 38px !important;
}

@media (max-width: 560px) {
  .media-upload-card {
    min-height: 260px;
    padding: 28px 18px;
  }

  .clone-actions {
    grid-template-columns: 1fr;
  }

  :global(.voice-clone-modal .n-card-header),
  :global(.voice-clone-modal .n-card-content),
  :global(.voice-clone-modal .n-card__footer) {
    padding-left: 24px !important;
    padding-right: 24px !important;
  }
}
</style>
