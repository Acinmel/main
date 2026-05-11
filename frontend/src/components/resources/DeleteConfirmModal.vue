<script setup lang="ts">
import { computed } from 'vue'
import { NButton, NModal, NSpace, NText } from 'naive-ui'

const props = defineProps<{
  show: boolean
  title?: string
  count?: number
  loading?: boolean
}>()

const emit = defineEmits<{
  'update:show': [value: boolean]
  confirm: []
}>()

const visible = computed({
  get: () => props.show,
  set: (value) => emit('update:show', value),
})
</script>

<template>
  <n-modal v-model:show="visible" preset="card" class="delete-modal" :title="title || '确认删除'">
    <n-text>
      将删除 {{ count || 1 }} 个资源。删除后无法恢复，请确认是否继续。
    </n-text>
    <template #footer>
      <n-space justify="end">
        <n-button :disabled="loading" @click="visible = false">取消</n-button>
        <n-button type="error" :loading="loading" @click="emit('confirm')">确认删除</n-button>
      </n-space>
    </template>
  </n-modal>
</template>

<style scoped></style>
