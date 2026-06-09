<template>
  <div class="highlight-editor-shell">
    <div
      ref="editorRef"
      class="highlight-editor"
      contenteditable="true"
      spellcheck="false"
      @input="onInput"
      @mouseup="onSelectionChange"
      @keyup="onSelectionChange"
      @blur="onBlur"
    />
  </div>

  <Teleport to="body">
    <div
      v-if="toolbarVisible"
      class="highlight-toolbar"
      :style="{ left: `${toolbarX}px`, top: `${toolbarY}px` }"
      @mousedown.prevent.stop
      @click.stop
    >
      <button type="button" @mousedown.prevent.stop @click.stop="onApplyHighlight">
        高亮
      </button>
      <button
        type="button"
        class="ghost"
        @mousedown.prevent.stop
        @click.stop="onRemoveHighlight"
      >
        取消高亮
      </button>
      <button
        type="button"
        class="title"
        @mousedown.prevent.stop
        @click.stop="onMarkTitle"
      >
        标题
      </button>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import type {
  HighlightStyle,
  ScriptHighlightRange,
} from "@/utils/highlightRangeUtils";
import {
  applyHighlightRange,
  remapHighlightsForTextChange,
  removeHighlightRange,
  splitTextByHighlights,
} from "@/utils/highlightRangeUtils";

const props = defineProps<{
  modelValue: string;
  highlights: ScriptHighlightRange[];
  highlightStyle: HighlightStyle;
}>();

const EDITOR_HIGHLIGHT_COLOR = "#6d28d9";
const EDITOR_HIGHLIGHT_FONT_WEIGHT = "900";

const emit = defineEmits<{
  (event: "update:modelValue", value: string): void;
  (event: "update:highlights", value: ScriptHighlightRange[]): void;
  (
    event: "mark-title",
    value: { start: number; end: number; text: string },
  ): void;
  (event: "warn", value: string): void;
}>();

const editorRef = ref<HTMLElement | null>(null);
const toolbarVisible = ref(false);
const toolbarX = ref(0);
const toolbarY = ref(0);
const currentSelection = ref<{ start: number; end: number } | null>(null);
let rendering = false;

function normalizeEditorText(text: string) {
  return text.replace(/\r/g, "").replace(/\u00a0/g, " ");
}

function resolveNodePosition(root: Node, offset: number) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let traversed = 0;
  let node = walker.nextNode();
  while (node) {
    const nodeTextLength = node.textContent?.length ?? 0;
    if (offset <= traversed + nodeTextLength) {
      return { node, offset: offset - traversed };
    }
    traversed += nodeTextLength;
    node = walker.nextNode();
  }
  return null;
}

function restoreSelection(range: { start: number; end: number }) {
  const root = editorRef.value;
  if (!root) return;
  const selection = window.getSelection();
  if (!selection) return;

  const startPos = resolveNodePosition(root, range.start);
  const endPos = resolveNodePosition(root, range.end);
  if (!startPos || !endPos) return;

  const next = document.createRange();
  next.setStart(startPos.node, startPos.offset);
  next.setEnd(endPos.node, endPos.offset);
  selection.removeAllRanges();
  selection.addRange(next);
}

function focusRange(start: number, end: number) {
  const safeStart = Math.max(0, Math.min(props.modelValue.length, start));
  const safeEnd = Math.max(safeStart, Math.min(props.modelValue.length, end));
  restoreSelection({ start: safeStart, end: safeEnd });
  editorRef.value?.focus();
}

function renderEditorContent(restore?: { start: number; end: number } | null) {
  const root = editorRef.value;
  if (!root) return;
  rendering = true;

  root.innerHTML = "";
  const pieces = splitTextByHighlights(props.modelValue, props.highlights);
  for (const piece of pieces) {
    if (!piece.text.length) continue;
    const textNode = document.createTextNode(piece.text);
    if (piece.highlight) {
      const span = document.createElement("span");
      span.className = "hl";
      span.style.color = EDITOR_HIGHLIGHT_COLOR;
      span.style.fontWeight = EDITOR_HIGHLIGHT_FONT_WEIGHT;
      span.appendChild(textNode);
      root.appendChild(span);
    } else {
      root.appendChild(textNode);
    }
  }

  if (!root.textContent?.length) {
    root.appendChild(document.createTextNode(""));
  }

  rendering = false;
  if (restore) {
    restoreSelection(restore);
  }
}

function selectionRangeFromEditor() {
  const root = editorRef.value;
  const selection = window.getSelection();
  if (!root || !selection || selection.rangeCount < 1) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return null;

  const preStart = range.cloneRange();
  preStart.selectNodeContents(root);
  preStart.setEnd(range.startContainer, range.startOffset);
  const start = preStart.toString().length;

  const preEnd = range.cloneRange();
  preEnd.selectNodeContents(root);
  preEnd.setEnd(range.endContainer, range.endOffset);
  const end = preEnd.toString().length;
  return { start, end, domRange: range };
}

function hideToolbar() {
  toolbarVisible.value = false;
}

function onSelectionChange() {
  nextTick(() => {
    const selected = selectionRangeFromEditor();
    if (!selected) {
      currentSelection.value = null;
      hideToolbar();
      return;
    }
    if (selected.end <= selected.start) {
      currentSelection.value = null;
      hideToolbar();
      return;
    }
    const rect = selected.domRange.getBoundingClientRect();
    if (!rect.width) {
      currentSelection.value = null;
      hideToolbar();
      return;
    }

    currentSelection.value = { start: selected.start, end: selected.end };
    const idealX = rect.left + rect.width / 2;
    const minX = 72;
    const maxX = window.innerWidth - 72;
    toolbarX.value = Math.max(minX, Math.min(maxX, idealX));
    toolbarY.value = Math.max(12, rect.top - 44);
    toolbarVisible.value = true;
  });
}

function onBlur() {
  window.setTimeout(() => hideToolbar(), 120);
}

function onInput() {
  if (rendering) return;
  const root = editorRef.value;
  if (!root) return;
  const prevText = props.modelValue;
  const nextText = normalizeEditorText(root.innerText);
  const nextHighlights = remapHighlightsForTextChange(
    prevText,
    nextText,
    props.highlights,
  );
  emit("update:modelValue", nextText);
  emit("update:highlights", nextHighlights);
}

function onApplyHighlight() {
  const selection = currentSelection.value;
  if (!selection) {
    emit("warn", "请先选中文字");
    return;
  }
  const text = props.modelValue.slice(selection.start, selection.end);
  if (!text.trim()) {
    emit("warn", "选区为空或仅包含空格，不能高亮");
    return;
  }
  const next = applyHighlightRange(
    props.modelValue,
    props.highlights,
    selection,
    props.highlightStyle,
  );
  emit("update:highlights", next);
  hideToolbar();
}

function onRemoveHighlight() {
  const selection = currentSelection.value;
  if (!selection) {
    emit("warn", "请先选中文字");
    return;
  }
  const next = removeHighlightRange(props.modelValue, props.highlights, selection);
  emit("update:highlights", next);
  hideToolbar();
}

function onMarkTitle() {
  const selection = currentSelection.value;
  if (!selection) {
    emit("warn", "请先选中文字");
    return;
  }
  const text = props.modelValue.slice(selection.start, selection.end);
  if (!text.trim()) {
    emit("warn", "标题选区不能为空");
    return;
  }
  emit("mark-title", {
    start: selection.start,
    end: selection.end,
    text,
  });
  hideToolbar();
}

watch(
  () => props.modelValue,
  () => {
    const selection = selectionRangeFromEditor();
    renderEditorContent(
      selection ? { start: selection.start, end: selection.end } : null,
    );
  },
);

watch(
  () => props.highlights,
  () => {
    const selection = selectionRangeFromEditor();
    renderEditorContent(
      selection ? { start: selection.start, end: selection.end } : null,
    );
  },
  { deep: true },
);

onMounted(() => {
  renderEditorContent(null);
  window.addEventListener("scroll", hideToolbar, true);
  window.addEventListener("resize", hideToolbar);
});

onUnmounted(() => {
  window.removeEventListener("scroll", hideToolbar, true);
  window.removeEventListener("resize", hideToolbar);
});

defineExpose({
  focusRange,
});
</script>

<style scoped>
.highlight-editor-shell {
  position: relative;
  min-height: 240px;
  border: 1px solid #dbe2f1;
  border-radius: 12px;
  background: #fff;
  overflow: hidden;
}

.highlight-editor {
  min-height: 240px;
  max-height: 320px;
  padding: 14px 15px;
  color: #0f172a;
  font-size: 14px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
  overflow: auto;
  outline: none;
}

.highlight-editor:empty::before {
  content: "在这里编辑文案，选中文字后可设置高亮";
  color: #94a3b8;
}

.highlight-editor :deep(.hl) {
  display: inline;
  padding: 0 1px;
  border-radius: 3px;
  text-decoration: underline;
  text-decoration-color: currentColor;
  background: rgba(15, 23, 42, 0.06);
}

.highlight-toolbar {
  position: fixed;
  z-index: 100000;
  display: flex;
  align-items: center;
  gap: 6px;
  transform: translateX(-50%);
  padding: 6px;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  background: #fff;
  box-shadow: 0 10px 24px rgba(15, 23, 42, 0.18);
  pointer-events: auto;
}

.highlight-toolbar button {
  height: 28px;
  border: 1px solid #7c3aed;
  border-radius: 8px;
  padding: 0 10px;
  color: #7c3aed;
  font-size: 12px;
  font-weight: 700;
  background: #fff;
  cursor: pointer;
}

.highlight-toolbar button.ghost {
  border-color: #dbe2f1;
  color: #475569;
}

.highlight-toolbar button.title {
  border-color: #22c55e;
  color: #166534;
  background: #f0fdf4;
}
</style>
