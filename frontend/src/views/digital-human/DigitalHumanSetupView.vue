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
  { id: 'lawyer', label: '律师版' },
  { id: 'programmer', label: '程序员版' },
  { id: 'finance', label: '财务版' },
  { id: 'chef', label: '厨师版' },
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

/** 已有服务端保存的形象图，用于右侧「成品」区（选中新自拍时仍展示当前已保存图，并提示将覆盖） */
const hasSavedDigitalHuman = computed(
  () => Boolean(dhStore.hasTemplate && dhStore.previewBlobUrl),
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

          <div class="dh-workspace">
            <div class="dh-workspace__form">
              <div class="dh-panel dh-panel--upload">
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
                    <div class="dh-upload-icon">
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

              <div class="dh-panel dh-panel--styles">
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

              <n-space align="center" class="dh-actions">
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
            </div>

            <aside class="dh-result-wrap" aria-label="数字人成品预览">
              <template v-if="hasSavedDigitalHuman">
                <div class="dh-result-wrap__head">
                  <n-text strong style="display: block">当前数字人成品</n-text>
                  <n-text
                    v-if="dhStore.styleLabel"
                    depth="3"
                    style="font-size: 12px; display: block; margin-top: 4px"
                  >
                    风格：{{ dhStore.styleLabel }}
                  </n-text>
                  <n-alert
                    v-if="digitalHumanSelfieFile"
                    type="warning"
                    :show-icon="false"
                    style="margin-top: 10px"
                  >
                    <n-text style="font-size: 12px">
                      已选择新的自拍照，生成成功后将<strong>覆盖</strong>右侧成品图。
                    </n-text>
                  </n-alert>
                </div>
                <div class="dh-result-frame">
                  <img
                    class="dh-result"
                    :src="dhStore.previewBlobUrl!"
                    alt="已保存的数字人形象"
                  />
                </div>
              </template>
              <template v-else>
                <n-text strong style="display: block">成品预览区</n-text>
                <n-text depth="3" style="font-size: 13px; display: block; margin-top: 8px; line-height: 1.65">
                  左侧上传自拍并生成后，你的专属数字人将固定显示在右侧，便于对照与确认。
                </n-text>
                <div class="dh-result-placeholder" aria-hidden="true">
                  <n-text depth="3" style="font-size: 12px">等待生成…</n-text>
                </div>
              </template>
            </aside>
          </div>
        </n-space>
      </n-card>
    </div>
  </div>
</template>

<style scoped>
.page {
  position: relative;
  box-sizing: border-box;
  min-height: calc(100dvh - 112px);
  padding: 0 24px max(28px, var(--app-safe-bottom, 0px));
  overflow-x: hidden;
  overflow-y: visible;
  background:
    radial-gradient(circle at 12% 4%, rgba(168, 85, 247, 0.2), transparent 28%),
    radial-gradient(circle at 86% 18%, rgba(56, 189, 248, 0.15), transparent 26%),
    radial-gradient(circle at 72% 72%, rgba(236, 72, 153, 0.12), transparent 28%);
}

.page::before {
  position: absolute;
  inset: 0;
  pointer-events: none;
  content: '';
  background-image:
    linear-gradient(rgba(148, 163, 184, 0.045) 1px, transparent 1px),
    linear-gradient(90deg, rgba(148, 163, 184, 0.045) 1px, transparent 1px);
  background-size: 48px 48px;
  mask-image: linear-gradient(to bottom, rgba(0, 0, 0, 0.72), transparent 82%);
}

.page__content {
  position: relative;
  z-index: 1;
  max-width: min(1280px, 100%);
  margin: 0 auto;
}

.main-card {
  margin-top: 10px;
  border-radius: 28px;
}

.priority-alert {
  border-color: rgba(56, 189, 248, 0.45);
  border-radius: 18px;
  background:
    linear-gradient(90deg, rgba(56, 189, 248, 0.12), rgba(168, 85, 247, 0.1)),
    rgba(15, 23, 42, 0.56);
}

.dh-workspace {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(300px, 400px);
  gap: 22px;
  align-items: start;
}

.dh-workspace__form {
  display: grid;
  gap: 14px;
  min-width: 0;
}

.dh-panel {
  padding: 14px;
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 20px;
  background:
    radial-gradient(circle at 100% 0%, rgba(56, 189, 248, 0.1), transparent 30%),
    rgba(15, 23, 42, 0.4);
}

.dh-panel--styles {
  background:
    radial-gradient(circle at 0% 0%, rgba(236, 72, 153, 0.1), transparent 32%),
    rgba(15, 23, 42, 0.4);
  max-height: min(42vh, 340px);
  overflow-y: auto;
  scrollbar-gutter: stable;
}

.dh-upload-icon {
  margin-bottom: 10px;
  color: #7dd3fc;
}

.dh-gen-progress {
  padding: 12px 14px;
  margin-top: 4px;
  margin-bottom: 4px;
  border: 1px solid rgba(125, 211, 252, 0.18);
  border-radius: 18px;
  background: rgba(15, 23, 42, 0.42);
}

.dh-actions {
  flex-wrap: wrap;
  padding-top: 2px;
}

.dh-preview {
  max-width: 280px;
  margin-top: 14px;
  overflow: hidden;
  border: 1px solid rgba(125, 211, 252, 0.26);
  border-radius: 18px;
  box-shadow: 0 18px 44px rgba(0, 0, 0, 0.3);
}

.dh-preview img {
  display: block;
  width: 100%;
  height: auto;
}

.dh-result-wrap {
  position: sticky;
  top: 80px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 280px;
  padding: 16px;
  margin-top: 0;
  border: 1px solid rgba(216, 180, 254, 0.2);
  border-radius: 22px;
  background:
    radial-gradient(circle at 100% 10%, rgba(168, 85, 247, 0.12), transparent 30%),
    rgba(15, 23, 42, 0.42);
}

.dh-result-wrap__head :deep(.n-alert) {
  border-radius: 14px;
}

.dh-result-frame {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 220px;
  max-height: min(68vh, 560px);
  padding: 8px;
  border-radius: 18px;
  background: rgba(2, 6, 23, 0.45);
  border: 1px solid rgba(125, 211, 252, 0.12);
}

.dh-result {
  display: block;
  max-width: 100%;
  max-height: min(64vh, 520px);
  width: auto;
  height: auto;
  object-fit: contain;
  border-radius: 14px;
  box-shadow: 0 22px 60px rgba(0, 0, 0, 0.36);
}

.dh-result-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  min-height: 220px;
  margin-top: 4px;
  border: 1px dashed rgba(148, 163, 184, 0.28);
  border-radius: 18px;
  background: rgba(2, 6, 23, 0.35);
}

.glass {
  border: 1px solid rgba(216, 180, 254, 0.22);
  background:
    linear-gradient(145deg, rgba(15, 23, 42, 0.86), rgba(30, 12, 55, 0.7)),
    rgba(15, 23, 42, 0.8);
  box-shadow:
    0 30px 90px rgba(0, 0, 0, 0.48),
    0 0 70px rgba(124, 58, 237, 0.18);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
}

.page :deep(.n-card-header) {
  padding: 18px 22px 8px;
  color: #f8fafc;
  font-size: 22px;
  font-weight: 700;
}

.page :deep(.n-card__content) {
  padding: 12px 22px 22px;
}

.page :deep(.n-upload-dragger) {
  padding: 16px;
  border-color: rgba(125, 211, 252, 0.28);
  border-radius: 20px;
  background:
    linear-gradient(135deg, rgba(56, 189, 248, 0.08), rgba(168, 85, 247, 0.08)),
    rgba(2, 6, 23, 0.42);
}

.page :deep(.n-upload-dragger:hover) {
  border-color: rgba(125, 211, 252, 0.55);
  background:
    linear-gradient(135deg, rgba(56, 189, 248, 0.12), rgba(236, 72, 153, 0.1)),
    rgba(2, 6, 23, 0.52);
}

.page :deep(.n-radio) {
  padding: 8px 12px;
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.32);
}

.page :deep(.n-radio.n-radio--checked) {
  border-color: rgba(125, 211, 252, 0.42);
  background: rgba(14, 165, 233, 0.12);
}

@media (max-width: 900px) {
  .page {
    min-height: calc(100dvh - 112px);
    padding: 0 16px 40px;
    padding-left: max(16px, var(--app-safe-left, 0px));
    padding-right: max(16px, var(--app-safe-right, 0px));
    padding-bottom: max(40px, var(--app-safe-bottom, 0px));
  }

  .dh-workspace {
    grid-template-columns: 1fr;
  }

  .dh-result-wrap {
    position: static;
    top: auto;
    min-height: 0;
  }

  .dh-result-frame {
    max-height: min(52vh, 440px);
  }

  .dh-result {
    max-height: min(48vh, 400px);
  }

  .dh-panel--styles {
    max-height: min(38vh, 280px);
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
