<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import {
  NAlert,
  NButton,
  NForm,
  NFormItem,
  NInput,
  NModal,
  NRadio,
  NRadioGroup,
  NSelect,
  NSpace,
  NText,
  NUpload,
  NUploadDragger,
  useMessage,
} from 'naive-ui'
import { fetchSavedVideoBlob, listSavedVideos } from '@/api/task'
import SavedVideoPreview from '@/components/resources/SavedVideoPreview.vue'
import { describeHttpOrNetworkError } from '@/utils/httpErrorMessage'
import type { UploadFileInfo } from 'naive-ui'
import type { CreateAvatarResourceDraft } from '@/types/resources'

const props = defineProps<{
  show: boolean
  loading?: boolean
}>()

const emit = defineEmits<{
  'update:show': [value: boolean]
  submit: [body: CreateAvatarResourceDraft]
}>()

const visible = computed({
  get: () => props.show,
  set: (value) => emit('update:show', value),
})

const message = useMessage()
const AVATAR_VIDEO_MAX_SECONDS = 10 * 60
const AVATAR_VIDEO_MAX_BYTES = 500 * 1024 * 1024

const sourceMode = ref<'saved' | 'upload' | 'manual'>('saved')
const loadingSavedVideos = ref(false)
const savedVideoDirectory = ref('')
const savedVideoOptions = ref<Array<{ label: string; value: string }>>([])
const uploadedVideoFile = ref<File | null>(null)
const uploadFileList = ref<UploadFileInfo[]>([])
const uploadedVideoDurationSeconds = ref<number | null>(null)
const uploadedVideoError = ref('')
const savedVideoPreviewUrl = ref('')
const savedVideoPreviewLoading = ref(false)
const savedVideoPreviewError = ref('')
const savedVideoViewerOpen = ref(false)
let savedVideoPreviewRequest = 0

const form = reactive({
  name: '',
  savedVideoName: '',
  originalVideoUrl: '',
  coverUrl: '',
})

const hasSavedVideos = computed(() => savedVideoOptions.value.length > 0)

const submitDisabled = computed(() => {
  if (props.loading) return true
  if (sourceMode.value === 'saved') return !form.savedVideoName.trim()
  if (sourceMode.value === 'upload') return !uploadedVideoFile.value || Boolean(uploadedVideoError.value)
  return !form.originalVideoUrl.trim()
})

const uploadedVideoDurationText = computed(() => {
  if (uploadedVideoDurationSeconds.value === null) return '待识别'
  return formatDuration(uploadedVideoDurationSeconds.value)
})

function revokeSavedVideoPreviewUrl() {
  if (savedVideoPreviewUrl.value.startsWith('blob:')) {
    URL.revokeObjectURL(savedVideoPreviewUrl.value)
  }
  savedVideoPreviewUrl.value = ''
}

function clearSavedVideoPreview() {
  savedVideoPreviewRequest += 1
  revokeSavedVideoPreviewUrl()
  savedVideoPreviewLoading.value = false
  savedVideoPreviewError.value = ''
  savedVideoViewerOpen.value = false
}

async function refreshSavedVideoPreview() {
  const fileName = form.savedVideoName.trim()
  savedVideoPreviewRequest += 1
  const requestId = savedVideoPreviewRequest

  revokeSavedVideoPreviewUrl()
  savedVideoPreviewError.value = ''
  savedVideoViewerOpen.value = false

  if (!visible.value || sourceMode.value !== 'saved' || !fileName) {
    savedVideoPreviewLoading.value = false
    return
  }

  savedVideoPreviewLoading.value = true
  try {
    const blob = await fetchSavedVideoBlob(fileName)
    const nextUrl = URL.createObjectURL(blob)
    if (requestId !== savedVideoPreviewRequest) {
      URL.revokeObjectURL(nextUrl)
      return
    }
    savedVideoPreviewUrl.value = nextUrl
  } catch (error) {
    if (requestId === savedVideoPreviewRequest) {
      savedVideoPreviewError.value = describeHttpOrNetworkError(error)
    }
  } finally {
    if (requestId === savedVideoPreviewRequest) {
      savedVideoPreviewLoading.value = false
    }
  }
}

function openSavedVideoViewer() {
  if (!savedVideoPreviewUrl.value) {
    message.warning(savedVideoPreviewLoading.value ? '视频预览还在加载中' : '请先选择一个可预览的视频')
    return
  }
  savedVideoViewerOpen.value = true
}

function resetForm() {
  form.name = ''
  form.savedVideoName = ''
  form.originalVideoUrl = ''
  form.coverUrl = ''
  uploadedVideoFile.value = null
  uploadFileList.value = []
  uploadedVideoDurationSeconds.value = null
  uploadedVideoError.value = ''
  clearSavedVideoPreview()
  sourceMode.value = hasSavedVideos.value ? 'saved' : 'manual'
}

async function loadSavedVideos() {
  loadingSavedVideos.value = true
  try {
    const data = await listSavedVideos()
    savedVideoDirectory.value = data.directory
    savedVideoOptions.value = data.files.map((item) => ({
      label: `${item.name} · ${new Date(item.mtime).toLocaleString('zh-CN')}`,
      value: item.name,
    }))
    if (!form.savedVideoName && savedVideoOptions.value.length) {
      form.savedVideoName = savedVideoOptions.value[0].value
    }
    if (!savedVideoOptions.value.length) {
      form.savedVideoName = ''
      if (sourceMode.value === 'saved') {
        sourceMode.value = 'manual'
      }
    }
  } catch {
    savedVideoOptions.value = []
    if (sourceMode.value === 'saved') {
      sourceMode.value = 'manual'
    }
  } finally {
    loadingSavedVideos.value = false
  }
}

function submit() {
  if (sourceMode.value === 'upload') {
    if (!uploadedVideoFile.value) {
      message.warning('请先上传一个数字人视频文件')
      return
    }
    if (uploadedVideoError.value) {
      message.warning(uploadedVideoError.value)
      return
    }
    emit('submit', {
      name: form.name.trim() || '我的数字人',
      coverUrl: form.coverUrl.trim() || undefined,
      styleId: 'uploaded-video',
      uploadFile: uploadedVideoFile.value,
    })
    return
  }

  const originalVideoUrl =
    sourceMode.value === 'saved'
      ? form.savedVideoName.trim()
      : form.originalVideoUrl.trim()

  if (!originalVideoUrl) {
    message.warning('请先选择一个视频来源')
    return
  }

  emit('submit', {
    name: form.name.trim() || '我的数字人',
    coverUrl: form.coverUrl.trim() || undefined,
    originalVideoUrl,
    styleId: sourceMode.value === 'saved' ? 'saved-video' : 'custom-video',
  })
}

watch(visible, (value) => {
  if (value) {
    void loadSavedVideos()
  } else if (!props.loading) {
    resetForm()
  }
})

watch([visible, sourceMode, () => form.savedVideoName], () => {
  if (visible.value && sourceMode.value === 'saved' && form.savedVideoName.trim()) {
    void refreshSavedVideoPreview()
    return
  }
  clearSavedVideoPreview()
})

watch(
  () => props.loading,
  (loading) => {
    if (!loading && !visible.value) {
      resetForm()
    }
  },
)

function formatDuration(seconds: number) {
  const total = Math.max(0, Math.round(seconds))
  const minutes = Math.floor(total / 60)
  const restSeconds = total % 60
  return `${String(minutes).padStart(2, '0')}:${String(restSeconds).padStart(2, '0')}`
}

function readVideoDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video')
    const url = URL.createObjectURL(file)
    const cleanup = () => {
      URL.revokeObjectURL(url)
      video.removeAttribute('src')
      video.load()
    }
    video.preload = 'metadata'
    video.onloadedmetadata = () => {
      const duration = video.duration
      cleanup()
      resolve(duration)
    }
    video.onerror = () => {
      cleanup()
      reject(new Error('无法识别视频时长'))
    }
    video.src = url
  })
}

async function onUploadChange(fileList: UploadFileInfo[]) {
  uploadFileList.value = fileList.slice(0, 1)
  uploadedVideoDurationSeconds.value = null
  uploadedVideoError.value = ''

  const raw = uploadFileList.value[0]?.file
  uploadedVideoFile.value = raw instanceof File ? raw : null
  if (!uploadedVideoFile.value) return
  if (uploadedVideoFile.value.size > AVATAR_VIDEO_MAX_BYTES) {
    uploadedVideoError.value = '请上传小于 500MB 的视频文件'
    uploadedVideoFile.value = null
    uploadFileList.value = []
    message.warning(uploadedVideoError.value)
    return
  }

  try {
    const duration = await readVideoDuration(uploadedVideoFile.value)
    uploadedVideoDurationSeconds.value = duration
    if (!Number.isFinite(duration) || duration <= 0) {
      uploadedVideoError.value = '无法识别视频时长，请重新选择可正常播放的视频'
    } else if (duration > AVATAR_VIDEO_MAX_SECONDS) {
      uploadedVideoError.value = '数字人视频最长支持 10 分钟，请重新选择更短的视频'
    }
    if (uploadedVideoError.value) {
      uploadedVideoFile.value = null
      uploadFileList.value = []
      message.warning(uploadedVideoError.value)
    }
  } catch {
    uploadedVideoFile.value = null
    uploadFileList.value = []
    uploadedVideoError.value = '无法识别视频时长，请重新选择可正常播放的视频'
    message.warning(uploadedVideoError.value)
  }
}

function clearUploadedVideoFile() {
  uploadedVideoFile.value = null
  uploadFileList.value = []
  uploadedVideoDurationSeconds.value = null
  uploadedVideoError.value = ''
}

onBeforeUnmount(() => {
  clearSavedVideoPreview()
})
</script>

<template>
  <n-modal
    v-model:show="visible"
    preset="card"
    class="resource-modal new-avatar-modal"
    title="添加数字人"
  >
    <n-form label-placement="top">
      <n-form-item label="标题">
        <n-input v-model:value="form.name" placeholder="例如：带货讲解数字人" />
      </n-form-item>

      <n-form-item label="视频来源">
        <n-radio-group v-model:value="sourceMode" name="avatar-video-source">
          <n-space size="small" class="source-options">
            <n-radio value="saved">从已保存视频中选择</n-radio>
            <n-radio value="upload">直接上传视频</n-radio>
            <n-radio value="manual">手动填写 URL / 文件名</n-radio>
          </n-space>
        </n-radio-group>
      </n-form-item>

      <template v-if="sourceMode === 'saved'">
        <n-form-item label="已保存视频">
          <n-select
            v-model:value="form.savedVideoName"
            :options="savedVideoOptions"
            :loading="loadingSavedVideos"
            :placeholder="
              hasSavedVideos ? '选择已通过抖音抓取并保存的视频' : '当前目录还没有已保存视频'
            "
          />
        </n-form-item>

        <n-alert type="info" :show-icon="false" style="margin-bottom: 16px">
          <n-text depth="3">
            当前会直接引用后端保存目录中的视频文件：{{ savedVideoDirectory || '正在读取…' }}
          </n-text>
        </n-alert>

        <SavedVideoPreview
          :file-name="form.savedVideoName"
          :video-url="savedVideoPreviewUrl"
          :loading="savedVideoPreviewLoading"
          :error="savedVideoPreviewError"
          :directory="savedVideoDirectory"
          @open="openSavedVideoViewer"
        />

        <div v-if="!loadingSavedVideos && !hasSavedVideos" class="saved-video-empty-actions">
          <n-button secondary type="primary" @click="sourceMode = 'upload'">直接上传视频</n-button>
          <n-button quaternary type="primary" @click="sourceMode = 'manual'">手动填写地址</n-button>
        </div>

        <n-alert
          v-if="!loadingSavedVideos && !hasSavedVideos"
          type="warning"
          :show-icon="false"
          style="margin-bottom: 16px"
        >
          这个目录里还没有可选视频。你可以先在创作页抓取抖音视频，或直接切到手动模式填写视频地址。
        </n-alert>
      </template>

      <n-form-item v-else-if="sourceMode === 'upload'" label="上传数字人视频">
        <n-upload
          v-model:file-list="uploadFileList"
          class="media-upload-shell"
          :max="1"
          :show-file-list="false"
          accept="video/*,.mp4,.mov,.webm,.mkv,.m4v"
          :default-upload="false"
          @update:file-list="onUploadChange"
        >
          <n-upload-dragger
            class="media-upload-card avatar-upload-card"
            :class="{ 'media-upload-card--ready': uploadedVideoFile }"
          >
            <span class="media-upload-icon">↑</span>
            <strong>{{ uploadedVideoFile ? '已选择视频文件' : '点击或拖拽上传视频文件' }}</strong>
            <p>
              {{
                uploadedVideoFile
                  ? uploadedVideoFile.name
                  : '支持 MP4、MOV、WEBM 等格式，最长 10 分钟'
              }}
            </p>
            <div v-if="uploadedVideoFile" class="media-upload-actions" @click.stop>
              <button
                type="button"
                class="media-upload-remove"
                @click.prevent.stop="clearUploadedVideoFile"
              >
                移除文件
              </button>
            </div>
            <span class="media-upload-rule">请上传小于 500MB，市场推荐 1-2 分钟</span>
            <span class="media-upload-tip">视频建议：正脸清晰 + 光线稳定 + 口型完整 + 无明显遮挡</span>
          </n-upload-dragger>
        </n-upload>
        <div class="upload-video-hint">
          <n-text type="info">上传要求：小于 500MB，推荐 1-2 分钟；数字人库最长支持 10 分钟。</n-text>
          <n-text depth="3">
            数字人库支持上传 10 分钟以内的视频，当前时长：{{ uploadedVideoDurationText }}
          </n-text>
          <n-text v-if="uploadedVideoError" type="error">{{ uploadedVideoError }}</n-text>
        </div>
      </n-form-item>

      <n-form-item v-else label="视频 URL / 文件名">
        <n-input
          v-model:value="form.originalVideoUrl"
          placeholder="支持公网视频 URL，或 VIDEO_SAVE_DIR 目录下的文件名"
        />
      </n-form-item>

      <n-form-item label="封面图 URL">
        <n-input
          v-model:value="form.coverUrl"
          placeholder="可选，留空则使用默认封面"
        />
      </n-form-item>
    </n-form>

    <template #footer>
      <n-space justify="end">
        <n-button :disabled="props.loading" @click="visible = false">取消</n-button>
        <n-button type="primary" :loading="props.loading" :disabled="submitDisabled" @click="submit">
          添加视频
        </n-button>
      </n-space>
    </template>
  </n-modal>

  <n-modal
    v-model:show="savedVideoViewerOpen"
    preset="card"
    class="saved-video-viewer-modal"
    :title="form.savedVideoName || '视频预览'"
  >
    <video
      v-if="savedVideoPreviewUrl"
      class="saved-video-viewer-modal__video"
      :src="savedVideoPreviewUrl"
      controls
      autoplay
      preload="metadata"
    />
  </n-modal>
</template>

<style scoped>
.source-options {
  flex-wrap: wrap;
}

.saved-video-empty-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  justify-content: flex-end;
  margin: 0 0 16px;
  padding: 12px;
  border: 1px solid rgba(96, 132, 255, 0.16);
  border-radius: 18px;
  background: rgba(248, 251, 255, 0.78);
}

.saved-video-empty-actions {
  justify-content: stretch;
}

.saved-video-empty-actions :deep(.n-button) {
  min-width: 128px;
}

.media-upload-shell {
  width: 100%;
}

.media-upload-card {
  display: grid;
  width: 100%;
  min-height: 252px;
  place-items: center;
  padding: 30px 22px;
  border: 2px dashed rgba(148, 163, 184, 0.34) !important;
  border-radius: 28px !important;
  background:
    radial-gradient(circle at 50% 24%, rgba(75, 107, 255, 0.08), transparent 24%),
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
  border-color: rgba(75, 107, 255, 0.5) !important;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.98),
    0 22px 42px rgba(75, 107, 255, 0.12);
  transform: translateY(-2px);
}

.media-upload-icon {
  display: grid;
  width: 64px;
  height: 64px;
  place-items: center;
  margin-bottom: 16px;
  border-radius: 50%;
  color: var(--primary);
  font-size: 31px;
  font-weight: 800;
  background: #ffffff;
  box-shadow:
    0 16px 32px rgba(75, 107, 255, 0.1),
    inset 0 0 0 1px rgba(75, 107, 255, 0.12);
}

.media-upload-card strong {
  color: #111827;
  font-size: 18px;
  font-weight: 900;
  text-align: center;
}

.media-upload-card p {
  max-width: 360px;
  margin: 8px 0 16px;
  color: #98a2b3;
  font-size: 15px;
  font-weight: 700;
  line-height: 1.5;
  text-align: center;
  word-break: break-all;
}

.media-upload-actions {
  display: flex;
  justify-content: center;
  width: 100%;
  margin: 0 0 14px;
}

.media-upload-remove {
  height: 32px;
  padding: 0 15px;
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
  padding: 9px 16px;
  border-radius: 14px;
  color: #4b6bff;
  font-size: 13px;
  font-weight: 800;
  line-height: 1.35;
  text-align: center;
  background: linear-gradient(135deg, rgba(75, 107, 255, 0.1), rgba(75, 199, 187, 0.13));
}

.media-upload-rule {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  max-width: 100%;
  margin: -8px 0 10px;
  padding: 8px 14px;
  border: 1px solid rgba(75, 107, 255, 0.14);
  border-radius: 999px;
  color: #3451f0;
  font-size: 13px;
  font-weight: 900;
  line-height: 1.35;
  text-align: center;
  background: rgba(75, 107, 255, 0.07);
}

.upload-video-hint {
  display: grid;
  gap: 4px;
  margin-top: 10px;
  padding: 10px 12px;
  border: 1px solid rgba(96, 132, 255, 0.14);
  border-radius: 14px;
  background: rgba(248, 251, 255, 0.72);
}

:global(.saved-video-viewer-modal) {
  width: min(920px, calc(100vw - 32px));
}

:global(.saved-video-viewer-modal__video) {
  display: block;
  width: 100%;
  max-height: 72vh;
  border-radius: 18px;
  background: #0f172a;
  box-shadow: 0 24px 60px rgba(15, 23, 42, 0.18);
}
</style>
