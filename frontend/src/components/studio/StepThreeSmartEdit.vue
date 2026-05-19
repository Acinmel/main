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
          @change-template="$emit('change-template')"
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
        @update:enabled="$emit('update:textSubtitlesEnabled', $event)"
        @update:subtitles="$emit('update:subtitles', $event)"
        @toggle-highlight="$emit('toggle-highlight', $event)"
        @clear="$emit('clear-subtitles')"
        @pull="$emit('pull-subtitles')"
        @restore="$emit('restore-subtitles')"
        @confirm="$emit('confirm-subtitles')"
        @render="$emit('render')"
      />

      <ResultPreviewPanel
        class="right-column"
        :final-video-url="finalVideoUrl"
        :cover-url="avatarCoverUrl || subtitleTemplateCoverUrl"
        :hint="resultHint"
        @delete-video="$emit('delete-video')"
        @change-video="$emit('change-video')"
      />
    </div>

    <CreationFooter
      progress-text="3/4"
      :percentage="75"
      @previous="$emit('previous')"
      @next="$emit('next')"
    />
  </section>
</template>

<script setup lang="ts">
import type { SmartClipCutMode, SmartClipCutSummary, SmartClipSubtitle } from '@/api/task'
import BackgroundMusicPanel from './BackgroundMusicPanel.vue'
import CreationFooter from './CreationFooter.vue'
import CutBreathPanel from './CutBreathPanel.vue'
import ResultPreviewPanel from './ResultPreviewPanel.vue'
import StoryboardMaterialPanel from './StoryboardMaterialPanel.vue'
import SubtitleEditorPanel from './SubtitleEditorPanel.vue'
import SubtitleStyleCard from './SubtitleStyleCard.vue'

defineProps<{
  subtitleTemplateCoverUrl?: string
  subtitleTemplateLabel?: string
  avatarCoverUrl?: string
  storyboardThumbnailUrl?: string
  titleLines: string[]
  cutBreathEnabled: boolean
  cutMode: SmartClipCutMode
  cutSummary?: SmartClipCutSummary | null
  pipEnabled: boolean
  backgroundMusicEnabled: boolean
  backgroundMusicId: string
  backgroundMusicVolume: number
  subtitles: SmartClipSubtitle[]
  textSubtitlesEnabled: boolean
  rendering: boolean
  finalVideoUrl?: string | null
  resultHint?: string
  renderDisabledReason?: string
}>()

defineEmits<{
  (event: 'update:titleLines', value: string[]): void
  (event: 'update:cutBreathEnabled', value: boolean): void
  (event: 'update:cutMode', value: SmartClipCutMode): void
  (event: 'update:pipEnabled', value: boolean): void
  (event: 'update:backgroundMusicEnabled', value: boolean): void
  (event: 'update:backgroundMusicId', value: string): void
  (event: 'update:backgroundMusicVolume', value: number): void
  (event: 'update:textSubtitlesEnabled', value: boolean): void
  (event: 'update:subtitles', value: SmartClipSubtitle[]): void
  (event: 'toggle-highlight', value: SmartClipSubtitle): void
  (event: 'change-template'): void
  (event: 'shuffle-title'): void
  (event: 'configure-storyboard'): void
  (event: 'upload-music'): void
  (event: 'clear-subtitles'): void
  (event: 'pull-subtitles'): void
  (event: 'restore-subtitles'): void
  (event: 'confirm-subtitles'): void
  (event: 'render'): void
  (event: 'delete-video'): void
  (event: 'change-video'): void
  (event: 'previous'): void
  (event: 'next'): void
}>()
</script>

<style scoped>
.step-three-smart-edit {
  --primary: #7C3AED;
  --primary-light: #EDE9FE;
  --text-main: #0F172A;
  --text-sub: #64748B;
  --border: #E5E7EB;
  --bg-page: #F8FAFC;
  --bg-card: #FFFFFF;
  --warning: #D97706;
  --danger: #EF4444;
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
  background: #CBD5E1;
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
</style>
