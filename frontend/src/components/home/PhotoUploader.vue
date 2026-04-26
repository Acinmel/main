<script setup lang="ts">
import { CloudUploadOutline } from '@vicons/ionicons5'
import { NIcon, NText, NUpload, NUploadDragger, type UploadFileInfo } from 'naive-ui'

const emit = defineEmits<{
  (e: 'update:file', file: File | null): void
}>()

const previewUrl = defineModel<string | null>('previewUrl', { default: null })

withDefaults(
  defineProps<{
    /** 为 false 时隐藏标题行（由外层已写「口播形象照片」说明时） */
    showHeader?: boolean
  }>(),
  { showHeader: true },
)

function handleChange(data: { fileList: UploadFileInfo[] }) {
  const raw = data.fileList[0]?.file
  if (!raw) {
    emit('update:file', null)
    previewUrl.value = null
    return
  }
  emit('update:file', raw)
}
</script>

<template>
  <div class="block">
    <div v-if="showHeader" class="block__label">
      <n-text strong>口播形象照片</n-text>
      <n-text depth="3" style="margin-left: 8px; font-size: 12px">点击或拖拽上传，仅保留一张</n-text>
    </div>

    <n-upload
      directory-dnd
      :max="1"
      accept=".jpg,.jpeg,.png,image/jpeg,image/png"
      :default-upload="false"
      list-type="image"
      @change="handleChange"
    >
      <n-upload-dragger>
        <div style="margin-bottom: 12px">
          <n-icon size="48" :depth="3">
            <CloudUploadOutline />
          </n-icon>
        </div>
        <n-text style="font-size: 16px">拖拽照片到此处，或点击选择文件</n-text>
        <n-text depth="3" style="font-size: 13px; margin-top: 6px">JPG / PNG · 单张 · 最大 8MB</n-text>
      </n-upload-dragger>
    </n-upload>

    <div v-if="previewUrl" class="preview">
      <img :src="previewUrl" alt="预览" />
    </div>
  </div>
</template>

<style scoped>
.block__label {
  margin-bottom: 8px;
}

.preview {
  margin-top: 12px;
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid rgba(148, 163, 184, 0.35);
  max-width: 280px;
}

.preview img {
  display: block;
  width: 100%;
  height: auto;
}
</style>
