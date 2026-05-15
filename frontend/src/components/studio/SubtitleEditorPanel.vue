<template>
  <section class="subtitle-editor">
    <div class="order-tip">建议顺序：字幕模板 → 标题 → 剪气口 → 画中画 → 背景音乐 → 文案字幕</div>

    <header class="editor-header">
      <div class="editor-title">
        <span class="title-bar" />
        <div>
          <h2>字幕编辑</h2>
          <p>支持划重点</p>
        </div>
      </div>

      <div class="editor-actions">
        <span class="enable-label">启用</span>
        <button
          class="switch small"
          :class="{ active: enabled }"
          type="button"
          aria-label="字幕启用开关"
          @click="$emit('update:enabled', !enabled)"
        >
          <span />
        </button>
        <button class="outline danger" type="button" @click="$emit('clear')">清空</button>
        <button class="outline" type="button" @click="$emit('pull')">拉取</button>
        <button class="outline" type="button" @click="$emit('restore')">还原</button>
        <button class="outline success" type="button" @click="$emit('confirm')">已确认</button>
      </div>
    </header>

    <div class="subtitle-list" :class="{ 'subtitle-list--empty': !editableSubtitles.length }">
      <div v-for="(subtitle, index) in editableSubtitles" :key="subtitle.id || index" class="subtitle-row">
        <span class="subtitle-index">{{ String(index + 1).padStart(2, '0') }}</span>
        <div
          class="subtitle-text"
          contenteditable="true"
          spellcheck="false"
          @input="updateSubtitleText(index, $event)"
          @dblclick="$emit('toggle-highlight', subtitle)"
        >
          <template v-for="(piece, pieceIndex) in buildPieces(subtitle.text)" :key="`${index}-${pieceIndex}-${piece.text}`">
            <span :class="{ highlight: piece.highlight }">{{ piece.text }}</span>
          </template>
        </div>
      </div>
      <div v-if="!editableSubtitles.length" class="empty-subtitles">
        <strong>暂无字幕</strong>
        <span>请先在第一步整理文案，进入第三步后会自动生成逐句字幕。</span>
      </div>
    </div>

    <button class="render-btn" type="button" :disabled="rendering" @click="$emit('render')">
      {{ rendering ? '正在生成成片...' : '立即剪辑' }}
    </button>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { SmartClipSubtitle } from '@/api/task'

const props = defineProps<{
  subtitles: SmartClipSubtitle[]
  enabled: boolean
  rendering: boolean
}>()

const emit = defineEmits<{
  (event: 'update:enabled', value: boolean): void
  (event: 'update:subtitles', value: SmartClipSubtitle[]): void
  (event: 'toggle-highlight', value: SmartClipSubtitle): void
  (event: 'clear'): void
  (event: 'pull'): void
  (event: 'restore'): void
  (event: 'confirm'): void
  (event: 'render'): void
}>()

const highlightKeywords = ['顺心事', '财不露白', '福不自炫', '从没错过', '招贴古人', '托您吉', '评论区聊聊']

const editableSubtitles = computed(() => props.subtitles ?? [])

function buildPieces(text = '') {
  const pieces: Array<{ text: string; highlight: boolean }> = []
  let cursor = 0

  while (cursor < text.length) {
    const matched = highlightKeywords.find((keyword) => text.startsWith(keyword, cursor))
    if (matched) {
      pieces.push({ text: matched, highlight: true })
      cursor += matched.length
    } else {
      pieces.push({ text: text[cursor], highlight: false })
      cursor += 1
    }
  }

  return pieces
}

function updateSubtitleText(index: number, event: Event) {
  const target = event.target as HTMLElement
  const next = editableSubtitles.value.map((item) => ({ ...item }))
  next[index].text = target.innerText.replace(/\n/g, '')
  emit('update:subtitles', next)
}
</script>

<style scoped>
.subtitle-editor {
  position: relative;
  display: grid;
  grid-template-rows: auto 1fr auto;
  width: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: var(--panel-radius, 20px);
  background: var(--bg-card);
  box-shadow: 0 18px 48px rgba(15, 23, 42, 0.06);
}

.order-tip {
  position: absolute;
  top: -46px;
  right: 0;
  max-width: min(100%, 430px);
  border-radius: 999px;
  padding: 8px 14px;
  color: #64748B;
  font-size: 11px;
  font-weight: 700;
  background: #F1F5F9;
}

.editor-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 60px;
  padding: 14px 18px;
  border-bottom: 1px solid #F1F5F9;
}

.editor-title {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.title-bar {
  width: 6px;
  height: 28px;
  border-radius: 999px;
  background: var(--primary);
}

.editor-title h2 {
  margin: 0;
  color: var(--text-main);
  font-size: var(--font-section-title, 15px);
  font-weight: 900;
  line-height: 1.1;
}

.editor-title p {
  margin: 3px 0 0;
  color: #94A3B8;
  font-size: var(--font-small, 12px);
  font-weight: 700;
}

.editor-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  flex-wrap: nowrap;
}

.enable-label {
  color: var(--text-main);
  font-size: var(--font-small, 12px);
  font-weight: 800;
}

.switch {
  position: relative;
  border: 0;
  border-radius: 999px;
  background: #CBD5E1;
  cursor: pointer;
}

.switch.small {
  width: 34px;
  height: 20px;
}

.switch span {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 14px;
  height: 14px;
  border-radius: 999px;
  background: #fff;
  box-shadow: 0 4px 9px rgba(15, 23, 42, 0.18);
  transition: transform 0.18s ease;
}

.switch.active {
  background: var(--primary);
}

.switch.active span {
  transform: translateX(14px);
}

.outline {
  height: var(--button-sm-height, 30px);
  border: 1px solid #DDD6FE;
  border-radius: 999px;
  padding: 0 10px;
  color: var(--primary);
  font-size: var(--font-small, 12px);
  font-weight: 800;
  background: #fff;
  cursor: pointer;
}

.outline.danger {
  border-color: #FCA5A5;
  color: var(--danger);
}

.outline.success {
  border-color: #BBF7D0;
  color: #16A34A;
  background: #F0FDF4;
}

.subtitle-list {
  min-height: 0;
  overflow-y: auto;
  padding: 6px 0 12px;
}

.subtitle-list--empty {
  display: grid;
  place-items: center;
}

.empty-subtitles {
  display: grid;
  justify-items: center;
  gap: 8px;
  padding: 32px 24px;
  color: #94A3B8;
  text-align: center;
}

.empty-subtitles strong {
  color: var(--text-main);
  font-size: 15px;
  font-weight: 900;
}

.empty-subtitles span {
  max-width: 320px;
  font-size: 12px;
  font-weight: 700;
  line-height: 1.7;
}

.subtitle-list::-webkit-scrollbar {
  width: 8px;
}

.subtitle-list::-webkit-scrollbar-thumb {
  border-radius: 999px;
  background: #CBD5E1;
}

.subtitle-row {
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr);
  align-items: center;
  min-height: 36px;
  padding: 0 20px;
  border-bottom: 1px solid #F1F5F9;
}

.subtitle-index {
  color: #CBD5E1;
  font-size: 11px;
  font-weight: 900;
}

.subtitle-text {
  min-width: 0;
  outline: none;
  color: var(--text-main);
  font-size: var(--font-body, 13px);
  font-weight: 900;
  line-height: 1.35;
  cursor: text;
  white-space: pre-wrap;
}

.highlight {
  color: var(--warning);
  text-shadow: 0 1px 0 rgba(217, 119, 6, 0.18);
}

.render-btn {
  width: calc(100% - 36px);
  height: 44px;
  margin: 0 18px 14px;
  border: 0;
  border-radius: 12px;
  color: #fff;
  font-size: 15px;
  font-weight: 900;
  background: linear-gradient(135deg, #7C3AED, #8B5CF6);
  box-shadow: 0 14px 28px rgba(124, 58, 237, 0.22);
  cursor: pointer;
}

.render-btn:disabled {
  opacity: 0.72;
  cursor: wait;
}

@media (max-width: 1500px) {
  .editor-header {
    padding: 12px 14px;
  }

  .editor-title h2 {
    font-size: 14px;
  }

  .editor-actions {
    gap: 6px;
  }

  .outline {
    padding: 0 8px;
    font-size: 11px;
  }

  .subtitle-row {
    grid-template-columns: 36px minmax(0, 1fr);
    min-height: 34px;
    padding: 0 16px;
  }

  .subtitle-text {
    font-size: 12px;
  }

  .order-tip {
    top: -42px;
    max-width: 360px;
    padding: 7px 12px;
  }
}
</style>
