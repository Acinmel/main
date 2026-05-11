<script setup lang="ts">
import { ref } from 'vue'
import { NButton, NCard, NCheckbox, NInput, NSpace, NTag, NText } from 'naive-ui'
import type { VoiceResource } from '@/types/resources'

const props = defineProps<{
  item: VoiceResource
  selected: boolean
  playing: boolean
}>()

const emit = defineEmits<{
  'update:selected': [value: boolean]
  rename: [name: string]
  delete: []
  play: []
}>()

const editing = ref(false)
const draftName = ref(props.item.name)

function saveName() {
  editing.value = false
  const next = draftName.value.trim()
  if (next && next !== props.item.name) emit('rename', next)
}
</script>

<template>
  <n-card class="voice-card" content-style="padding: 0">
    <div class="voice-card__top">
      <n-checkbox
        v-if="item.owner === 'mine'"
        class="voice-card__check"
        :checked="selected"
        @update:checked="emit('update:selected', $event)"
      />
      <n-tag class="voice-card__tag" size="small" :bordered="false">
        {{ item.owner === 'mine' ? '我的' : '推荐' }}
      </n-tag>
      <button class="voice-card__play" type="button" :aria-label="playing ? '停止试听' : '试听播放'" @click="emit('play')">
        {{ playing ? 'Ⅱ' : '▶' }}
      </button>
    </div>
    <div class="voice-card__body">
    <n-input
      v-if="editing"
      v-model:value="draftName"
      size="small"
      autofocus
      @blur="saveName"
      @keyup.enter="saveName"
    />
    <n-text v-else strong>{{ item.name }}</n-text>
    <n-text class="voice-card__meta" depth="3">
      上午 · {{ item.cloneStatus === 'ready' ? '20秒' : item.cloneStatus === 'processing' ? '克隆中' : '失败' }} · {{ item.updatedAt.slice(0, 10) }}
    </n-text>
    <n-space class="voice-card__actions" size="small">
      <n-button v-if="item.owner === 'mine'" size="small" @click="editing = true">编辑名称</n-button>
      <n-button v-if="item.owner === 'mine'" size="small" type="error" quaternary @click="emit('delete')">
        删除
      </n-button>
    </n-space>
    </div>
  </n-card>
</template>

<style scoped>
.voice-card {
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.58);
  border-radius: 26px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.9), rgba(246, 249, 255, 0.82));
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.94),
    var(--shadow-soft);
  transition:
    border-color var(--transition-fast),
    box-shadow var(--transition-fast),
    transform var(--transition-smooth);
}

.voice-card:hover {
  border-color: var(--border-strong);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.96),
    var(--shadow-panel);
  transform: translateY(-5px);
}

.voice-card__top {
  position: relative;
  display: grid;
  place-items: center;
  height: 82px;
}

.voice-card__check {
  position: absolute;
  top: 12px;
  left: 12px;
}

.voice-card__tag {
  position: absolute;
  top: 10px;
  right: 10px;
  color: var(--primary);
  background: rgba(75, 107, 255, 0.08);
}

.voice-card__play {
  width: 54px;
  height: 54px;
  color: var(--primary);
  cursor: pointer;
  border: 1px solid rgba(121, 144, 184, 0.22);
  border-radius: 18px;
  background:
    radial-gradient(circle at 30% 20%, rgba(255, 255, 255, 0.36), transparent 28%),
    rgba(75, 107, 255, 0.08);
  box-shadow: 0 10px 26px rgba(75, 107, 255, 0.12);
}

.voice-card__play:hover {
  color: #ffffff;
  border-color: rgba(75, 107, 255, 0.32);
  background: linear-gradient(135deg, var(--primary), var(--accent-teal));
  box-shadow: 0 0 28px rgba(75, 107, 255, 0.22);
  transform: translateY(-2px) scale(1.04);
}

.voice-card__body {
  padding: 0 18px 18px;
}

.voice-card__meta {
  display: block;
  margin-top: 6px;
  font-size: 11px;
}

.voice-card__actions {
  margin-top: 12px;
}
</style>
