<script setup lang="ts">
import {
  NAlert,
  NButton,
  NCard,
  NIcon,
  NProgress,
  NRadio,
  NRadioGroup,
  NSpace,
  NText,
  NUpload,
  NUploadDragger,
  useDialog,
  useMessage,
} from 'naive-ui'
import type { UploadFileInfo } from 'naive-ui'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { CloudUploadOutline } from '@vicons/ionicons5'
import DigitalHumanHero from '@/components/digital-human/DigitalHumanHero.vue'
import { generateDigitalHumanImage, getDigitalHumanStyles } from '@/api/task'
import { useDigitalHumanStore } from '@/stores/digitalHuman'
import { describeHttpOrNetworkError } from '@/utils/httpErrorMessage'

const message = useMessage()
const dialog = useDialog()
const router = useRouter()
const route = useRoute()
const dhStore = useDigitalHumanStore()

const FALLBACK_DIGITAL_HUMAN_STYLES: { id: string; label: string }[] = [
  { id: 'suit', label: '西装版' },
  { id: 'ancient', label: '古风版' },
  { id: 'casual', label: '休闲版' },
  { id: 'taoist', label: '道士版' },
  { id: 'fashion', label: '时尚版' },
]

const digitalHumanStyles = ref<{ id: string; label: string }[]>([...FALLBACK_DIGITAL_HUMAN_STYLES])
const selectedDigitalHumanStyleId = ref('suit')
const digitalHumanSelfieFile = ref<File | null>(null)
const digitalHumanSelfiePreview = ref<string | null>(null)
const digitalHumanHint = ref('')
const digitalHumanLoading = ref(false)
/** 生成过程可视进度（接口无流式进度，为模拟条 + 完成时拉满） */
const digitalHumanProgress = ref(0)
const digitalHumanProgressProcessing = ref(false)
let digitalHumanProgressTimer: ReturnType<typeof setInterval> | null = null

function clearDigitalHumanProgressTimer() {
  if (digitalHumanProgressTimer) {
    clearInterval(digitalHumanProgressTimer)
    digitalHumanProgressTimer = null
  }
}

function startDigitalHumanProgressSimulation() {
  clearDigitalHumanProgressTimer()
  digitalHumanProgress.value = 6
  digitalHumanProgressProcessing.value = true
  digitalHumanProgressTimer = setInterval(() => {
    if (digitalHumanProgress.value >= 88) return
    const p = digitalHumanProgress.value
    const delta = p < 38 ? 2.8 : p < 62 ? 1.4 : 0.5
    digitalHumanProgress.value = Math.min(88, Math.round((p + delta) * 10) / 10)
  }, 380)
}

/** 有已保存形象且未选择新自拍时展示服务端图 */
const showSavedPreview = computed(
  () =>
    Boolean(dhStore.hasTemplate && dhStore.previewBlobUrl && !digitalHumanSelfieFile.value),
)

function revokeSelfiePreview() {
  if (digitalHumanSelfiePreview.value) {
    URL.revokeObjectURL(digitalHumanSelfiePreview.value)
    digitalHumanSelfiePreview.value = null
  }
}

async function loadDigitalHumanStyles() {
  try {
    const list = await getDigitalHumanStyles()
    if (list?.length) digitalHumanStyles.value = list
  } catch {
    /* FALLBACK */
  }
}

function onDigitalHumanUploadChange(options: { fileList: UploadFileInfo[] }) {
  const raw = options.fileList[0]?.file
  const file = raw instanceof File ? raw : null
  revokeSelfiePreview()
  digitalHumanSelfieFile.value = file
  digitalHumanHint.value = ''
  if (file) {
    digitalHumanSelfiePreview.value = URL.createObjectURL(file)
  }
}

async function onGenerateDigitalHuman() {
  const file = digitalHumanSelfieFile.value
  if (!file?.size) {
    message.warning('请先上传一张自拍照')
    return
  }
  digitalHumanLoading.value = true
  digitalHumanHint.value = ''
  startDigitalHumanProgressSimulation()
  try {
    const res = await generateDigitalHumanImage({
      file,
      styleId: selectedDigitalHumanStyleId.value,
    })
    clearDigitalHumanProgressTimer()
    digitalHumanProgress.value = 100
    digitalHumanProgressProcessing.value = false
    digitalHumanHint.value = res.hint ?? ''
    await dhStore.refresh()
    if (dhStore.previewBlobUrl) {
      message.success(`已生成并保存数字人形象（${res.styleLabel}）`)
    } else if (res.imageUrl) {
      message.success(`已生成数字人形象（${res.styleLabel}）`)
    }
    await new Promise((r) => setTimeout(r, 480))
  } catch (e: unknown) {
    clearDigitalHumanProgressTimer()
    digitalHumanProgress.value = 0
    digitalHumanProgressProcessing.value = false
    message.error(describeHttpOrNetworkError(e))
  } finally {
    clearDigitalHumanProgressTimer()
    digitalHumanLoading.value = false
    digitalHumanProgress.value = 0
    digitalHumanProgressProcessing.value = false
  }
}

function confirmDeleteDigitalHuman() {
  dialog.warning({
    title: '删除数字人形象',
    content:
      '删除后口播制作、任务与作品等功能将不可用，直至再次在本页创建形象。确定删除吗？',
    positiveText: '确定删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      try {
        await dhStore.remove()
        revokeSelfiePreview()
        digitalHumanSelfieFile.value = null
        digitalHumanHint.value = ''
        message.warning('已删除数字人形象。请重新上传自拍照并生成后，再进入口播制作。')
      } catch (e: unknown) {
        message.error(describeHttpOrNetworkError(e))
        return false
      }
    },
  })
}

function goToStudio() {
  void router.push({ name: 'studio' })
}

watch(
  () => route.query.needDh,
  (v) => {
    if (v === '1') {
      message.warning('请先在本页完成专属数字人创建，再使用任务或作品等功能')
    }
  },
  { immediate: true },
)

onMounted(() => {
  void loadDigitalHumanStyles()
  void dhStore.refresh()
})

onUnmounted(() => {
  clearDigitalHumanProgressTimer()
  revokeSelfiePreview()
})
</script>

<template>
  <div class="page">
    <DigitalHumanHero />

    <div class="page__content">
      <n-card title="专属数字人" size="large" class="glass main-card">
        <n-space vertical :size="18">
          <n-alert type="info" :show-icon="false" class="priority-alert">
            <n-text>
              这是使用本产品的<strong>第一步</strong>。每位用户仅可保存 1 个数字人形象；再次生成将覆盖原有形象与文件。
              提示：不一定需要用数字人，如果有真人出镜，直接上传真人视频也可以。
            </n-text>
          </n-alert>

          <div>
            <n-text strong style="display: block; margin-bottom: 8px">上传自拍照</n-text>
            <n-text depth="3" style="font-size: 12px; display: block; margin-bottom: 10px">
              请上传面部清晰的照片（JPG/PNG）。服务端会将所选风格对应的提示词作为
              <code>content</code>
              调用你配置的大模型接口。
            </n-text>
            <n-upload
              directory-dnd
              :max="1"
              accept=".jpg,.jpeg,.png,image/jpeg,image/png"
              :default-upload="false"
              :disabled="digitalHumanLoading"
              list-type="image"
              @change="onDigitalHumanUploadChange"
            >
              <n-upload-dragger>
                <div style="margin-bottom: 10px">
                  <n-icon size="42" :depth="3">
                    <CloudUploadOutline />
                  </n-icon>
                </div>
                <n-text>拖拽或点击上传（单张最大 8MB）</n-text>
              </n-upload-dragger>
            </n-upload>
            <div v-if="digitalHumanSelfiePreview" class="dh-preview">
              <img :src="digitalHumanSelfiePreview" alt="自拍照预览" />
            </div>
          </div>

          <div>
            <n-text strong style="display: block; margin-bottom: 8px">数字人风格</n-text>
            <n-radio-group v-model:value="selectedDigitalHumanStyleId" name="dh-style">
              <n-space size="small" style="flex-wrap: wrap">
                <n-radio
                  v-for="s in digitalHumanStyles"
                  :key="s.id"
                  :value="s.id"
                  :disabled="digitalHumanLoading"
                >
                  {{ s.label }}
                </n-radio>
              </n-space>
            </n-radio-group>
          </div>

          <div v-if="digitalHumanLoading" class="dh-gen-progress">
            <n-text depth="3" style="font-size: 12px; display: block; margin-bottom: 8px">
              正在上传并调用大模型生成形象，请稍候（通常需数十秒，请勿关闭页面）…
            </n-text>
            <n-progress
              type="line"
              :percentage="digitalHumanProgress"
              :processing="digitalHumanProgressProcessing"
              :show-indicator="true"
              indicator-placement="inside"
              style="max-width: 520px"
            />
          </div>

          <n-space align="center" style="flex-wrap: wrap">
            <n-button
              type="primary"
              :loading="digitalHumanLoading"
              @click="onGenerateDigitalHuman"
            >
              生成并保存数字人形象
            </n-button>
            <n-button
              v-if="dhStore.hasTemplate"
              type="error"
              secondary
              :disabled="digitalHumanLoading"
              @click="confirmDeleteDigitalHuman"
            >
              删除数字人形象
            </n-button>
            <n-button
              type="success"
              secondary
              :disabled="!dhStore.hasTemplate"
              @click="goToStudio"
            >
              进入口播制作
            </n-button>
          </n-space>

          <n-alert v-if="digitalHumanHint" type="info" :show-icon="false">
            {{ digitalHumanHint }}
          </n-alert>

          <div v-if="showSavedPreview" class="dh-result-wrap">
            <n-text strong style="display: block; margin-bottom: 8px">当前已保存的形象</n-text>
            <img class="dh-result" :src="dhStore.previewBlobUrl!" alt="数字人形象" />
          </div>
        </n-space>
      </n-card>
    </div>
  </div>
</template>

<style scoped>
.page {
  padding: 8px 24px 48px;
}

.page__content {
  max-width: 720px;
  margin: 0 auto;
}

.main-card {
  margin-top: 8px;
}

.priority-alert {
  border-color: rgba(56, 189, 248, 0.45);
  background: rgba(56, 189, 248, 0.08);
}

.dh-gen-progress {
  margin-top: 4px;
  margin-bottom: 4px;
}

.dh-preview {
  margin-top: 10px;
  border-radius: 10px;
  overflow: hidden;
  border: 1px solid rgba(148, 163, 184, 0.35);
  max-width: 280px;
}

.dh-preview img {
  display: block;
  width: 100%;
  height: auto;
}

.dh-result-wrap {
  margin-top: 4px;
}

.dh-result {
  display: block;
  max-width: 100%;
  width: 420px;
  border-radius: 10px;
  border: 1px solid rgba(148, 163, 184, 0.35);
}

.glass {
  background: linear-gradient(145deg, rgba(15, 23, 42, 0.92), rgba(15, 23, 42, 0.72));
  border: 1px solid rgba(148, 163, 184, 0.35);
  box-shadow: 0 18px 45px rgba(15, 23, 42, 0.75);
}

@media (max-width: 900px) {
  .page {
    padding: 8px 16px 40px;
    padding-left: max(16px, var(--app-safe-left, 0px));
    padding-right: max(16px, var(--app-safe-right, 0px));
    padding-bottom: max(40px, var(--app-safe-bottom, 0px));
  }
}

@media (max-width: 640px) {
  .page {
    padding: 6px 12px 32px;
  }

  .page__content {
    max-width: 100%;
  }

  .dh-result {
    width: 100%;
  }
}
</style>
