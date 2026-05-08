<script setup lang="ts">
import { computed, reactive } from 'vue'
import { NButton, NForm, NFormItem, NInput, NModal, NSpace } from 'naive-ui'
import type { CreateVoiceResourceBody } from '@/types/resources'

const props = defineProps<{
  show: boolean
  loading?: boolean
}>()

const emit = defineEmits<{
  'update:show': [value: boolean]
  submit: [body: CreateVoiceResourceBody]
}>()

const visible = computed({
  get: () => props.show,
  set: (value) => emit('update:show', value),
})

const form = reactive({
  name: '',
  audioUrl: '',
})

function submit() {
  emit('submit', {
    name: form.name.trim() || '我的克隆音色',
    audioUrl: form.audioUrl.trim() || undefined,
  })
}
</script>

<template>
  <n-modal v-model:show="visible" preset="card" class="resource-modal" title="自定义声音克隆">
    <n-form label-placement="top">
      <n-form-item label="音色名称">
        <n-input v-model:value="form.name" placeholder="例如：温柔讲述音" />
      </n-form-item>
      <n-form-item label="试听音频 URL">
        <n-input v-model:value="form.audioUrl" placeholder="可选，留空使用默认试听音频" />
      </n-form-item>
    </n-form>
    <template #footer>
      <n-space justify="end">
        <n-button :disabled="loading" @click="visible = false">取消</n-button>
        <n-button type="primary" :loading="loading" @click="submit">开始克隆</n-button>
      </n-space>
    </template>
  </n-modal>
</template>

<style scoped>
.resource-modal {
  width: min(520px, calc(100vw - 32px));
}
</style>
