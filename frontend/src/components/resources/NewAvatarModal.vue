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

const sourceMode = ref<'saved' | 'upload' | 'manual'>('saved')
const loadingSavedVideos = ref(false)
const savedVideoDirectory = ref('')
const savedVideoOptions = ref<Array<{ label: string; value: string }>>([])
const uploadedVideoFile = ref<File | null>(null)
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
  if (sourceMode.value === 'upload') return !uploadedVideoFile.value
  return !form.originalVideoUrl.trim()
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

function onUploadChange(fileList: UploadFileInfo[]) {
  const raw = fileList[0]?.file
  uploadedVideoFile.value = raw instanceof File ? raw : null
}

onBeforeUnmount(() => {
  clearSavedVideoPreview()
})
</script>

<template>
  <n-modal v-model:show="visible" preset="card" class="resource-modal" title="添加数字人">
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
          :max="1"
          accept="video/*,.mp4,.mov,.webm,.mkv,.m4v"
          :default-upload="false"
          @update:file-list="onUploadChange"
        >
          <n-button secondary>选择本地视频</n-button>
        </n-upload>
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
