<template>
  <section class="subtitle-editor">
    <div class="order-tip">建议顺序：更换模板 -> 高亮标题 -> 高亮字幕</div>

    <header class="editor-header">
      <div class="editor-title">
        <span class="title-bar" />
        <div>
          <h2>字幕编辑</h2>
          <p>仅保留高亮标题与高亮字幕能力</p>
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

    <div class="script-editor-block">
      <HighlightEditor
        :model-value="scriptText"
        :highlights="highlights"
        :highlight-style="currentHighlightStyle"
        @update:model-value="$emit('update:scriptText', $event)"
        @update:highlights="$emit('update:highlights', $event)"
        @mark-title="onMarkTitle"
        @warn="$emit('warn', $event)"
      />
    </div>

    <section class="timeline-block">
      <div class="timeline-head">
        <strong>字幕时间轴</strong>
        <span>{{ subtitles.length }} 段</span>
      </div>

      <div v-if="subtitles.length" class="timeline-scroll">
        <article
          v-for="(subtitle, index) in subtitles"
          :key="subtitle.id || `${index}-${subtitle.startTime}-${subtitle.endTime}`"
          class="timeline-row"
        >
          <span class="timeline-index">{{ String(index + 1).padStart(2, "0") }}</span>
          <input
            class="timeline-text"
            type="text"
            :value="subtitle.text"
            @input="onSubtitleTextInput(index, $event)"
          />
          <div class="timeline-time-group">
            <button type="button" @click="nudgeStartTime(index, -0.1)">-0.1</button>
            <input
              class="timeline-time-input"
              type="number"
              step="0.1"
              min="0"
              :value="subtitle.startTime"
              @change="onStartTimeChange(index, $event)"
            />
            <button type="button" @click="nudgeStartTime(index, 0.1)">+0.1</button>
          </div>
          <span class="timeline-sep">-</span>
          <div class="timeline-time-group">
            <button type="button" @click="nudgeEndTime(index, -0.1)">-0.1</button>
            <input
              class="timeline-time-input"
              type="number"
              step="0.1"
              min="0"
              :value="subtitle.endTime"
              @change="onEndTimeChange(index, $event)"
            />
            <button type="button" @click="nudgeEndTime(index, 0.1)">+0.1</button>
          </div>
        </article>
      </div>
      <div v-else class="timeline-empty">暂无可编辑字幕，请先生成时间轴</div>
    </section>

    <p v-if="renderDisabledReason && !rendering" class="render-block-reason">
      {{ renderDisabledReason }}
    </p>

    <button
      class="render-btn"
      type="button"
      :disabled="renderBlocked"
      :title="renderDisabledReason || undefined"
      @click="$emit('render')"
    >
      {{ rendering ? "正在生成成片..." : "立即剪辑" }}
    </button>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { SmartClipSubtitle } from "@/api/task";
import HighlightEditor from "./HighlightEditor.vue";
import { type ScriptHighlightRange } from "@/utils/highlightRangeUtils";

type TitleMarkConfig = {
  templateId: string;
  themeId: string;
  position: "center" | "top" | "bottom";
  duration: number;
};

const props = withDefaults(
  defineProps<{
    subtitles: SmartClipSubtitle[];
    enabled: boolean;
    rendering: boolean;
    renderDisabledReason?: string;
    scriptText: string;
    highlights: ScriptHighlightRange[];
    highlightColor?: string;
    titleMarkConfig: TitleMarkConfig;
  }>(),
  {
    highlightColor: "#FFD400",
  },
);

const emit = defineEmits<{
  (event: "update:enabled", value: boolean): void;
  (event: "update:subtitles", value: SmartClipSubtitle[]): void;
  (event: "update:scriptText", value: string): void;
  (event: "update:highlights", value: ScriptHighlightRange[]): void;
  (
    event: "mark-title",
    value: {
      start: number;
      end: number;
      text: string;
      templateId: string;
      themeId: string;
      position: "center" | "top" | "bottom";
      duration: number;
    },
  ): void;
  (event: "clear"): void;
  (event: "pull"): void;
  (event: "restore"): void;
  (event: "confirm"): void;
  (event: "render"): void;
  (event: "warn", value: string): void;
}>();

const renderBlocked = computed(() => props.rendering || Boolean(props.renderDisabledReason));
const currentHighlightStyle = computed(() => ({
  color: props.highlightColor || "#FFD400",
  fontSizeScale: 1.18,
  fontWeight: 900,
}));

function onMarkTitle(payload: { start: number; end: number; text: string }) {
  emit("mark-title", {
    ...payload,
    templateId: props.titleMarkConfig.templateId,
    themeId: props.titleMarkConfig.themeId,
    position: props.titleMarkConfig.position,
    duration: props.titleMarkConfig.duration,
  });
}

function roundSecond(value: number) {
  return Math.max(0, Number(value.toFixed(2)));
}

function patchSubtitle(
  index: number,
  patch: Partial<SmartClipSubtitle>,
) {
  if (index < 0 || index >= props.subtitles.length) return;
  const next = [...props.subtitles];
  const current = next[index];
  if (!current) return;
  const merged: SmartClipSubtitle = {
    ...current,
    ...patch,
  };
  const start = Number.isFinite(merged.startTime)
    ? roundSecond(Number(merged.startTime))
    : 0;
  const endCandidate = Number.isFinite(merged.endTime)
    ? roundSecond(Number(merged.endTime))
    : roundSecond(start + 0.1);
  const end = endCandidate > start ? endCandidate : roundSecond(start + 0.1);
  merged.startTime = start;
  merged.endTime = end;
  merged.text = typeof merged.text === "string" ? merged.text : "";
  next[index] = merged;
  emit("update:subtitles", next);
}

function readNumberFromEvent(event: Event) {
  const target = event.target as HTMLInputElement | null;
  if (!target) return Number.NaN;
  return Number(target.value);
}

function onSubtitleTextInput(index: number, event: Event) {
  const target = event.target as HTMLInputElement | null;
  patchSubtitle(index, { text: target?.value ?? "" });
}

function onStartTimeChange(index: number, event: Event) {
  const value = readNumberFromEvent(event);
  if (!Number.isFinite(value)) return;
  patchSubtitle(index, { startTime: value });
}

function onEndTimeChange(index: number, event: Event) {
  const value = readNumberFromEvent(event);
  if (!Number.isFinite(value)) return;
  patchSubtitle(index, { endTime: value });
}

function nudgeStartTime(index: number, delta: number) {
  const current = props.subtitles[index];
  if (!current) return;
  patchSubtitle(index, { startTime: current.startTime + delta });
}

function nudgeEndTime(index: number, delta: number) {
  const current = props.subtitles[index];
  if (!current) return;
  patchSubtitle(index, { endTime: current.endTime + delta });
}
</script>

<style scoped>
.subtitle-editor {
  position: relative;
  display: grid;
  grid-template-rows: auto auto auto auto;
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
  color: #64748b;
  font-size: 11px;
  font-weight: 700;
  background: #f1f5f9;
}

.editor-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 60px;
  padding: 14px 18px;
  border-bottom: 1px solid #f1f5f9;
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
  color: #94a3b8;
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
  background: #cbd5e1;
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
  border: 1px solid #ddd6fe;
  border-radius: 999px;
  padding: 0 10px;
  color: var(--primary);
  font-size: var(--font-small, 12px);
  font-weight: 800;
  background: #fff;
  cursor: pointer;
}

.outline.danger {
  border-color: #fca5a5;
  color: var(--danger);
}

.outline.success {
  border-color: #bbf7d0;
  color: #16a34a;
  background: #f0fdf4;
}

.script-editor-block {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 0;
  padding: 12px 16px 10px;
  border-bottom: 1px solid #f1f5f9;
}

.timeline-block {
  display: grid;
  gap: 10px;
  min-height: 0;
  padding: 12px 16px 10px;
  border-bottom: 1px solid #f1f5f9;
}

.timeline-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.timeline-head strong {
  color: #0f172a;
  font-size: 13px;
  font-weight: 900;
}

.timeline-head span {
  color: #64748b;
  font-size: 12px;
  font-weight: 700;
}

.timeline-scroll {
  display: grid;
  gap: 8px;
  max-height: 220px;
  overflow-y: auto;
  padding-right: 2px;
}

.timeline-scroll::-webkit-scrollbar {
  width: 8px;
}

.timeline-scroll::-webkit-scrollbar-thumb {
  border-radius: 999px;
  background: #cbd5e1;
}

.timeline-row {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr) auto auto auto;
  align-items: center;
  gap: 8px;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 8px;
  background: #fff;
}

.timeline-index {
  color: #94a3b8;
  font-size: 11px;
  font-weight: 800;
  text-align: center;
}

.timeline-text,
.timeline-time-input {
  border: 1px solid #dbe4ee;
  border-radius: 8px;
  color: #0f172a;
  font-size: 12px;
  font-weight: 700;
  background: #fff;
}

.timeline-text {
  min-width: 0;
  height: 32px;
  padding: 0 10px;
}

.timeline-time-input {
  width: 74px;
  height: 30px;
  padding: 0 8px;
}

.timeline-time-group {
  display: flex;
  align-items: center;
  gap: 4px;
}

.timeline-time-group > button {
  height: 30px;
  border: 1px solid #ddd6fe;
  border-radius: 8px;
  padding: 0 8px;
  color: #6d28d9;
  font-size: 11px;
  font-weight: 800;
  background: #fff;
  cursor: pointer;
}

.timeline-sep {
  color: #94a3b8;
  font-size: 12px;
  font-weight: 800;
}

.timeline-empty {
  border: 1px dashed #cbd5e1;
  border-radius: 10px;
  padding: 12px;
  color: #64748b;
  font-size: 12px;
  font-weight: 700;
  text-align: center;
}

.render-block-reason {
  margin: 10px 18px;
  padding: 10px 12px;
  border: 1px solid #fed7aa;
  border-radius: 12px;
  color: #9a3412;
  font-size: var(--font-small, 12px);
  font-weight: 800;
  line-height: 1.45;
  background: #fff7ed;
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
  background: linear-gradient(135deg, #7c3aed, #8b5cf6);
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

  .outline {
    padding: 0 8px;
    font-size: 11px;
  }
}
</style>
