<template>
  <section class="step-three-smart-edit">
    <div class="smart-edit-shell">
      <div class="left-column">
        <h1>第三步：智能剪辑</h1>

        <SubtitleStyleCard
          :cover-url="subtitleTemplateCoverUrl"
          :template-name="subtitleTemplateLabel"
          :title-lines="titleLines"
          @update:title-lines="$emit('update:titleLines', $event)"
          @change-template="openTemplatePicker"
          @shuffle="$emit('shuffle-title')"
        />

        <CutBreathPanel
          :enabled="cutBreathEnabled"
          :mode="cutMode"
          :summary="cutSummary"
          @update:enabled="$emit('update:cutBreathEnabled', $event)"
          @update:mode="$emit('update:cutMode', $event)"
        />

        <StoryboardMaterialPanel
          :enabled="pipEnabled"
          :thumbnail-url="storyboardThumbnailUrl"
          @update:enabled="$emit('update:pipEnabled', $event)"
          @configure="$emit('configure-storyboard')"
        />

        <BackgroundMusicPanel
          :enabled="backgroundMusicEnabled"
          :music-id="backgroundMusicId"
          :volume="backgroundMusicVolume"
          @update:enabled="$emit('update:backgroundMusicEnabled', $event)"
          @update:music-id="$emit('update:backgroundMusicId', $event)"
          @update:volume="$emit('update:backgroundMusicVolume', $event)"
          @upload="$emit('upload-music')"
        />
      </div>

      <SubtitleEditorPanel
        class="center-column"
        :subtitles="subtitles"
        :enabled="textSubtitlesEnabled"
        :rendering="rendering"
        :render-disabled-reason="renderDisabledReason"
        :script-text="scriptText"
        :highlights="highlights"
        :highlight-color="selectedTemplateStyle.highlightColor"
        :title-mark-config="titleMarkConfig"
        @update:enabled="$emit('update:textSubtitlesEnabled', $event)"
        @update:subtitles="$emit('update:subtitles', $event)"
        @update:script-text="$emit('update:scriptText', $event)"
        @update:highlights="$emit('update:highlights', $event)"
        @toggle-highlight="$emit('toggle-subtitle-highlight', $event)"
        @update:title-mark-config="$emit('update:titleMarkConfig', $event)"
        @mark-title="$emit('mark-title', $event)"
        @clear="$emit('clear-subtitles')"
        @pull="$emit('pull-subtitles')"
        @restore="$emit('restore-subtitles')"
        @confirm="$emit('confirm-subtitles')"
        @render="$emit('render')"
        @warn="$emit('warn', $event)"
      />

      <ResultPreviewPanel
        class="right-column"
        :final-video-url="finalVideoUrl"
        :cover-url="avatarCoverUrl || subtitleTemplateCoverUrl"
        :hint="resultHint"
        @delete-video="$emit('delete-video')"
        @change-video="$emit('change-video')"
        @refresh-video="$emit('refresh-video')"
      />
    </div>

    <n-modal
      v-model:show="templatePickerOpen"
      preset="card"
      title="选择字幕模板"
      class="template-picker-modal"
    >
      <div class="template-picker-shell">
        <section class="template-strip" aria-label="字幕模板">
          <div class="template-strip__head">
            <div>
              <strong>公版模板</strong>
              <span>可预览、可复制，公版不允许直接修改</span>
            </div>
            <span class="template-strip__count">{{ publicTemplates.length }} 套</span>
          </div>
          <div class="template-picker-list">
            <button
              v-for="template in publicTemplates"
              :key="template.id"
              type="button"
              class="template-picker-item template-picker-item--hoverable"
              :class="{ 'template-picker-item--active': selectedSubtitleTemplateId === template.id }"
              @click="pickTemplate(template.id)"
            >
              <div
                class="template-card-preview"
                :style="{
                  '--normal-color': templateStyle(template).normalColor,
                  '--highlight-color': templateStyle(template).highlightColor,
                  '--stroke-color': templateStyle(template).strokeColor,
                  '--shadow-color': templateStyle(template).shadowColor,
                }"
              >
                <img
                  v-if="templateThumbnailUrl(template)"
                  class="template-card-preview__image"
                  :src="templateThumbnailUrl(template)"
                  :alt="template.name"
                  loading="lazy"
                  decoding="async"
                  referrerpolicy="no-referrer"
                  @error="markTemplateThumbnailFailed(template.id)"
                />
                <span class="template-card-preview__badge">公版</span>
                <span class="preview-line preview-line--normal">普通字幕</span>
                <span class="preview-line preview-line--highlight">高亮字幕</span>
              </div>

              <div class="template-picker-item__head">
                <strong>{{ template.name }}</strong>
                <span>{{ template.aspectRatio || "9:16" }}</span>
              </div>

              <div class="template-picker-colors">
                <span class="template-picker-swatch" :style="{ background: templateStyle(template).normalColor }" title="普通字幕颜色" />
                <span class="template-picker-swatch" :style="{ background: templateStyle(template).highlightColor }" title="高亮字幕颜色" />
              </div>

              <div class="template-picker-item__actions">
                <button type="button" @click.stop="previewTemplate(template)">预览</button>
                <button type="button" @click.stop="copyTemplate(template)">复制</button>
              </div>
            </button>
            <p v-if="!publicTemplates.length" class="template-picker-empty">暂无公版模板</p>
          </div>
        </section>

        <section class="template-strip" aria-label="我的模板">
          <div class="template-strip__head">
            <div>
              <strong>我的模板</strong>
              <span>复制后可编辑：封面、标题、字幕、画幅</span>
            </div>
            <span class="template-strip__count">{{ userTemplates.length }} 套</span>
          </div>
          <div class="template-picker-list">
            <button type="button" class="template-picker-item template-picker-item--create" @click="createTemplate">
              <div class="template-picker-new">＋</div>
              <div class="template-picker-item__head">
                <strong>新建模板</strong>
                <span>从公版复制一份</span>
              </div>
            </button>

            <button
              v-for="template in userTemplates"
              :key="template.id"
              type="button"
              class="template-picker-item template-picker-item--hoverable"
              :class="{ 'template-picker-item--active': selectedSubtitleTemplateId === template.id }"
              @click="pickTemplate(template.id)"
            >
              <div
                class="template-card-preview"
                :style="{
                  '--normal-color': templateStyle(template).normalColor,
                  '--highlight-color': templateStyle(template).highlightColor,
                  '--stroke-color': templateStyle(template).strokeColor,
                  '--shadow-color': templateStyle(template).shadowColor,
                }"
              >
                <img
                  v-if="templateThumbnailUrl(template)"
                  class="template-card-preview__image"
                  :src="templateThumbnailUrl(template)"
                  :alt="template.name"
                  loading="lazy"
                  decoding="async"
                  referrerpolicy="no-referrer"
                  @error="markTemplateThumbnailFailed(template.id)"
                />
                <span class="template-card-preview__badge">我的</span>
                <span class="preview-line preview-line--normal">普通字幕</span>
                <span class="preview-line preview-line--highlight">高亮字幕</span>
              </div>

              <div class="template-picker-item__head">
                <strong>{{ template.name }}</strong>
                <span>{{ template.aspectRatio || "9:16" }}</span>
              </div>

              <div class="template-picker-colors">
                <span class="template-picker-swatch" :style="{ background: templateStyle(template).normalColor }" title="普通字幕颜色" />
                <span class="template-picker-swatch" :style="{ background: templateStyle(template).highlightColor }" title="高亮字幕颜色" />
              </div>

              <div class="template-picker-item__actions">
                <button type="button" @click.stop="previewTemplate(template)">预览</button>
                <button type="button" @click.stop="editTemplate(template)">编辑</button>
              </div>
            </button>
          </div>
        </section>
      </div>
    </n-modal>

    <n-modal
      v-model:show="templatePreviewOpen"
      preset="card"
      title="模板预览"
      class="template-preview-modal"
    >
      <div v-if="previewingTemplate" class="template-preview-box">
        <div
          class="template-card-preview template-card-preview--large"
          :style="{
            '--normal-color': templateStyle(previewingTemplate).normalColor,
            '--highlight-color': templateStyle(previewingTemplate).highlightColor,
            '--stroke-color': templateStyle(previewingTemplate).strokeColor,
            '--shadow-color': templateStyle(previewingTemplate).shadowColor,
          }"
        >
          <img
            v-if="templateThumbnailUrl(previewingTemplate)"
            class="template-card-preview__image"
            :src="templateThumbnailUrl(previewingTemplate)"
            :alt="previewingTemplate.name"
            loading="lazy"
            decoding="async"
            referrerpolicy="no-referrer"
            @error="markTemplateThumbnailFailed(previewingTemplate.id)"
          />
          <span class="template-card-preview__badge">
            {{ isPublicTemplate(previewingTemplate) ? "公版" : "我的" }}
          </span>
          <span class="preview-line preview-line--normal">普通字幕预览</span>
          <span class="preview-line preview-line--highlight">高亮字幕预览</span>
        </div>
        <div class="template-preview-meta">
          <strong>{{ previewingTemplate.name }}</strong>
          <span>画幅：{{ previewingTemplate.aspectRatio || "9:16" }}</span>
          <span>类型：{{ isPublicTemplate(previewingTemplate) ? "公版模板（只读）" : "用户模板（可编辑）" }}</span>
        </div>
        <div class="template-preview-actions">
          <button type="button" @click="closeTemplatePreview">关闭</button>
          <button
            v-if="!isPublicTemplate(previewingTemplate)"
            type="button"
            class="primary"
            @click="editTemplate(previewingTemplate)"
          >
            编辑模板
          </button>
        </div>
      </div>
    </n-modal>

    <n-modal
      v-model:show="templateEditorOpen"
      preset="card"
      title="编辑模板样式"
      class="template-editor-modal"
    >
      <VisualSubtitleLayoutEditor
        v-if="editingTemplate"
        :template-name="editingTemplate.name"
        :subtitle-visual-style="subtitleVisualStyle"
        :title-layout="titleLayout"
        :default-subtitle-visual-style="defaultSubtitleVisualStyle"
        :default-title-layout="defaultTitleLayout"
        :initial-style-config="editingTemplate.styleConfig || undefined"
        :initial-aspect-ratio="editingTemplate.aspectRatio || '9:16'"
        @apply="saveTemplateStyle"
        @cancel="closeTemplateEditor"
        @warn="$emit('warn', $event)"
      />
    </n-modal>

    <CreationFooter
      progress-text="3/4"
      :percentage="75"
      @previous="$emit('previous')"
      @next="$emit('next')"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { NModal } from "naive-ui";
import type {
  SmartClipCutMode,
  SmartClipCutSummary,
  SmartClipSubtitle,
  SubtitleVisualStyle,
  TitleLayout,
} from "@/api/task";
import { resolveSubtitleTemplateStyle } from "@/constants/subtitleColorTemplates";
import type {
  SubtitleTemplateAspectRatio,
  SubtitleTemplateResource,
  SubtitleTemplateStyleConfig,
} from "@/types/resources";
import type { ScriptHighlightRange } from "@/utils/highlightRangeUtils";
import BackgroundMusicPanel from "./BackgroundMusicPanel.vue";
import CreationFooter from "./CreationFooter.vue";
import CutBreathPanel from "./CutBreathPanel.vue";
import ResultPreviewPanel from "./ResultPreviewPanel.vue";
import StoryboardMaterialPanel from "./StoryboardMaterialPanel.vue";
import SubtitleEditorPanel from "./SubtitleEditorPanel.vue";
import SubtitleStyleCard from "./SubtitleStyleCard.vue";
import VisualSubtitleLayoutEditor from "./VisualSubtitleLayoutEditor.vue";

type WorkflowStepStatus = "done" | "active" | "idle";

type WorkflowProgressState = {
  percent: number;
  doneCount: number;
  activeIndex: number;
  status: string;
  hint: string;
};

type WorkflowProgressStep = {
  label: string;
  status: WorkflowStepStatus;
};

type TitleMarkConfig = {
  templateId: string;
  themeId: string;
  position: "center" | "top" | "bottom";
  duration: number;
};

type TitleAssetStatus = "idle" | "pending" | "processing" | "success" | "failed";

type TitleAssetItem = {
  markId: string;
  text: string;
  templateId: string;
  themeId: string;
  startTime: number;
  endTime: number;
  status: TitleAssetStatus;
  previewUrl?: string;
  errorMessage?: string;
};

const props = defineProps<{
  subtitleTemplateCoverUrl?: string;
  subtitleTemplateLabel?: string;
  avatarCoverUrl?: string;
  storyboardThumbnailUrl?: string;
  titleLines: string[];
  cutBreathEnabled: boolean;
  cutMode: SmartClipCutMode;
  cutSummary?: SmartClipCutSummary | null;
  pipEnabled: boolean;
  backgroundMusicEnabled: boolean;
  backgroundMusicId: string;
  backgroundMusicVolume: number;
  subtitles: SmartClipSubtitle[];
  scriptText: string;
  highlights: ScriptHighlightRange[];
  subtitleTemplates: SubtitleTemplateResource[];
  selectedSubtitleTemplateId: string;
  textSubtitlesEnabled: boolean;
  rendering: boolean;
  finalVideoUrl?: string | null;
  resultHint?: string;
  workflowProgressState: WorkflowProgressState;
  workflowProgressSteps: WorkflowProgressStep[];
  renderDisabledReason?: string;
  titleMarkConfig: TitleMarkConfig;
  includeTitleAssets: boolean;
  subtitleVisualStyle: SubtitleVisualStyle;
  titleLayout: TitleLayout;
  defaultSubtitleVisualStyle: SubtitleVisualStyle;
  defaultTitleLayout: TitleLayout;
  titleAssets: TitleAssetItem[];
}>();

const emit = defineEmits<{
  (event: "update:titleLines", value: string[]): void;
  (event: "update:cutBreathEnabled", value: boolean): void;
  (event: "update:cutMode", value: SmartClipCutMode): void;
  (event: "update:pipEnabled", value: boolean): void;
  (event: "update:backgroundMusicEnabled", value: boolean): void;
  (event: "update:backgroundMusicId", value: string): void;
  (event: "update:backgroundMusicVolume", value: number): void;
  (event: "update:subtitles", value: SmartClipSubtitle[]): void;
  (event: "update:textSubtitlesEnabled", value: boolean): void;
  (event: "update:scriptText", value: string): void;
  (event: "update:highlights", value: ScriptHighlightRange[]): void;
  (event: "update:selectedSubtitleTemplateId", value: string): void;
  (event: "shuffle-title"): void;
  (event: "configure-storyboard"): void;
  (event: "upload-music"): void;
  (event: "clear-subtitles"): void;
  (event: "pull-subtitles"): void;
  (event: "restore-subtitles"): void;
  (event: "confirm-subtitles"): void;
  (event: "toggle-subtitle-highlight", value: SmartClipSubtitle): void;
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
  (event: "update:titleMarkConfig", value: TitleMarkConfig): void;
  (event: "update:includeTitleAssets", value: boolean): void;
  (event: "update:subtitleVisualStyle", value: SubtitleVisualStyle): void;
  (event: "update:titleLayout", value: TitleLayout): void;
  (
    event: "copy-subtitle-template",
    value: { templateId: string; baseName: string },
  ): void;
  (
    event: "save-subtitle-template-style",
    value: {
      templateId: string;
      aspectRatio: SubtitleTemplateAspectRatio;
      styleConfig: SubtitleTemplateStyleConfig;
      subtitleVisualStyle: SubtitleVisualStyle;
      titleLayout: TitleLayout;
    },
  ): void;
  (event: "retry-title-asset", markId: string): void;
  (event: "remove-title-mark", markId: string): void;
  (event: "render"): void;
  (event: "delete-video"): void;
  (event: "change-video"): void;
  (event: "refresh-video"): void;
  (event: "previous"): void;
  (event: "next"): void;
  (event: "warn", value: string): void;
}>();

const templatePickerOpen = ref(false);
const templatePreviewOpen = ref(false);
const templateEditorOpen = ref(false);
const previewingTemplate = ref<SubtitleTemplateResource | null>(null);
const editingTemplate = ref<SubtitleTemplateResource | null>(null);
const failedTemplateThumbnailIds = ref<Set<string>>(new Set());

const selectedTemplateStyle = computed(() =>
  resolveSubtitleTemplateStyle(
    props.selectedSubtitleTemplateId,
    props.subtitleTemplates.find((item) => item.id === props.selectedSubtitleTemplateId)?.styleJson ?? null,
  ),
);
const publicTemplates = computed(() =>
  props.subtitleTemplates.filter((item) => isPublicTemplate(item)),
);
const userTemplates = computed(() =>
  props.subtitleTemplates.filter((item) => !isPublicTemplate(item)),
);

function openTemplatePicker() {
  templatePickerOpen.value = true;
}

function pickTemplate(templateId: string) {
  emit("update:selectedSubtitleTemplateId", templateId);
}

function templateStyle(template: SubtitleTemplateResource) {
  return resolveSubtitleTemplateStyle(template.id, template.styleJson);
}

function templateThumbnailUrl(template: SubtitleTemplateResource) {
  if (failedTemplateThumbnailIds.value.has(template.id)) return "";
  return (
    template.previewThumbnailUrl?.trim() ||
    template.thumbnailUrl?.trim() ||
    template.coverThumbnailUrl?.trim() ||
    template.coverUrl?.trim() ||
    template.previewCoverUrl?.trim() ||
    ""
  );
}

function markTemplateThumbnailFailed(templateId: string) {
  failedTemplateThumbnailIds.value = new Set([
    ...failedTemplateThumbnailIds.value,
    templateId,
  ]);
}

function isPublicTemplate(template: SubtitleTemplateResource) {
  return (
    template.scope === "public" ||
    template.scope === "recommended" ||
    template.owner === "recommended" ||
    template.recommended === true
  );
}

function previewTemplate(template: SubtitleTemplateResource) {
  previewingTemplate.value = template;
  templatePreviewOpen.value = true;
}

function copyTemplate(template: SubtitleTemplateResource) {
  emit("copy-subtitle-template", {
    templateId: template.id,
    baseName: template.name,
  });
}

function createTemplate() {
  const seed =
    publicTemplates.value.find(
      (item) => item.id === props.selectedSubtitleTemplateId,
    ) ?? publicTemplates.value[0];
  if (!seed) {
    emit("warn", "当前没有可复制的公版模板");
    return;
  }
  copyTemplate(seed);
}

function editTemplate(template: SubtitleTemplateResource) {
  if (isPublicTemplate(template)) return;
  editingTemplate.value = template;
  templateEditorOpen.value = true;
  templatePreviewOpen.value = false;
}

function closeTemplatePreview() {
  templatePreviewOpen.value = false;
  previewingTemplate.value = null;
}

function closeTemplateEditor() {
  templateEditorOpen.value = false;
  editingTemplate.value = null;
}

function saveTemplateStyle(value: {
  aspectRatio: SubtitleTemplateAspectRatio;
  styleConfig: SubtitleTemplateStyleConfig;
  subtitleVisualStyle: SubtitleVisualStyle;
  titleLayout: TitleLayout;
}) {
  if (!editingTemplate.value) {
    emit("warn", "模板上下文丢失，请重新编辑");
    return;
  }
  emit("save-subtitle-template-style", {
    templateId: editingTemplate.value.id,
    aspectRatio: value.aspectRatio,
    styleConfig: value.styleConfig,
    subtitleVisualStyle: value.subtitleVisualStyle,
    titleLayout: value.titleLayout,
  });
  closeTemplateEditor();
}

watch(templatePreviewOpen, (open) => {
  if (!open) previewingTemplate.value = null;
});

watch(templateEditorOpen, (open) => {
  if (!open) editingTemplate.value = null;
});

onBeforeUnmount(() => {
  previewingTemplate.value = null;
  editingTemplate.value = null;
  failedTemplateThumbnailIds.value.clear();
});
</script>

<style scoped>
.step-three-smart-edit {
  --primary: #7c3aed;
  --primary-light: #ede9fe;
  --text-main: #0f172a;
  --text-sub: #64748b;
  --border: #e5e7eb;
  --bg-page: #f8fafc;
  --bg-card: #ffffff;
  --warning: #d97706;
  --danger: #ef4444;
  --page-padding-x: 24px;
  --page-padding-y: 20px;
  --card-radius: 18px;
  --panel-radius: 20px;
  --gap-lg: 18px;
  --gap-md: 14px;
  --gap-sm: 10px;
  --font-title: 26px;
  --font-section-title: 15px;
  --font-body: 13px;
  --font-small: 12px;
  --input-height: 36px;
  --button-height: 36px;
  --button-sm-height: 30px;
  --footer-height: 72px;

  box-sizing: border-box;
  height: calc(100vh - 80px);
  overflow: hidden;
  padding: var(--page-padding-y) var(--page-padding-x)
    calc(var(--footer-height) + var(--page-padding-y));
  background: var(--bg-page);
}

.step-three-smart-edit *,
.step-three-smart-edit *::before,
.step-three-smart-edit *::after {
  box-sizing: border-box;
}

.smart-edit-shell {
  display: grid;
  grid-template-columns: minmax(0, 0.39fr) minmax(0, 0.37fr) minmax(260px, 0.24fr);
  gap: var(--gap-lg);
  width: 100%;
  max-width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  border: 1px solid rgba(226, 232, 240, 0.9);
  border-radius: var(--panel-radius);
  background: var(--bg-card);
  box-shadow: 0 16px 42px rgba(15, 23, 42, 0.055);
}

.left-column {
  display: grid;
  grid-template-rows: auto auto auto auto auto;
  align-content: start;
  gap: var(--gap-lg);
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 24px 0 24px 24px;
}

.left-column::-webkit-scrollbar {
  width: 8px;
}

.left-column::-webkit-scrollbar-thumb {
  border-radius: 999px;
  background: #cbd5e1;
}

.left-column h1 {
  margin: 0 0 4px;
  color: var(--text-main);
  font-size: var(--font-title);
  font-weight: 900;
  letter-spacing: -0.03em;
  line-height: 1.15;
}

.center-column {
  align-self: center;
  height: calc(100% - 48px);
  width: 100%;
  min-width: 0;
  min-height: 0;
}

.right-column {
  width: 100%;
  min-width: 0;
  overflow: hidden;
}

:global(.template-picker-modal) {
  width: min(1180px, calc(100vw - 28px)) !important;
}

:global(.template-picker-modal .n-card) {
  overflow: hidden;
  border-radius: 24px;
  background:
    radial-gradient(circle at 86% 14%, rgba(124, 58, 237, 0.12), transparent 34%),
    linear-gradient(180deg, #ffffff 0%, #f8fbff 100%);
}

:global(.template-picker-modal .n-card-header) {
  padding: 22px 24px 10px;
}

:global(.template-picker-modal .n-card-header__main) {
  color: #0f172a;
  font-size: 18px;
  font-weight: 900;
}

:global(.template-picker-modal .n-card__content) {
  max-height: min(84vh, 860px);
  overflow: auto;
  padding: 0 24px 24px;
}

.template-workbench {
  display: grid;
  gap: 16px;
}

.template-picker-shell {
  display: grid;
  gap: 14px;
}

.template-strip {
  display: grid;
  gap: 12px;
  padding: 14px;
  border: 1px solid rgba(226, 232, 240, 0.92);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.86);
  box-shadow: 0 16px 38px rgba(15, 23, 42, 0.06);
}

.template-strip__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.template-strip__head div {
  display: grid;
  gap: 3px;
}

.template-strip__head strong {
  color: #0f172a;
  font-size: 14px;
  font-weight: 900;
}

.template-strip__head span {
  color: #64748b;
  font-size: 12px;
  font-weight: 700;
}

.template-strip__count {
  flex: 0 0 auto;
  border-radius: 999px;
  padding: 4px 9px;
  color: #6d28d9;
  background: #f3e8ff;
}

.template-picker-list {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: minmax(154px, 176px);
  gap: 12px;
  overflow-x: auto;
  overflow-y: hidden;
  padding: 2px 2px 8px;
  scroll-snap-type: x proximity;
}

.template-picker-list::-webkit-scrollbar {
  height: 8px;
}

.template-picker-list::-webkit-scrollbar-thumb {
  border-radius: 999px;
  background: #cbd5e1;
}

.template-picker-item {
  position: relative;
  display: grid;
  gap: 10px;
  align-content: start;
  width: 100%;
  min-height: 206px;
  padding: 10px;
  border: 1px solid #e2e8f0;
  border-radius: 16px;
  background: #fff;
  cursor: pointer;
  scroll-snap-align: start;
  text-align: left;
  transition:
    border-color 0.18s ease,
    box-shadow 0.18s ease,
    transform 0.18s ease;
}

.template-picker-item:hover {
  border-color: rgba(124, 58, 237, 0.34);
  box-shadow: 0 14px 30px rgba(15, 23, 42, 0.1);
  transform: translateY(-1px);
}

.template-picker-item--active {
  border-color: rgba(124, 58, 237, 0.55);
  box-shadow: 0 0 0 2px rgba(124, 58, 237, 0.14), 0 18px 36px rgba(124, 58, 237, 0.16);
}

.template-picker-item--create {
  display: grid;
  align-content: center;
  justify-items: center;
  min-height: 206px;
  border-style: dashed;
}

.template-picker-new {
  display: inline-flex;
  width: 42px;
  height: 42px;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(124, 58, 237, 0.35);
  border-radius: 999px;
  color: #7c3aed;
  font-size: 24px;
  font-weight: 800;
  background: #f5f3ff;
}

.template-card-preview {
  position: relative;
  display: grid;
  align-content: end;
  gap: 5px;
  aspect-ratio: 9 / 13;
  overflow: hidden;
  border-radius: 14px;
  padding: 12px;
  background:
    radial-gradient(circle at 68% 16%, rgba(255, 255, 255, 0.2), transparent 20%),
    linear-gradient(180deg, #293241 0%, #111827 52%, #020617 100%);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.1);
}

.template-card-preview::before {
  content: "";
  position: absolute;
  z-index: 1;
  inset: 18px 14px;
  border: 1px dashed rgba(226, 232, 240, 0.38);
  border-radius: 11px;
}

.template-card-preview__image {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.template-card-preview::after {
  content: "";
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, rgba(2, 6, 23, 0.04), rgba(2, 6, 23, 0.42));
}

.template-card-preview__badge {
  position: absolute;
  z-index: 2;
  top: 10px;
  left: 10px;
  border-radius: 999px;
  padding: 3px 7px;
  color: #fff;
  font-size: 10px;
  font-weight: 900;
  background: rgba(15, 23, 42, 0.54);
  backdrop-filter: blur(10px);
}

.preview-line {
  position: relative;
  z-index: 2;
  justify-self: center;
  max-width: 100%;
  border-radius: 999px;
  padding: 5px 9px;
  color: var(--normal-color);
  font-size: 12px;
  font-weight: 900;
  line-height: 1;
  text-shadow:
    0 1px 0 var(--stroke-color),
    0 8px 16px var(--shadow-color);
  background: rgba(15, 23, 42, 0.34);
}

.preview-line--highlight {
  color: var(--highlight-color);
}

.template-picker-item__head {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.template-picker-item__head strong {
  color: #0f172a;
  font-size: 14px;
  font-weight: 900;
}

.template-picker-item__head span {
  color: #64748b;
  font-size: 12px;
  font-weight: 700;
}

.template-picker-colors {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}

.template-picker-item__actions {
  position: absolute;
  right: 10px;
  bottom: 10px;
  display: flex;
  gap: 6px;
  opacity: 0;
  pointer-events: none;
  transform: translateY(4px);
  transition: all 0.18s ease;
}

.template-picker-item--hoverable:hover .template-picker-item__actions,
.template-picker-item--active .template-picker-item__actions {
  opacity: 1;
  pointer-events: auto;
  transform: translateY(0);
}

.template-picker-item__actions button {
  height: 24px;
  border: 1px solid rgba(15, 23, 42, 0.2);
  border-radius: 8px;
  padding: 0 8px;
  color: #0f172a;
  font-size: 11px;
  font-weight: 700;
  background: rgba(255, 255, 255, 0.96);
  cursor: pointer;
}

.template-picker-item__actions button:hover {
  border-color: rgba(124, 58, 237, 0.55);
  color: #6d28d9;
}

.template-picker-swatch {
  width: 18px;
  height: 18px;
  border: 1px solid rgba(148, 163, 184, 0.6);
  border-radius: 999px;
}

.template-picker-empty {
  margin: 0;
  align-self: center;
  color: #94a3b8;
  font-size: 13px;
}

.template-card-preview--large {
  min-height: 220px;
}

.template-preview-box {
  display: grid;
  gap: 12px;
}

.template-preview-meta {
  display: grid;
  gap: 4px;
}

.template-preview-meta strong {
  color: #0f172a;
  font-size: 16px;
  font-weight: 800;
}

.template-preview-meta span {
  color: #64748b;
  font-size: 12px;
  font-weight: 600;
}

.template-preview-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.template-preview-actions button {
  height: 32px;
  border: 1px solid #dbe2f1;
  border-radius: 10px;
  padding: 0 12px;
  color: #334155;
  font-size: 12px;
  font-weight: 700;
  background: #fff;
  cursor: pointer;
}

.template-preview-actions button.primary {
  border: 0;
  color: #fff;
  background: linear-gradient(135deg, #7c3aed, #8b5cf6);
}

@media (max-width: 1600px) {
  .step-three-smart-edit {
    --page-padding-x: 20px;
    --page-padding-y: 18px;
    --gap-lg: 16px;
  }

  .smart-edit-shell {
    grid-template-columns: minmax(0, 0.39fr) minmax(0, 0.35fr) minmax(260px, 0.26fr);
  }

  .left-column {
    gap: 16px;
    padding: 22px 0 22px 22px;
  }

  .left-column h1 {
    font-size: 25px;
  }
}

@media (max-width: 1440px) {
  .step-three-smart-edit {
    --page-padding-x: 18px;
    --page-padding-y: 16px;
    --gap-lg: 14px;
    --font-title: 24px;
  }

  .smart-edit-shell {
    grid-template-columns: minmax(0, 0.39fr) minmax(0, 0.34fr) minmax(250px, 0.27fr);
  }

  .left-column {
    padding: 20px 0 20px 20px;
  }
}

@media (max-width: 1240px) {
  .step-three-smart-edit {
    height: auto;
    min-height: calc(100vh - 80px);
    overflow: auto;
  }

  .smart-edit-shell {
    grid-template-columns: 1fr;
    overflow: visible;
  }

  .left-column,
  .center-column,
  .right-column {
    height: auto;
    overflow: visible;
  }

  .left-column {
    padding: 22px;
  }
}

@media (max-width: 980px) {
  :global(.template-picker-modal .n-card__content) {
    padding: 0 14px 16px;
  }

  .template-picker-list {
    grid-auto-columns: minmax(140px, 72vw);
  }
}
</style>
