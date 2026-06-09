<template>
  <section class="visual-editor">
    <header class="visual-editor__header">
      <div>
        <span class="visual-editor__eyebrow">封面工作台</span>
        <h3>{{ templateName || "封面式字幕编辑" }}</h3>
        <p>{{ draftAspectRatio }} 安全画布 · 字幕与标题位置</p>
      </div>
      <div class="visual-editor__actions">
        <button type="button" class="ghost" @click="$emit('cancel')">取消</button>
        <button type="button" class="primary" @click="applyChanges">保存并应用</button>
      </div>
    </header>

    <div class="visual-editor__body">
      <div class="canvas-wrap">
        <div class="canvas-toolbar">
          <span>{{ draftAspectRatio }}</span>
          <span>安全区</span>
          <span>{{ selectedBox === "subtitle" ? "字幕框" : "标题框" }}</span>
        </div>
        <div ref="canvasRef" class="preview-canvas">
          <div class="canvas-backdrop" />
          <div class="safe-area" :style="safeAreaStyle" />

          <button
            type="button"
            class="drag-box subtitle"
            :class="{ active: selectedBox === 'subtitle' }"
            :style="[subtitleBoxStyle, subtitlePreviewStyle]"
            @pointerdown="startDrag('subtitle', $event)"
            @click="selectedBox = 'subtitle'"
          >
            <span class="subtitle-preview-line">
              今天教你用 <b :style="{ color: draftSubtitle.highlightColor }">AI</b> 做口播视频
            </span>
          </button>

          <button
            type="button"
            class="drag-box title"
            :class="{ active: selectedBox === 'title' }"
            :style="[titleBoxStyle, titlePreviewStyle]"
            @pointerdown="startDrag('title', $event)"
            @click="selectedBox = 'title'"
          >
            实战模板标题
          </button>
        </div>
      </div>

      <aside class="controls">
        <div class="tab-row">
          <button type="button" :class="{ active: activeTab === 'cover' }" @click="activeTab = 'cover'">封面</button>
          <button type="button" :class="{ active: activeTab === 'title' }" @click="activeTab = 'title'">标题</button>
          <button type="button" :class="{ active: activeTab === 'subtitle' }" @click="activeTab = 'subtitle'">字幕</button>
          <button type="button" :class="{ active: activeTab === 'aspect' }" @click="activeTab = 'aspect'">画幅</button>
        </div>

        <section v-if="activeTab === 'cover'">
          <h4>封面文本</h4>
          <div class="field-grid">
            <label>
              <span>第一行</span>
              <input v-model="draftStyleConfig.cover!.line1" type="text" />
            </label>
            <label>
              <span>第二行</span>
              <input v-model="draftStyleConfig.cover!.line2" type="text" />
            </label>
            <label>
              <span>时长模式</span>
              <select v-model="draftStyleConfig.cover!.durationMode">
                <option value="full">full</option>
                <option value="custom">custom</option>
              </select>
            </label>
            <label>
              <span>时长(秒)</span>
              <input v-model.number="draftStyleConfig.cover!.durationSeconds" type="number" min="1" max="8" step="0.1" />
            </label>
            <label>
              <span>字体大小</span>
              <input v-model.number="draftStyleConfig.cover!.style!.fontSize" type="number" min="24" max="96" step="1" />
            </label>
            <label>
              <span>花字</span>
              <input v-model="draftStyleConfig.cover!.style!.flowerStyle" type="text" />
            </label>
            <label>
              <span>文本颜色</span>
              <input v-model="draftStyleConfig.cover!.style!.textColor" type="color" />
            </label>
            <label>
              <span>对齐</span>
              <select v-model="draftStyleConfig.cover!.style!.align">
                <option value="left">left</option>
                <option value="center">center</option>
                <option value="right">right</option>
              </select>
            </label>
          </div>
        </section>

        <section v-if="activeTab === 'title'">
          <h4>标题样式</h4>
          <div class="field-grid">
            <label>
              <span>文本颜色</span>
              <input v-model="draftStyleConfig.title!.style!.textColor" type="color" />
            </label>
            <label>
              <span>字体大小</span>
              <input v-model.number="draftStyleConfig.title!.style!.fontSize" type="number" min="24" max="96" step="1" />
            </label>
            <label>
              <span>标题位置</span>
              <select v-model="draftTitle.preset" @change="onTitlePresetChange">
                <option value="center">center</option>
                <option value="top">top</option>
                <option value="bottom">bottom</option>
              </select>
            </label>
            <label>
              <span>背景透明</span>
              <select v-model="draftStyleConfig.title!.style!.background!.transparent">
                <option :value="true">true</option>
                <option :value="false">false</option>
              </select>
            </label>
            <label>
              <span>背景色</span>
              <input v-model="draftStyleConfig.title!.style!.background!.color" type="color" />
            </label>
            <label>
              <span>背景透明度</span>
              <input v-model.number="draftStyleConfig.title!.style!.background!.opacity" type="number" min="0" max="1" step="0.05" />
            </label>
          </div>
          <label class="slider-field">
            <span>标题缩放 {{ draftTitle.scale.toFixed(2) }}</span>
            <input v-model.number="draftTitle.scale" type="range" min="0.8" max="1.4" step="0.02" />
          </label>
        </section>

        <section v-if="activeTab === 'subtitle'">
          <h4>字幕样式</h4>
          <div class="field-grid">
            <label>
              <span>普通字幕</span>
              <input v-model="draftSubtitle.normalColor" type="color" />
            </label>
            <label>
              <span>高亮字幕</span>
              <input v-model="draftSubtitle.highlightColor" type="color" />
            </label>
            <label>
              <span>描边</span>
              <input v-model="draftSubtitle.strokeColor" type="color" />
            </label>
            <label>
              <span>阴影</span>
              <input v-model="draftSubtitle.shadowColor" type="color" />
            </label>
            <label>
              <span>字体大小</span>
              <input v-model.number="draftStyleConfig.subtitle!.style!.fontSize" type="number" min="24" max="96" step="1" />
            </label>
            <label>
              <span>文本对齐</span>
              <select v-model="draftStyleConfig.subtitle!.style!.align">
                <option value="left">left</option>
                <option value="center">center</option>
                <option value="right">right</option>
              </select>
            </label>
            <label>
              <span>背景透明</span>
              <select v-model="draftStyleConfig.subtitle!.style!.background!.transparent">
                <option :value="true">true</option>
                <option :value="false">false</option>
              </select>
            </label>
            <label>
              <span>背景色</span>
              <input v-model="draftStyleConfig.subtitle!.style!.background!.color" type="color" />
            </label>
            <label>
              <span>背景透明度</span>
              <input v-model.number="draftStyleConfig.subtitle!.style!.background!.opacity" type="number" min="0" max="1" step="0.05" />
            </label>
          </div>
          <div class="row">
            <button
              type="button"
              :class="{ active: selectedBox === 'subtitle' }"
              @click="selectedBox = 'subtitle'"
            >
              字幕框
            </button>
            <button
              type="button"
              :class="{ active: selectedBox === 'title' }"
              @click="selectedBox = 'title'"
            >
              标题框
            </button>
          </div>
          <div class="field-grid">
            <label>
              <span>X(%)</span>
              <input :value="currentX" type="number" min="0" max="100" step="0.1" @input="onPositionInput('x', $event)" />
            </label>
            <label>
              <span>Y(%)</span>
              <input :value="currentY" type="number" min="0" max="100" step="0.1" @input="onPositionInput('y', $event)" />
            </label>
            <label>
              <span>锚点</span>
              <select :value="currentAnchor" @change="onAnchorChange($event)">
                <option v-for="item in anchorOptions" :key="item.value" :value="item.value">
                  {{ item.label }}
                </option>
              </select>
            </label>
          </div>
          <div class="arrow-pad">
            <button type="button" @click="nudge(0, -0.5)">↑</button>
            <div class="arrow-pad__middle">
              <button type="button" @click="nudge(-0.5, 0)">←</button>
              <button type="button" @click="nudge(0.5, 0)">→</button>
            </div>
            <button type="button" @click="nudge(0, 0.5)">↓</button>
          </div>
        </section>

        <section v-if="activeTab === 'aspect'">
          <h4>成片画幅</h4>
          <div class="aspect-grid">
            <button
              v-for="ratio in aspectRatioOptions"
              :key="ratio"
              type="button"
              :class="{ active: draftAspectRatio === ratio }"
              @click="draftAspectRatio = ratio"
            >
              {{ ratio }}
            </button>
          </div>
        </section>

        <section class="footer-actions">
          <button type="button" class="ghost" @click="resetColors">重置颜色</button>
          <button type="button" class="ghost" @click="resetLayout">重置位置</button>
        </section>
      </aside>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import type {
  SubtitleVisualStyle,
  TitleLayout,
  VisualAnchor,
} from "@/api/task";
import type {
  SubtitleTemplateAnchor,
  SubtitleTemplateAspectRatio,
  SubtitleTemplateStyleConfig,
  SubtitleTemplateTextStyle,
} from "@/types/resources";

const SAFE_AREA = {
  topPct: 8,
  rightPct: 6,
  bottomPct: 8,
  leftPct: 6,
};

const anchorOptions: Array<{ label: string; value: VisualAnchor }> = [
  { label: "左上", value: "top-left" },
  { label: "上中", value: "top-center" },
  { label: "右上", value: "top-right" },
  { label: "左中", value: "center-left" },
  { label: "中心", value: "center" },
  { label: "右中", value: "center-right" },
  { label: "左下", value: "bottom-left" },
  { label: "下中", value: "bottom-center" },
  { label: "右下", value: "bottom-right" },
];

const props = defineProps<{
  templateName?: string;
  subtitleVisualStyle: SubtitleVisualStyle;
  titleLayout: TitleLayout;
  defaultSubtitleVisualStyle: SubtitleVisualStyle;
  defaultTitleLayout: TitleLayout;
  initialStyleConfig?: SubtitleTemplateStyleConfig;
  initialAspectRatio?: SubtitleTemplateAspectRatio;
}>();

const emit = defineEmits<{
  (
    event: "apply",
    value: {
      aspectRatio: SubtitleTemplateAspectRatio;
      styleConfig: SubtitleTemplateStyleConfig;
      subtitleVisualStyle: SubtitleVisualStyle;
      titleLayout: TitleLayout;
    },
  ): void;
  (event: "cancel"): void;
  (event: "warn", value: string): void;
}>();

const aspectRatioOptions: SubtitleTemplateAspectRatio[] = [
  "9:16",
  "16:9",
  "1:1",
  "4:5",
  "3:4",
];

const activeTab = ref<"cover" | "title" | "subtitle" | "aspect">("cover");
const selectedBox = ref<"subtitle" | "title">("subtitle");
const draftSubtitle = ref<SubtitleVisualStyle>({ ...props.subtitleVisualStyle });
const draftTitle = ref<TitleLayout>({ ...props.titleLayout });
const draftAspectRatio = ref<SubtitleTemplateAspectRatio>(
  props.initialAspectRatio ?? "9:16",
);
const draftStyleConfig = ref<SubtitleTemplateStyleConfig>(
  normalizeStyleConfig(props.initialStyleConfig),
);
const canvasRef = ref<HTMLElement | null>(null);
const dragging = ref<"subtitle" | "title" | null>(null);

watch(
  () => props.subtitleVisualStyle,
  (value) => {
    draftSubtitle.value = { ...value };
  },
  { deep: true },
);

watch(
  () => props.titleLayout,
  (value) => {
    draftTitle.value = { ...value };
  },
  { deep: true },
);
watch(
  () => props.initialStyleConfig,
  (value) => {
    draftStyleConfig.value = normalizeStyleConfig(value);
  },
  { deep: true },
);
watch(
  () => props.initialAspectRatio,
  (value) => {
    draftAspectRatio.value = value ?? "9:16";
  },
);

const safeAreaStyle = computed(() => ({
  top: `${SAFE_AREA.topPct}%`,
  right: `${SAFE_AREA.rightPct}%`,
  bottom: `${SAFE_AREA.bottomPct}%`,
  left: `${SAFE_AREA.leftPct}%`,
}));

const currentX = computed(() =>
  selectedBox.value === "subtitle" ? draftSubtitle.value.xPct : draftTitle.value.xPct,
);
const currentY = computed(() =>
  selectedBox.value === "subtitle" ? draftSubtitle.value.yPct : draftTitle.value.yPct,
);
const currentAnchor = computed<VisualAnchor>(() =>
  selectedBox.value === "subtitle" ? draftSubtitle.value.anchor : draftTitle.value.anchor,
);

const subtitleBoxStyle = computed(() =>
  toBoxStyle(draftSubtitle.value.xPct, draftSubtitle.value.yPct, draftSubtitle.value.anchor, 1),
);
const titleBoxStyle = computed(() =>
  toBoxStyle(draftTitle.value.xPct, draftTitle.value.yPct, draftTitle.value.anchor, draftTitle.value.scale),
);
const subtitlePreviewStyle = computed(() => {
  const subtitleStyle = draftStyleConfig.value.subtitle!.style!;
  const background = subtitleStyle.background;
  const fontSizeRaw = Number(subtitleStyle.fontSize ?? 46);
  const fontSize = Number.isFinite(fontSizeRaw) ? fontSizeRaw : 46;
  return {
    color: draftSubtitle.value.normalColor,
    textAlign: subtitleStyle.align || "center",
    fontSize: `${Math.max(12, Math.min(26, fontSize * 0.34)).toFixed(1)}px`,
    lineHeight: "1.25",
    background:
      background?.transparent === false
        ? withAlpha(background.color || "#000000", background.opacity ?? 0.45)
        : "rgba(0,0,0,0.16)",
    textShadow: `0 2px 8px ${draftSubtitle.value.shadowColor || "rgba(0,0,0,0.65)"}`,
    WebkitTextStroke: `1px ${draftSubtitle.value.strokeColor || "#000000"}`,
  } as const;
});
const titlePreviewStyle = computed(() => {
  const titleStyle = draftStyleConfig.value.title!.style!;
  const background = titleStyle.background;
  const fontSizeRaw = Number(titleStyle.fontSize ?? 52);
  const fontSize = Number.isFinite(fontSizeRaw) ? fontSizeRaw : 52;
  return {
    color: titleStyle.textColor || "#ffffff",
    textAlign: titleStyle.align || "center",
    fontSize: `${Math.max(13, Math.min(28, fontSize * 0.34)).toFixed(1)}px`,
    lineHeight: "1.15",
    background:
      background?.transparent === false
        ? withAlpha(background.color || "#000000", background.opacity ?? 0.5)
        : "rgba(0,0,0,0.22)",
    textShadow: "0 3px 10px rgba(0,0,0,0.42)",
  } as const;
});

function clampPct(value: number, axis: "x" | "y") {
  const min = axis === "x" ? SAFE_AREA.leftPct : SAFE_AREA.topPct;
  const max = axis === "x" ? 100 - SAFE_AREA.rightPct : 100 - SAFE_AREA.bottomPct;
  return Math.max(min, Math.min(max, Number(value.toFixed(2))));
}

function toBoxStyle(xPct: number, yPct: number, anchor: VisualAnchor, scale = 1) {
  const transformMap: Record<VisualAnchor, string> = {
    "top-left": "translate(0, 0)",
    "top-center": "translate(-50%, 0)",
    "top-right": "translate(-100%, 0)",
    "center-left": "translate(0, -50%)",
    center: "translate(-50%, -50%)",
    "center-right": "translate(-100%, -50%)",
    "bottom-left": "translate(0, -100%)",
    "bottom-center": "translate(-50%, -100%)",
    "bottom-right": "translate(-100%, -100%)",
  };
  return {
    left: `${xPct}%`,
    top: `${yPct}%`,
    transform: `${transformMap[anchor]} scale(${scale})`,
  };
}

function withAlpha(color: string, opacity: number) {
  const alpha = Math.max(0, Math.min(1, Number.isFinite(opacity) ? opacity : 0.45));
  if (/^rgba?\(/i.test(color)) return color;
  const hex = color.trim().replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) {
    return `rgba(0,0,0,${alpha.toFixed(2)})`;
  }
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(2)})`;
}

function setPosition(xPct: number, yPct: number) {
  const x = clampPct(xPct, "x");
  const y = clampPct(yPct, "y");
  if (selectedBox.value === "subtitle") {
    draftSubtitle.value.xPct = x;
    draftSubtitle.value.yPct = y;
    draftStyleConfig.value.subtitle!.style!.xPct = x;
    draftStyleConfig.value.subtitle!.style!.yPct = y;
    return;
  }
  draftTitle.value.xPct = x;
  draftTitle.value.yPct = y;
  draftTitle.value.mode = "custom";
  draftStyleConfig.value.title!.style!.xPct = x;
  draftStyleConfig.value.title!.style!.yPct = y;
}

function nudge(dx: number, dy: number) {
  setPosition(currentX.value + dx, currentY.value + dy);
}

function onPositionInput(axis: "x" | "y", event: Event) {
  const target = event.target as HTMLInputElement;
  const value = Number(target.value);
  if (!Number.isFinite(value)) return;
  if (axis === "x") {
    setPosition(value, currentY.value);
    return;
  }
  setPosition(currentX.value, value);
}

function onAnchorChange(event: Event) {
  const target = event.target as HTMLSelectElement;
  const value = target.value as VisualAnchor;
  if (selectedBox.value === "subtitle") {
    draftSubtitle.value.anchor = value;
    draftStyleConfig.value.subtitle!.style!.anchor = value;
    return;
  }
  draftTitle.value.anchor = value;
  draftTitle.value.mode = "custom";
  draftStyleConfig.value.title!.style!.anchor = value;
}

function onTitlePresetChange() {
  const preset = draftTitle.value.preset;
  const positions: Record<"center" | "top" | "bottom", number> = {
    center: 50,
    top: 28,
    bottom: 80,
  };
  draftTitle.value.mode = "preset";
  draftTitle.value.anchor = "center";
  draftTitle.value.xPct = 50;
  draftTitle.value.yPct = positions[preset];
}

function resetColors() {
  draftSubtitle.value.normalColor = props.defaultSubtitleVisualStyle.normalColor;
  draftSubtitle.value.highlightColor = props.defaultSubtitleVisualStyle.highlightColor;
  draftSubtitle.value.strokeColor = props.defaultSubtitleVisualStyle.strokeColor;
  draftSubtitle.value.shadowColor = props.defaultSubtitleVisualStyle.shadowColor;
  draftStyleConfig.value.subtitle!.style!.textColor =
    props.defaultSubtitleVisualStyle.normalColor;
}

function resetLayout() {
  draftSubtitle.value = { ...props.defaultSubtitleVisualStyle };
  draftTitle.value = { ...props.defaultTitleLayout };
  draftStyleConfig.value = normalizeStyleConfig(props.initialStyleConfig);
  draftAspectRatio.value = props.initialAspectRatio ?? "9:16";
}

function applyChanges() {
  draftStyleConfig.value.subtitle!.style!.textColor = draftSubtitle.value.normalColor;
  draftStyleConfig.value.subtitle!.style!.xPct = draftSubtitle.value.xPct;
  draftStyleConfig.value.subtitle!.style!.yPct = draftSubtitle.value.yPct;
  draftStyleConfig.value.subtitle!.style!.anchor = draftSubtitle.value.anchor;
  draftStyleConfig.value.title!.style!.xPct = draftTitle.value.xPct;
  draftStyleConfig.value.title!.style!.yPct = draftTitle.value.yPct;
  draftStyleConfig.value.title!.style!.anchor =
    draftTitle.value.anchor as SubtitleTemplateAnchor;
  emit("apply", {
    aspectRatio: draftAspectRatio.value,
    styleConfig: draftStyleConfig.value,
    subtitleVisualStyle: {
      ...draftSubtitle.value,
      xPct: clampPct(draftSubtitle.value.xPct, "x"),
      yPct: clampPct(draftSubtitle.value.yPct, "y"),
    },
    titleLayout: {
      ...draftTitle.value,
      xPct: clampPct(draftTitle.value.xPct, "x"),
      yPct: clampPct(draftTitle.value.yPct, "y"),
      scale: Math.max(0.8, Math.min(1.4, Number(draftTitle.value.scale.toFixed(2)))),
    },
  });
}

function startDrag(target: "subtitle" | "title", event: PointerEvent) {
  event.preventDefault();
  const rect = canvasRef.value?.getBoundingClientRect();
  if (!rect) {
    emit("warn", "画布尚未就绪，请稍后重试");
    return;
  }
  selectedBox.value = target;
  dragging.value = target;
  window.addEventListener("pointermove", onDragMove);
  window.addEventListener("pointerup", stopDrag);
}

function onDragMove(event: PointerEvent) {
  if (!dragging.value) return;
  const rect = canvasRef.value?.getBoundingClientRect();
  if (!rect) return;
  const xPct = ((event.clientX - rect.left) / rect.width) * 100;
  const yPct = ((event.clientY - rect.top) / rect.height) * 100;
  setPosition(xPct, yPct);
}

function stopDrag() {
  dragging.value = null;
  window.removeEventListener("pointermove", onDragMove);
  window.removeEventListener("pointerup", stopDrag);
}

onBeforeUnmount(() => {
  stopDrag();
});

function normalizeStyleConfig(
  input?: SubtitleTemplateStyleConfig,
): SubtitleTemplateStyleConfig {
  return {
    cover: {
      line1: input?.cover?.line1 ?? "第一行文字",
      line2: input?.cover?.line2 ?? "第二行文字",
      durationMode: input?.cover?.durationMode ?? "full",
      durationSeconds: input?.cover?.durationSeconds ?? 3,
      style: normalizeTextStyle(input?.cover?.style, "bottom-center"),
    },
    title: {
      style: normalizeTextStyle(input?.title?.style, "center"),
    },
    subtitle: {
      style: normalizeTextStyle(input?.subtitle?.style, "bottom-center"),
    },
  };
}

function normalizeTextStyle(
  style: SubtitleTemplateTextStyle | undefined,
  defaultAnchor: SubtitleTemplateAnchor,
): SubtitleTemplateTextStyle {
  return {
    fontFamily: style?.fontFamily ?? "Inter",
    fontSize: style?.fontSize ?? 46,
    flowerStyle: style?.flowerStyle ?? "none",
    textColor: style?.textColor ?? "#FFFFFF",
    align: style?.align ?? "center",
    shadow: {
      enabled: style?.shadow?.enabled ?? true,
      color: style?.shadow?.color ?? "#000000",
      blur: style?.shadow?.blur ?? 8,
      x: style?.shadow?.x ?? 0,
      y: style?.shadow?.y ?? 2,
    },
    background: {
      transparent: style?.background?.transparent ?? true,
      color: style?.background?.color ?? "#000000",
      opacity: style?.background?.opacity ?? 0,
    },
    xPct: style?.xPct ?? 50,
    yPct: style?.yPct ?? 82,
    anchor: style?.anchor ?? defaultAnchor,
  };
}
</script>

<style scoped>
.visual-editor {
  display: grid;
  gap: 16px;
  border: 1px solid rgba(226, 232, 240, 0.9);
  border-radius: 22px;
  padding: 16px;
  background:
    radial-gradient(circle at 15% 10%, rgba(34, 211, 238, 0.12), transparent 28%),
    linear-gradient(135deg, #f8fbff 0%, #ffffff 42%, #f6f3ff 100%);
  box-shadow: 0 20px 45px rgba(15, 23, 42, 0.08);
}

.visual-editor__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.visual-editor__eyebrow {
  display: inline-flex;
  width: fit-content;
  margin-bottom: 6px;
  border-radius: 999px;
  padding: 4px 8px;
  color: #6d28d9;
  font-size: 11px;
  font-weight: 900;
  background: #f3e8ff;
}

.visual-editor__header h3 {
  margin: 0;
  color: #0f172a;
  font-size: 18px;
  font-weight: 900;
}

.visual-editor__header p {
  margin: 4px 0 0;
  color: #64748b;
  font-size: 12px;
  font-weight: 700;
}

.visual-editor__actions {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-top: 2px;
}

.visual-editor__actions button {
  height: 34px;
  border-radius: 10px;
  padding: 0 14px;
  font-size: 12px;
  font-weight: 800;
  cursor: pointer;
  transition:
    transform 0.18s ease,
    box-shadow 0.18s ease,
    border-color 0.18s ease;
}

.visual-editor__actions .ghost {
  border: 1px solid #dbe2f1;
  color: #334155;
  background: #fff;
}

.visual-editor__actions .primary {
  border: 0;
  color: #fff;
  background: linear-gradient(135deg, #7c3aed, #8b5cf6);
  box-shadow: 0 12px 24px rgba(124, 58, 237, 0.22);
}

.visual-editor__actions button:hover {
  transform: translateY(-1px);
}

.visual-editor__body {
  display: grid;
  grid-template-columns: minmax(320px, 1fr) minmax(340px, 380px);
  gap: 16px;
  align-items: stretch;
}

.canvas-wrap {
  display: grid;
  align-content: start;
  justify-items: center;
  gap: 12px;
  min-height: 100%;
  border: 1px solid rgba(226, 232, 240, 0.9);
  border-radius: 18px;
  padding: 14px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.76), rgba(248, 250, 252, 0.94)),
    radial-gradient(circle at 50% 8%, rgba(124, 58, 237, 0.1), transparent 34%);
}

.canvas-toolbar {
  display: flex;
  width: min(360px, 100%);
  justify-content: space-between;
  gap: 8px;
}

.canvas-toolbar span {
  border: 1px solid rgba(203, 213, 225, 0.8);
  border-radius: 999px;
  padding: 5px 9px;
  color: #475569;
  font-size: 11px;
  font-weight: 900;
  background: rgba(255, 255, 255, 0.76);
}

.preview-canvas {
  position: relative;
  width: min(360px, 100%);
  aspect-ratio: 9 / 16;
  border: 10px solid #0f172a;
  border-radius: 30px;
  background:
    radial-gradient(circle at 20% 12%, rgba(34, 211, 238, 0.24), transparent 30%),
    radial-gradient(circle at 72% 62%, rgba(124, 58, 237, 0.22), transparent 32%),
    linear-gradient(180deg, #2d3748 0%, #111827 42%, #020617 100%);
  overflow: hidden;
  box-shadow:
    0 28px 60px rgba(15, 23, 42, 0.24),
    inset 0 0 0 1px rgba(255, 255, 255, 0.08);
}

.canvas-backdrop {
  position: absolute;
  inset: 0;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.08), transparent 22%),
    repeating-linear-gradient(
      0deg,
      rgba(255, 255, 255, 0.035) 0,
      rgba(255, 255, 255, 0.035) 1px,
      transparent 1px,
      transparent 34px
    );
  pointer-events: none;
}

.safe-area {
  position: absolute;
  border: 1px dashed rgba(148, 163, 184, 0.85);
  border-radius: 18px;
  pointer-events: none;
}

.drag-box {
  position: absolute;
  border: 1px solid rgba(226, 232, 240, 0.9);
  border-radius: 12px;
  color: #fff;
  font-size: 12px;
  font-weight: 800;
  line-height: 1;
  cursor: grab;
  user-select: none;
  touch-action: none;
  transition:
    border-color 0.16s ease,
    box-shadow 0.16s ease,
    background 0.16s ease;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  white-space: normal;
  letter-spacing: 0.3px;
}

.drag-box.subtitle {
  min-width: 154px;
  min-height: 34px;
  padding: 10px 16px;
  background: rgba(2, 6, 23, 0.72);
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.22);
}

.drag-box.title {
  min-width: 126px;
  min-height: 42px;
  padding: 13px 16px;
  background: linear-gradient(135deg, rgba(124, 58, 237, 0.9), rgba(14, 165, 233, 0.78));
  box-shadow: 0 12px 28px rgba(124, 58, 237, 0.28);
}

.drag-box.active {
  border-color: #22d3ee;
  box-shadow:
    0 0 0 3px rgba(34, 211, 238, 0.28),
    0 12px 28px rgba(14, 165, 233, 0.22);
}

.subtitle-preview-line {
  display: inline-block;
}

.subtitle-preview-line b {
  font-weight: 900;
  font-size: 1.12em;
}

.controls {
  display: grid;
  align-content: start;
  gap: 14px;
  border: 1px solid rgba(226, 232, 240, 0.95);
  border-radius: 18px;
  padding: 14px;
  background: rgba(255, 255, 255, 0.96);
  box-shadow: 0 16px 35px rgba(15, 23, 42, 0.06);
}

.controls section {
  display: grid;
  gap: 11px;
  min-width: 0;
}

.tab-row {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}

.tab-row button {
  height: 32px;
  border: 1px solid #dbe2f1;
  border-radius: 10px;
  color: #334155;
  font-size: 12px;
  font-weight: 800;
  background: #fff;
  cursor: pointer;
}

.tab-row button.active {
  border-color: rgba(124, 58, 237, 0.45);
  color: #6d28d9;
  background: #f5f3ff;
}

.controls h4 {
  margin: 0;
  color: #0f172a;
  font-size: 14px;
  font-weight: 900;
}

.field-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.field-grid label {
  display: grid;
  gap: 6px;
}

.field-grid span,
.slider-field span {
  color: #475569;
  font-size: 11px;
  font-weight: 700;
}

.field-grid input,
.field-grid select {
  width: 100%;
  height: 36px;
  border: 1px solid #dbe2f1;
  border-radius: 10px;
  padding: 0 10px;
  color: #0f172a;
  font-size: 12px;
  font-weight: 700;
  background: #fff;
}

.field-grid input[type="color"] {
  height: 34px;
  padding: 3px;
  cursor: pointer;
}

.slider-field {
  display: grid;
  gap: 8px;
}

.slider-field input {
  accent-color: #7c3aed;
}

.row {
  display: flex;
  gap: 8px;
  padding: 3px;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  background: #f8fafc;
}

.row button {
  flex: 1;
  height: 32px;
  border: 0;
  border-radius: 9px;
  padding: 0 10px;
  color: #334155;
  font-size: 12px;
  font-weight: 800;
  background: transparent;
  cursor: pointer;
}

.row button.active {
  color: #6d28d9;
  background: #fff;
  box-shadow: 0 8px 18px rgba(124, 58, 237, 0.12);
}

.aspect-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.aspect-grid button {
  height: 34px;
  border: 1px solid #dbe2f1;
  border-radius: 10px;
  color: #334155;
  font-size: 12px;
  font-weight: 800;
  background: #fff;
  cursor: pointer;
}

.aspect-grid button.active {
  border-color: rgba(124, 58, 237, 0.45);
  color: #6d28d9;
  background: #f5f3ff;
}

.arrow-pad {
  display: grid;
  justify-items: center;
  gap: 6px;
}

.arrow-pad__middle {
  display: flex;
  gap: 8px;
}

.arrow-pad button {
  width: 36px;
  height: 32px;
  border: 1px solid #dbe2f1;
  border-radius: 10px;
  color: #334155;
  background: #fff;
  font-weight: 800;
  cursor: pointer;
  transition:
    border-color 0.16s ease,
    color 0.16s ease,
    transform 0.16s ease;
}

.arrow-pad button:hover {
  border-color: rgba(124, 58, 237, 0.42);
  color: #6d28d9;
  transform: translateY(-1px);
}

.footer-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.footer-actions .ghost {
  height: 32px;
  border: 1px solid #dbe2f1;
  border-radius: 10px;
  padding: 0 12px;
  color: #334155;
  font-size: 12px;
  font-weight: 800;
  background: #fff;
  cursor: pointer;
}

.footer-actions .ghost:hover {
  border-color: rgba(124, 58, 237, 0.42);
  color: #6d28d9;
}

@media (max-width: 980px) {
  .visual-editor {
    padding: 12px;
  }

  .visual-editor__header {
    display: grid;
  }

  .visual-editor__body {
    grid-template-columns: 1fr;
  }

  .visual-editor__actions {
    justify-content: flex-end;
  }

  .preview-canvas {
    width: min(330px, 100%);
  }
}
</style>
