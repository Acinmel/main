<script setup lang="ts">
import {
  NAlert,
  NButton,
  NCard,
  NDescriptions,
  NDescriptionsItem,
  NIcon,
  NProgress,
  NSpace,
  NTag,
  NText,
  NUpload,
  NUploadDragger,
  useMessage,
} from 'naive-ui'
import type { UploadFileInfo } from 'naive-ui'
import { CloudUploadOutline } from '@vicons/ionicons5'
import { computed, onUnmounted, ref } from 'vue'
import { createAliLipSyncVideo } from '@/api/task'
import { describeHttpOrNetworkError } from '@/utils/httpErrorMessage'

const MAX_VIDEO_SECONDS = 5 * 60

const message = useMessage()

const sourceFile = ref<File | null>(null)
const sourcePreviewUrl = ref('')
const resultVideoUrl = ref('')
const resultHint = ref('')
const durationSeconds = ref<number | null>(null)
const processing = ref(false)
const progress = ref(0)
const progressProcessing = ref(false)
let progressTimer: ReturnType<typeof setInterval> | null = null

const canSubmit = computed(
  () =>
    Boolean(sourceFile.value?.size) &&
    !processing.value &&
    durationSeconds.value !== null &&
    durationSeconds.value <= MAX_VIDEO_SECONDS,
)

const durationText = computed(() => {
  if (durationSeconds.value === null) return '待识别'
  return formatDuration(durationSeconds.value)
})

function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  const min = Math.floor(s / 60)
  const sec = s % 60
  return `${min}:${String(sec).padStart(2, '0')}`
}

function formatFileSize(size: number): string {
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`
  if (size >= 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${size} B`
}

function clearProgressTimer() {
  if (progressTimer) {
    clearInterval(progressTimer)
    progressTimer = null
  }
}

function startProgressSimulation() {
  clearProgressTimer()
  progress.value = 8
  progressProcessing.value = true
  progressTimer = setInterval(() => {
    if (progress.value >= 92) return
    const delta = progress.value < 45 ? 2.2 : progress.value < 72 ? 1.1 : 0.35
    progress.value = Math.min(92, Math.round((progress.value + delta) * 10) / 10)
  }, 500)
}

function revokeSourcePreview() {
  if (sourcePreviewUrl.value) {
    URL.revokeObjectURL(sourcePreviewUrl.value)
    sourcePreviewUrl.value = ''
  }
}

function resetResult() {
  resultVideoUrl.value = ''
  resultHint.value = ''
}

async function readVideoDuration(file: File): Promise<number> {
  const url = URL.createObjectURL(file)
  try {
    return await new Promise((resolve, reject) => {
      const video = document.createElement('video')
      video.preload = 'metadata'
      video.onloadedmetadata = () => {
        resolve(video.duration)
      }
      video.onerror = () => {
        reject(new Error('无法读取视频时长，请确认文件格式可播放'))
      }
      video.src = url
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}

async function onUploadChange(options: { fileList: UploadFileInfo[] }) {
  const raw = options.fileList[0]?.file
  const file = raw instanceof File ? raw : null
  revokeSourcePreview()
  resetResult()
  durationSeconds.value = null
  sourceFile.value = file

  if (!file) return
  if (!file.type.startsWith('video/') && !/\.(mp4|mov|webm|m4v|mkv)$/i.test(file.name)) {
    sourceFile.value = null
    message.warning('请上传视频文件')
    return
  }

  sourcePreviewUrl.value = URL.createObjectURL(file)
  try {
    const duration = await readVideoDuration(file)
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error('无法识别视频时长')
    }
    durationSeconds.value = duration
    if (duration > MAX_VIDEO_SECONDS) {
      message.warning('视频长度不能超过 5 分钟，请重新选择更短的视频')
    }
  } catch (e: unknown) {
    sourceFile.value = null
    revokeSourcePreview()
    message.error(e instanceof Error ? e.message : '无法读取视频时长')
  }
}

async function submitLipSync() {
  const file = sourceFile.value
  if (!file?.size) {
    message.warning('请先上传视频')
    return
  }
  if (durationSeconds.value === null) {
    message.warning('正在读取视频时长，请稍候')
    return
  }
  if (durationSeconds.value > MAX_VIDEO_SECONDS) {
    message.warning('视频长度不能超过 5 分钟')
    return
  }

  processing.value = true
  resetResult()
  startProgressSimulation()
  try {
    const res = await createAliLipSyncVideo({
      file,
      durationSeconds: durationSeconds.value,
    })
    clearProgressTimer()
    progress.value = 100
    progressProcessing.value = false
    resultVideoUrl.value = res.videoUrl ?? ''
    resultHint.value = res.hint ?? ''
    if (resultVideoUrl.value) {
      message.success('对口型处理完成')
    } else {
      message.warning('接口已返回，但未拿到可预览的视频地址')
    }
  } catch (e: unknown) {
    clearProgressTimer()
    progress.value = 0
    progressProcessing.value = false
    message.error(describeHttpOrNetworkError(e))
  } finally {
    processing.value = false
  }
}

onUnmounted(() => {
  clearProgressTimer()
  revokeSourcePreview()
})
</script>

<template>
  <div class="lip-page">
    <section class="lip-hero">
      <n-tag :bordered="false" class="lip-hero__tag">ALI LIP SYNC</n-tag>
      <h1>视频对口型</h1>
      <p>上传一段真人或数字人视频，调用阿里接口进行口型处理，并返回处理后视频。当前限制单个视频不超过 5 分钟。</p>
    </section>

    <section class="lip-workspace">
      <n-card title="上传视频" class="glass lip-card">
        <n-space vertical :size="16">
          <n-alert type="info" :show-icon="false">
            请上传 MP4 / MOV / WebM 等常见视频格式。页面会先读取本地视频时长，超过 5 分钟将无法提交。
          </n-alert>

          <n-upload
            directory-dnd
            :max="1"
            accept="video/*,.mp4,.mov,.webm,.m4v,.mkv"
            :default-upload="false"
            :disabled="processing"
            @change="onUploadChange"
          >
            <n-upload-dragger>
              <div class="lip-upload-icon">
                <n-icon size="44" :depth="3">
                  <CloudUploadOutline />
                </n-icon>
              </div>
              <n-text>拖拽或点击上传视频</n-text>
              <n-text depth="3" style="display: block; margin-top: 6px; font-size: 12px">
                视频长度上限 5 分钟
              </n-text>
            </n-upload-dragger>
          </n-upload>

          <n-descriptions v-if="sourceFile" label-placement="left" :column="2" bordered size="small">
            <n-descriptions-item label="文件名">{{ sourceFile.name }}</n-descriptions-item>
            <n-descriptions-item label="大小">{{ formatFileSize(sourceFile.size) }}</n-descriptions-item>
            <n-descriptions-item label="时长">
              <n-tag :type="durationSeconds !== null && durationSeconds > MAX_VIDEO_SECONDS ? 'error' : 'success'">
                {{ durationText }}
              </n-tag>
            </n-descriptions-item>
            <n-descriptions-item label="限制">≤ 5:00</n-descriptions-item>
          </n-descriptions>

          <div v-if="sourcePreviewUrl" class="video-frame">
            <video :src="sourcePreviewUrl" controls playsinline />
          </div>

          <div v-if="processing" class="lip-progress">
            <n-text depth="3" style="font-size: 12px; display: block; margin-bottom: 8px">
              正在上传并调用阿里接口处理，请勿关闭页面。
            </n-text>
            <n-progress
              type="line"
              :percentage="progress"
              :processing="progressProcessing"
              indicator-placement="inside"
            />
          </div>

          <n-space>
            <n-button type="primary" size="large" :disabled="!canSubmit" :loading="processing" @click="submitLipSync">
              开始对口型处理
            </n-button>
          </n-space>
        </n-space>
      </n-card>

      <n-card title="处理结果" class="glass lip-card">
        <n-space vertical :size="16">
          <template v-if="resultVideoUrl">
            <div class="video-frame video-frame--result">
              <video :src="resultVideoUrl" controls playsinline />
            </div>
            <n-space>
              <n-button tag="a" :href="resultVideoUrl" target="_blank" type="success" secondary>
                打开结果视频
              </n-button>
            </n-space>
            <n-alert v-if="resultHint" type="info" :show-icon="false">{{ resultHint }}</n-alert>
          </template>
          <template v-else>
            <div class="result-placeholder">
              <n-text depth="3">上传视频并处理后，结果会显示在这里。</n-text>
            </div>
          </template>
        </n-space>
      </n-card>
    </section>
  </div>
</template>

<style scoped>
.lip-page {
  box-sizing: border-box;
  min-height: calc(100dvh - 112px);
  padding: 36px 24px max(32px, var(--app-safe-bottom, 0px));
  color: var(--text-main);
  background:
    radial-gradient(circle at 14% 6%, rgba(22, 242, 139, 0.12), transparent 28%),
    radial-gradient(circle at 88% 16%, rgba(0, 210, 106, 0.1), transparent 28%),
    linear-gradient(135deg, #000302 0%, var(--bg-main) 42%, #000000 100%);
}

.lip-hero,
.lip-workspace {
  width: min(1180px, 100%);
  margin: 0 auto;
}

.lip-hero {
  margin-bottom: 22px;
}

.lip-hero__tag {
  color: var(--primary);
  background: rgba(22, 242, 139, 0.1);
  box-shadow: 0 0 22px rgba(22, 242, 139, 0.12);
}

.lip-hero h1 {
  margin: 14px 0 10px;
  color: var(--text-main);
  font-size: clamp(32px, 5vw, 58px);
  line-height: 1.05;
  letter-spacing: -0.04em;
}

.lip-hero p {
  max-width: 760px;
  margin: 0;
  color: var(--text-sub);
  font-size: 15px;
  line-height: 1.8;
}

.lip-workspace {
  display: grid;
  grid-template-columns: minmax(0, 1.08fr) minmax(340px, 0.92fr);
  gap: 18px;
  align-items: start;
}

.glass {
  border: 1px solid var(--border-soft);
  background: linear-gradient(180deg, rgba(8, 28, 21, 0.78), rgba(2, 10, 7, 0.86));
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.04),
    var(--shadow-soft);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
  transition:
    border-color var(--transition-fast),
    box-shadow var(--transition-fast),
    transform var(--transition-smooth);
}

.glass:hover {
  border-color: var(--border-strong);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.06),
    0 18px 44px rgba(0, 0, 0, 0.38),
    0 0 30px rgba(22, 242, 139, 0.12);
  transform: translateY(-3px);
}

.lip-card :deep(.n-card-header__main),
.lip-card :deep(.n-descriptions-header) {
  color: var(--text-main);
}

.lip-upload-icon {
  margin-bottom: 8px;
}

.video-frame {
  overflow: hidden;
  border: 1px solid var(--border-soft);
  border-radius: 18px;
  background: var(--bg-soft);
}

.video-frame video {
  display: block;
  width: 100%;
  max-height: 420px;
  background: var(--bg-soft);
}

.video-frame--result video {
  max-height: 520px;
}

.lip-progress {
  padding: 14px;
  border: 1px solid rgba(22, 242, 139, 0.16);
  border-radius: 16px;
  background: rgba(22, 242, 139, 0.06);
}

.result-placeholder {
  display: grid;
  min-height: 320px;
  place-items: center;
  border: 1px dashed var(--border-strong);
  border-radius: 18px;
  background: var(--bg-soft);
  text-align: center;
}

@media (max-width: 900px) {
  .lip-page {
    padding: 24px 16px max(24px, var(--app-safe-bottom, 0px));
  }

  .lip-workspace {
    grid-template-columns: 1fr;
  }
}
</style>
