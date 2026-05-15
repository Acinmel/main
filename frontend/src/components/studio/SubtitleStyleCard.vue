<template>
  <section class="style-section">
    <div class="section-heading">
      <span class="heading-icon">T</span>
      <div>
        <h2>视频字幕样式</h2>
        <p>选择符合视频风格的字幕排版与动效</p>
      </div>
    </div>

    <div class="style-card">
      <div class="template-thumb">
        <img v-if="coverUrl" :src="coverUrl" alt="字幕模板封面" />
        <div v-else class="thumb-fallback">
          <strong>福气别乱说</strong>
          <span>小心招损!</span>
        </div>
      </div>

      <div class="style-content">
        <div class="style-header">
          <div>
            <span class="eyebrow">当前样式</span>
            <strong>{{ templateName || '模板 2054060216177152000' }}</strong>
          </div>
          <button class="ghost-btn" type="button" @click="$emit('change-template')">
            更换模板
          </button>
        </div>

        <label class="field">
          <span>视频标题</span>
          <div class="field-row">
            <input :value="localTitleLines[0]" @input="updateLine(0, $event)" />
            <button class="mini-btn" type="button" @click="$emit('shuffle')">换一个</button>
          </div>
        </label>

        <label class="field">
          <input :value="localTitleLines[1]" @input="updateLine(1, $event)" />
        </label>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  coverUrl?: string
  templateName?: string
  titleLines: string[]
}>()

const emit = defineEmits<{
  (event: 'update:titleLines', value: string[]): void
  (event: 'change-template'): void
  (event: 'shuffle'): void
}>()

const localTitleLines = computed(() => {
  const [first = '福气别乱说', second = '小心招损!'] = props.titleLines || []
  return [first, second]
})

function updateLine(index: number, event: Event) {
  const target = event.target as HTMLInputElement
  const next = [...localTitleLines.value]
  next[index] = target.value
  emit('update:titleLines', next)
}
</script>

<style scoped>
.style-section {
  display: grid;
  gap: var(--gap-md, 14px);
  min-width: 0;
}

.section-heading {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.heading-icon {
  display: grid;
  width: 34px;
  height: 34px;
  place-items: center;
  border-radius: 10px;
  color: #fff;
  font-size: 19px;
  font-weight: 800;
  background: var(--primary);
  box-shadow: 0 10px 22px rgba(124, 58, 237, 0.2);
}

.section-heading h2 {
  margin: 0;
  color: var(--text-main);
  font-size: var(--font-section-title, 15px);
  font-weight: 800;
  line-height: 1.1;
}

.section-heading p {
  margin: 3px 0 0;
  color: var(--text-sub);
  font-size: var(--font-small, 12px);
}

.style-card {
  display: grid;
  grid-template-columns: 88px minmax(0, 1fr);
  gap: 16px;
  align-items: center;
  min-width: 0;
  padding: 18px;
  border: 1px solid var(--border);
  border-radius: var(--card-radius, 18px);
  background: var(--bg-card);
  box-shadow: 0 12px 30px rgba(15, 23, 42, 0.045);
}

.template-thumb {
  position: relative;
  width: 82px;
  height: 132px;
  aspect-ratio: auto;
  aspect-ratio: 9 / 16;
  overflow: hidden;
  border: 1px solid #CBD5E1;
  border-radius: 10px;
  background: linear-gradient(180deg, #EFF6FF 0%, #FDF2F8 100%);
  box-shadow: 0 10px 22px rgba(15, 23, 42, 0.1);
}

.template-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.thumb-fallback {
  display: grid;
  height: 100%;
  place-items: center;
  padding: 10px;
  color: #111827;
  text-align: center;
  font-size: 12px;
  font-weight: 900;
}

.thumb-fallback span {
  color: #D97706;
}

.style-content {
  display: grid;
  min-width: 0;
  gap: 10px;
}

.style-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-width: 0;
}

.style-header div {
  min-width: 0;
}

.eyebrow,
.field span {
  display: block;
  margin-bottom: 5px;
  color: #94A3B8;
  font-size: var(--font-small, 12px);
  font-weight: 700;
}

.style-header strong {
  display: block;
  overflow: hidden;
  color: var(--text-main);
  font-size: 15px;
  font-weight: 800;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ghost-btn,
.mini-btn {
  border: 1px solid transparent;
  color: var(--primary);
  font-weight: 800;
  background: var(--primary-light);
  cursor: pointer;
  transition: transform 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease;
}

.ghost-btn {
  flex: 0 0 auto;
  height: 34px;
  padding: 0 13px;
  border-radius: 999px;
  font-size: 12px;
}

.mini-btn {
  height: 32px;
  padding: 0 11px;
  border-radius: 10px;
  font-size: 12px;
  background: #fff;
  border-color: #DDD6FE;
}

.ghost-btn:hover,
.mini-btn:hover {
  border-color: #C4B5FD;
  box-shadow: 0 12px 24px rgba(124, 58, 237, 0.12);
  transform: translateY(-1px);
}

.field {
  min-width: 0;
}

.field-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
}

input {
  width: 100%;
  height: var(--input-height, 36px);
  border: 0;
  border-radius: 10px;
  outline: none;
  padding: 0 12px;
  color: var(--text-main);
  font-size: var(--font-body, 13px);
  font-weight: 800;
  background: #F8FAFC;
}

input:focus {
  box-shadow: 0 0 0 2px #C4B5FD;
}

@media (max-width: 1500px) {
  .style-card {
    grid-template-columns: 82px minmax(0, 1fr);
    gap: 14px;
    padding: 16px;
  }

  .template-thumb {
    width: 76px;
    height: 124px;
  }

  .style-header strong {
    font-size: 14px;
  }
}
</style>
