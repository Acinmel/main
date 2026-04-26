<script setup lang="ts">
import { NInput, NText } from 'naive-ui'
import { computed } from 'vue'

const model = defineModel<string>({ required: true })

const props = defineProps<{
  invalid?: boolean
}>()

const status = computed(() => (props.invalid ? 'error' : undefined))
</script>

<template>
  <div class="block">
    <div class="block__label">
      <n-text strong>短视频链接</n-text>
      <n-text class="block__hint" depth="3" style="font-size: 12px">
        支持整段「复制链接」文案（含 v.douyin.com 短链）或纯 URL
      </n-text>
    </div>
    <n-input
      v-model:value="model"
      size="large"
      round
      clearable
      placeholder="可粘贴抖音整段分享文案，或 https://v.douyin.com/xxxx/"
      :status="status"
    />
  </div>
</template>

<style scoped>
.block__label {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 8px;
  flex-wrap: wrap;
  gap: 4px 8px;
}

.block__hint {
  margin-left: 8px;
}

@media (max-width: 480px) {
  .block__label {
    flex-direction: column;
    align-items: flex-start;
    justify-content: flex-start;
  }

  .block__hint {
    margin-left: 0;
  }
}
</style>
