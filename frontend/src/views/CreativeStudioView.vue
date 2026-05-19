<script setup lang="ts">
import {
  NAlert,
  NButton,
  NInput,
  NProgress,
  NSelect,
  NSlider,
  NSpace,
  NTag,
  NText,
  useMessage,
} from "naive-ui";
import {
  computed,
  defineAsyncComponent,
  nextTick,
  onMounted,
  onUnmounted,
  ref,
  watch,
} from "vue";
import { useRoute, useRouter } from "vue-router";
import axios from "axios";
import VideoLinkInput from "@/components/home/VideoLinkInput.vue";
import {
  avatarVideoStreamUrl,
  cloneVoiceResource,
  cloneVoiceResourceUpload,
  createAvatarResource,
  listAvatarResources,
  listSubtitleTemplateResources,
  listVoiceResources,
  uploadAvatarResource,
} from "@/api/resources";
import {
  createSubtitleWorkflowPreview,
  createVoicePreview,
  detectSmartClipCutPoints,
  downloadSourceVideoFile,
  fetchVideoMeta,
  getSmartClipRenderTask,
  getDyDownloaderCookieConfigured,
  getVoicePreviewTaskStatus,
  listRecentExtractions,
  optimizeOralScript,
  saveRecentExtraction,
  getTranscribePipelineHealth,
  learnDouyinHomepage,
  finalizeSubtitleWorkflow,
  renderSmartClipFinal,
  transcribeSavedVideo,
  transcribeFromUrl,
} from "@/api/task";
import type {
  DouyinHomepageLearnedPost,
  DouyinHomepageLearnedProfile,
  SmartClipCutConfig,
  SmartClipCutMode,
  SmartClipCutPoint,
  SmartClipCutSummary,
  RecentExtractionRecord,
  SmartClipRenderTask,
  SmartClipSubtitle,
} from "@/api/task";
import { useSingleAudioPlayer } from "@/composables/useSingleAudioPlayer";
import { useTranscriptDraftStream } from "@/composables/useTranscriptDraftStream";
import { useTaskDraftStore } from "@/stores/taskDraft";
import { useUserStore } from "@/stores/user";
import type {
  AvatarResource,
  CreateAvatarResourceDraft,
  CreateVoiceResourceDraft,
  SubtitleTemplateResource,
  VoiceResource,
} from "@/types/resources";
import type { VideoMetaPreview } from "@/types/domain";
import {
  isDouyinNormalizedUrl,
  validateSourceVideoInput,
} from "@/utils/douyinShareUrl";
import { formatStatCount } from "@/utils/formatDisplay";
import {
  describeHttpOrNetworkError,
  describeHttpOrNetworkErrorMaybeBlob,
} from "@/utils/httpErrorMessage";

const StepThreeSmartEdit = defineAsyncComponent(
  () => import("@/components/studio/StepThreeSmartEdit.vue"),
);
const NewAvatarModal = defineAsyncComponent(
  () => import("@/components/resources/NewAvatarModal.vue"),
);
const VoiceCloneModal = defineAsyncComponent(
  () => import("@/components/resources/VoiceCloneModal.vue"),
);

type CreationStep = {
  no: number;
  title: string;
  desc: string;
};

type SelectOption = { label: string; value: string };
type StudioSourceMode = "homepage" | "hotlink";
type VoiceSourceMode = "tts" | "local";
type RenderModelChoice = "new" | "classic";
type RenderResolutionChoice = "1080p" | "2k";
type VoiceGenerationState = {
  ready: boolean;
  reason: string;
};

const hiddenRecommendedVoiceIds = new Set([
  "rec-voice-female",
  "rec-voice-male",
  "rec-voice-narration",
  "rec-voice-bright-young-female",
]);

const smartClipCutConfigs: Record<SmartClipCutMode, SmartClipCutConfig> = {
  light: {
    silenceThreshold: -35,
    minSilenceDuration: 0.5,
    keepPause: 0.25,
  },
  standard: {
    silenceThreshold: -35,
    minSilenceDuration: 0.35,
    keepPause: 0.18,
  },
  strong: {
    silenceThreshold: -32,
    minSilenceDuration: 0.25,
    keepPause: 0.08,
  },
};

const smartClipCutModeOptions: Array<{
  value: SmartClipCutMode;
  label: string;
  desc: string;
}> = [
  { value: "light", label: "轻度", desc: "保留自然停顿，适合知识讲解" },
  { value: "standard", label: "标准", desc: "压缩明显空白，适合短视频口播" },
  { value: "strong", label: "强力", desc: "节奏更快，适合带货和营销视频" },
];

const voiceLanguageOptions = [
  { label: "汉语-简体", value: "zh-CN" },
  { label: "汉语-粤语", value: "zh-HK" },
  { label: "英文", value: "en-US" },
];

const voiceEmotionOptions = [
  { label: "自然", value: "自然" },
  { label: "轻快", value: "轻快" },
  { label: "讲解", value: "讲解" },
  { label: "激励", value: "激励" },
];

type OralScriptPolishState = {
  hook3s: string;
  hook10s: string;
  optimizedScript: string;
  strategyId: string;
  strategyLabel: string;
  llmUsed: boolean;
};

const steps: CreationStep[] = [
  { no: 1, title: "搞定文案", desc: "抓链接、转文案、手动润稿" },
  { no: 2, title: "配音 & 数字人", desc: "挑选音色与出镜视频" },
  { no: 3, title: "一键成片", desc: "整段生成对口型视频" },
  { no: 4, title: "自动发布", desc: "预留发布账号与计划" },
];

const publishPlatforms = [
  { name: "抖音", icon: "抖", account: "0 个账号" },
  { name: "视频号", icon: "视", account: "0 个账号" },
  { name: "小红书", icon: "红", account: "0 个账号" },
  { name: "快手", icon: "快", account: "0 个账号" },
];

const apiBasePath = (() => {
  const raw =
    typeof import.meta.env.VITE_API_BASE_URL === "string" &&
    import.meta.env.VITE_API_BASE_URL.length > 0
      ? import.meta.env.VITE_API_BASE_URL
      : "/api";
  return raw.endsWith("/") ? raw.slice(0, -1) : raw;
})();

const message = useMessage();
const route = useRoute();
const router = useRouter();
const draft = useTaskDraftStore();
const user = useUserStore();
const { playingId: audioPlayingId, toggle: toggleAudioPlayback } =
  useSingleAudioPlayer();
const {
  applyTranscriptToEditableScript,
  cancelStream,
  interruptStreamWithFullText,
  isStreamingToScript,
} = useTranscriptDraftStream();

const activeStep = ref(1);
const sourceMode = ref<StudioSourceMode>("homepage");
const publishCopy = ref("");
const publishCopyTouched = ref(false);
const benchmarkHomepageUrl = ref("");
const benchmarkLearning = ref(false);
const benchmarkLearningHint = ref("");
const benchmarkProfile = ref<DouyinHomepageLearnedProfile | null>(null);
const benchmarkSamples = ref<DouyinHomepageLearnedPost[]>([]);
const benchmarkIdeaSuggestions = ref<string[]>([]);

const loadingMeta = ref(false);
const recentExtractionRecords = ref<RecentExtractionRecord[]>([]);
const recentExtractionLoading = ref(false);
const douyinPipeline = ref(false);
const pipelinePhase = ref<"idle" | "download" | "transcribe">("idle");
const pipelineProgress = ref(0);
const pipelineBarProcessing = ref(false);
const transcribeUrlLoading = ref(false);
const retranscribingLocal = ref(false);
const optimizingOralScript = ref(false);
const oralScriptPolish = ref<OralScriptPolishState | null>(null);
const lastSavedVideoBasename = ref<string | null>(null);
const dyCookieConfigured = ref<boolean | null>(null);
const pipelineHealthError = ref("");

const renderResourceLoading = ref(false);
const createAvatarOpen = ref(false);
const creatingAvatar = ref(false);
const cloneVoiceOpen = ref(false);
const cloningVoice = ref(false);
const avatarResourceItems = ref<AvatarResource[]>([]);
const voiceResourceItems = ref<VoiceResource[]>([]);
const avatarOptions = ref<SelectOption[]>([]);
const voiceOptions = ref<SelectOption[]>([]);
const subtitleTemplateOptions = ref<SelectOption[]>([]);
const subtitleTemplateItems = ref<SubtitleTemplateResource[]>([]);
const selectedAvatarId = ref("");
const selectedAvatarIds = ref<string[]>([]);
const selectedVoiceId = ref("");
const selectedSubtitleTemplateId = ref("");
const voiceSourceMode = ref<VoiceSourceMode>("tts");
const selectedVoiceLanguage = ref("zh-CN");
const selectedVoiceEmotion = ref("自然");
const selectedVoicePower = ref(1.03);
const selectedVoiceRate = ref(1);
const selectedVoiceVolume = ref(1);
const renderModelChoice = ref<RenderModelChoice>("new");
const renderResolutionChoice = ref<RenderResolutionChoice>("1080p");
const voicePreviewLoading = ref(false);
const voicePreviewUrl = ref<string | null>(null);
const voicePreviewHint = ref("");
const voicePreviewMode = ref<"provider" | "mock" | "">("");
const voicePreviewDurationSeconds = ref(0);
const voicePreviewProgress = ref(0);
const voicePreviewProgressLabel = ref("准备生成音频");
const voicePreviewTaskId = ref("");
const voicePreviewTaskStatus = ref<
  | "idle"
  | "submitted"
  | "queued"
  | "running"
  | "saving"
  | "ready"
  | "failed"
  | "timeout"
>("idle");
const voicePreviewError = ref("");
let voicePreviewProgressTimer: number | null = null;
let voicePreviewPollTimer: number | null = null;
let voicePreviewRequestSeq = 0;
const voiceShellRef = ref<HTMLElement | null>(null);
const requestedAvatarUnavailable = ref(false);
const consumedRouteAvatarId = ref("");
const generatedPreviewObjectUrls = ref<string[]>([]);
const subtitleWorkflowPreviewLoading = ref(false);
const subtitleWorkflowFinalizeLoading = ref(false);
const subtitleWorkflowDraftId = ref("");
const subtitleWorkflowPreviewUrl = ref<string | null>(null);
const subtitleWorkflowFinalUrl = ref<string | null>(null);
const subtitleWorkflowHint = ref("");
const subtitleWorkflowTimelineSource = ref<
  "asr-fallback" | "local-estimate" | ""
>("");
const subtitleWorkflowJson = ref<{
  version: 1;
  language: string;
  durationMs: number;
  generatedAt: string;
  source: {
    script: string;
    avatarResourceId: string;
    voiceResourceId: string;
    subtitleTemplateId: string;
  };
  template: {
    id: string;
    name: string;
    styleJson: Record<string, unknown>;
  };
  cues: Array<{
    id: string;
    startMs: number;
    endMs: number;
    text: string;
    lines: string[];
  }>;
} | null>(null);
const smartClipCutBreathEnabled = ref(true);
const smartClipCutMode = ref<SmartClipCutMode>("standard");
const smartClipCutDetecting = ref(false);
const smartClipCutApplied = ref(false);
const smartClipCutPoints = ref<SmartClipCutPoint[]>([]);
const smartClipCutSummary = ref<SmartClipCutSummary>({
  totalCount: 0,
  totalCutDuration: 0,
  originalDuration: 0,
  estimatedDuration: 0,
});
const smartClipSubtitles = ref<SmartClipSubtitle[]>([]);
const smartClipBackgroundMusicEnabled = ref(false);
const smartClipBackgroundMusicId = ref("cozy_vibes");
const smartClipBackgroundMusicVolume = ref(0.1);
const smartClipPipEnabled = ref(false);
const smartClipTextSubtitlesEnabled = ref(true);
const smartClipRenderTask = ref<SmartClipRenderTask | null>(null);
const smartClipRendering = ref(false);
const smartClipTitleLines = ref(["7步让AI写出爆款", "直播话术!"]);
const smartClipSubtitleSourceText = ref("");
let smartClipPollTimer: number | null = null;
const avatarCoverVideoUrls = ref<Record<string, string>>({});
const pendingAvatarCoverIds = new Set<string>();

const urlInvalid = computed(() => {
  if (!draft.videoUrl?.trim()) return false;
  return !validateSourceVideoInput(draft.videoUrl).ok;
});

const linkReady = computed(() => validateSourceVideoInput(draft.videoUrl).ok);
const canTranscribeNonDouyinUrl = computed(
  () => linkReady.value && !isDouyinNormalizedUrl(draft.videoUrl),
);
const hasAvatarOptions = computed(() => avatarOptions.value.length > 0);
const hasVoiceOptions = computed(() => voiceOptions.value.length > 0);
const hasLearnedBenchmark = computed(() => Boolean(benchmarkProfile.value));
const selectedVoiceResource = computed(
  () =>
    voiceResourceItems.value.find(
      (item) => item.id === selectedVoiceId.value,
    ) ?? null,
);
const selectedAvatarResource = computed(
  () =>
    avatarResourceItems.value.find(
      (item) => item.id === selectedAvatarId.value,
    ) ?? null,
);
const selectedVoiceGenerationState = computed(() =>
  buildVoiceGenerationState(selectedVoiceId.value, selectedVoiceResource.value),
);
const selectedAvatarCardItems = computed(() =>
  selectedAvatarIds.value
    .map((id) => avatarResourceItems.value.find((item) => item.id === id))
    .filter((item): item is AvatarResource => Boolean(item))
    .slice(0, 7),
);
const hasSelectedAvatarCards = computed(
  () => selectedAvatarCardItems.value.length > 0,
);
const progressText = computed(() => `${activeStep.value}/4`);
const progressPercent = computed(() => activeStep.value * 25);
const pipelineStatusLabel = computed(() => {
  if (!douyinPipeline.value) return "";
  if (pipelinePhase.value === "download") return "1/2 正在下载并保存抖音源视频";
  if (pipelinePhase.value === "transcribe") return "2/2 正在抽取音轨并转写文案";
  return "";
});
const scriptBlockHint = computed(() =>
  isDouyinNormalizedUrl(draft.videoUrl)
    ? "抖音链接会先落到服务端目录，再用 FFmpeg + ASR 回填这份文案。"
    : "支持直接从上传音视频或当前链接中转写口播文案。",
);
const selectedAvatarLabel = computed(
  () =>
    avatarOptions.value.find((item) => item.value === selectedAvatarId.value)
      ?.label ?? "未选择",
);
const selectedVoiceLabel = computed(
  () =>
    voiceOptions.value.find((item) => item.value === selectedVoiceId.value)
      ?.label ?? "未选择",
);
const voicePreviewBlockReason = computed(() => {
  if (!currentWorkflowScript.value)
    return "未生成脚本：请先在第一步生成或填写口播脚本。";
  return selectedVoiceGenerationState.value.reason;
});
const hasVoicePreviewOutput = computed(
  () =>
    Boolean(voicePreviewUrl.value) ||
    voicePreviewLoading.value ||
    voicePreviewTaskStatus.value !== "idle" ||
    Boolean(voicePreviewError.value),
);
const voicePreviewStateTitle = computed(() => {
  switch (voicePreviewTaskStatus.value) {
    case "submitted":
      return "已提交生成请求";
    case "queued":
      return "配音任务排队中";
    case "running":
      return "配音生成中";
    case "saving":
      return "正在保存试听音频";
    case "ready":
      return "试听音频已生成";
    case "failed":
      return "生成失败";
    case "timeout":
      return "生成超时";
    default:
      return voicePreviewLoading.value ? "配音生成中" : "试听音频";
  }
});
const voicePreviewStateHint = computed(() => {
  if (voicePreviewError.value) return voicePreviewError.value;
  if (voicePreviewHint.value) return voicePreviewHint.value;
  switch (voicePreviewTaskStatus.value) {
    case "submitted":
      return "请求已提交，正在准备生成配音。";
    case "queued":
      return "任务已进入队列，请稍候。";
    case "running":
      return "正在调用语音模型生成试听音频。";
    case "saving":
      return "音频已生成，正在保存并回写可试听地址。";
    case "ready":
      return voicePreviewMode.value === "mock"
        ? "当前返回的是联调用预览音频。"
        : "可以先试听这段配音，确认声音后再进入对口型。";
    case "failed":
      return "请调整文案或音色后重新生成。";
    case "timeout":
      return "生成等待超时，请重试。";
    default:
      return "";
  }
});
const stepTwoGenerateBlockReason = computed(() => {
  if (!currentWorkflowScript.value)
    return "未生成脚本：请先在第一步生成或填写口播脚本。";
  if (!selectedAvatarId.value)
    return "未选择数字人：请先添加或选择一个数字人视频。";
  if (!selectedAvatarResource.value)
    return "资源未匹配：当前选中的数字人不在资源列表中，请刷新资源或重新选择。";
  return selectedVoiceGenerationState.value.reason;
});
const smartClipRenderBlockReason = computed(() => {
  if (!currentWorkflowScript.value)
    return "未生成脚本：请先在第一步生成或填写口播脚本。";
  if (!selectedAvatarId.value)
    return "未选择数字人：请先添加或选择一个数字人视频。";
  if (!selectedAvatarResource.value)
    return "资源未匹配：当前选中的数字人不在资源列表中，请刷新资源或重新选择。";
  if (selectedVoiceGenerationState.value.reason)
    return selectedVoiceGenerationState.value.reason;
  if (!selectedSubtitleTemplateId.value)
    return "未选择字幕模板：请先选择一个字幕样式。";
  return "";
});
const selectedSubtitleTemplateItem = computed(
  () =>
    subtitleTemplateItems.value.find(
      (item) => item.id === selectedSubtitleTemplateId.value,
    ) ?? null,
);
const selectedSubtitleTemplateLabel = computed(
  () => selectedSubtitleTemplateItem.value?.name ?? "未选择模板",
);
const selectedSubtitleTemplateCover = computed(() => {
  const item = selectedSubtitleTemplateItem.value;
  return (
    item?.previewCoverUrl ||
    item?.coverUrl ||
    selectedAvatarResource.value?.coverUrl ||
    ""
  );
});
const selectedAvatarCoverUrl = computed(() =>
  selectedAvatarResource.value?.coverUrl
    ? resolveProtectedMediaUrl(selectedAvatarResource.value.coverUrl)
    : "",
);
const selectedSubtitleTemplateCoverUrl = computed(() =>
  selectedSubtitleTemplateCover.value
    ? resolveProtectedMediaUrl(selectedSubtitleTemplateCover.value)
    : "",
);
const extractedScriptLines = computed(() => {
  const raw = sanitizeWorkflowScriptText(draft.manualScriptDraft.trim());
  if (raw) return splitScriptIntoSemanticSegments(raw);

  const fromSegments = draft.transcriptSegments
    .map((segment) => segment.text.trim())
    .filter(Boolean);
  return splitScriptIntoSemanticSegments(fromSegments.join("\n"));
});
const oralScriptSourceText = computed(() => {
  const raw = sanitizeWorkflowScriptText(draft.manualScriptDraft.trim());
  if (raw) return raw;

  const fromSegments = draft.transcriptSegments
    .map((segment) => segment.text.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
  if (fromSegments) return fromSegments;
  return draft.manualScriptDraft.trim();
});
function isInternalPipelineScriptLine(line: string) {
  const normalized = line.replace(/\s+/g, " ").trim();
  if (!normalized) return false;
  return (
    normalized.includes("模拟口播原文稿") ||
    normalized.includes("原视频链接占位") ||
    normalized.includes("真实链路") ||
    (normalized.includes("FFmpeg") &&
      normalized.includes("ASR") &&
      normalized.includes("回填")) ||
    /^https?:\/\/\S+$/i.test(normalized)
  );
}

function sanitizeWorkflowScriptText(value: string) {
  return value
    .split(/\r\n|\n|\r/)
    .map((line) => line.trim())
    .filter((line) => line && !isInternalPipelineScriptLine(line))
    .join("\n")
    .trim();
}

function splitLongTextByLength(text: string, maxChars: number) {
  const result: string[] = [];
  for (let i = 0; i < text.length; i += maxChars) {
    const chunk = text.slice(i, i + maxChars).trim();
    if (chunk) result.push(chunk);
  }
  return result;
}

function splitSemanticSentence(sentence: string, maxChars: number) {
  const trimmed = sentence.trim();
  if (!trimmed) return [];

  const hardSplitPieces = trimmed
    .match(/[^\uFF0C,\u3001\uFF1A:]+[\uFF0C,\u3001\uFF1A:]*/g)
    ?.map((item) => item.trim())
    .filter(Boolean) ?? [trimmed];
  return hardSplitPieces.flatMap((piece) =>
    piece.length > maxChars ? splitLongTextByLength(piece, maxChars) : [piece],
  );
}

function splitScriptIntoSemanticSegments(text: string, maxChars = 32) {
  const source = sanitizeWorkflowScriptText(text);
  if (!source) return [];

  return source
    .split(/\r\n|\n|\r/)
    .flatMap((line) =>
      (
        line
          .replace(/\s+/g, " ")
          .match(
            /[^\u3002\uFF01\uFF1F!?\uFF1B;]+[\u3002\uFF01\uFF1F!?\uFF1B;]*/g,
          ) ?? [line]
      ).flatMap((sentence) => splitSemanticSentence(sentence, maxChars)),
    )
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function trimRecordText(value: string, maxLength: number) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength)}...`;
}

async function loadRecentExtractionRecords() {
  if (!user.isLoggedIn) {
    recentExtractionRecords.value = [];
    return;
  }
  recentExtractionLoading.value = true;
  try {
    const rows = await listRecentExtractions(6);
    recentExtractionRecords.value = rows
      .filter((item) => item?.sourceUrl && item?.title)
      .slice(0, 6);
  } catch (e: unknown) {
    recentExtractionRecords.value = [];
    if (axios.isAxiosError(e) && e.response?.status === 404) {
      return;
    }
    message.warning(describeHttpOrNetworkError(e));
  } finally {
    recentExtractionLoading.value = false;
  }
}

async function rememberRecentExtraction(
  meta: VideoMetaPreview,
  sourceUrl: string,
) {
  const summary =
    meta.content ||
    meta.description ||
    meta.title ||
    "这条视频暂时没有解析到正文内容";
  const record = {
    sourceUrl,
    platform: meta.platform === "douyin" ? "抖音" : "视频",
    title: trimRecordText(meta.title || summary, 72),
    summary: trimRecordText(summary, 120),
    coverUrl: meta.coverImageUrl || "",
    videoUrl: meta.videoUrl || "",
    extractedAt: new Date().toISOString(),
  };

  try {
    const saved = await saveRecentExtraction(record);
    recentExtractionRecords.value = [
      saved,
      ...recentExtractionRecords.value.filter(
        (item) => item.sourceUrl !== saved.sourceUrl,
      ),
    ].slice(0, 6);
  } catch (e: unknown) {
    message.warning(describeHttpOrNetworkError(e));
  }
}

function formatRecentExtractionTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "刚刚";
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const clock = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  if (sameDay) return `今天 ${clock}`;
  if (date.toDateString() === yesterday.toDateString()) return `昨天 ${clock}`;
  return `${date.getMonth() + 1}/${date.getDate()} ${clock}`;
}

async function copyRecentExtractionLink(record: RecentExtractionRecord) {
  try {
    await navigator.clipboard.writeText(record.sourceUrl);
    message.success("已复制该短视频链接。");
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = record.sourceUrl;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
    message.success("已复制该短视频链接。");
  }
}

function applySafeTranscriptToEditableScript(payload: {
  fullText: string;
  segments: Parameters<typeof applyTranscriptToEditableScript>[0]["segments"];
  transcriptId?: string;
  rewriteSuggestion?: string;
}) {
  const fullText = sanitizeWorkflowScriptText(payload.fullText);
  if (!fullText) {
    message.warning("转写没有返回有效口播文案，请检查 ASR 配置或重新转写。");
    return false;
  }
  applyTranscriptToEditableScript({
    ...payload,
    fullText,
    segments: payload.segments.filter(
      (segment) => !isInternalPipelineScriptLine(segment.text),
    ),
  });
  return true;
}

function clearInternalPipelineScriptDraft() {
  const raw = draft.manualScriptDraft.trim();
  if (!raw) return;
  const clean = sanitizeWorkflowScriptText(raw);
  if (clean === raw) return;
  draft.manualScriptDraft = clean;
  if (!clean) {
    draft.setTranscriptFromApi("", [], {});
  }
}

const rawWorkflowScript = computed(() => {
  const manual = draft.manualScriptDraft.trim();
  if (manual) return manual;
  const committed = draft.transcriptDraft.trim();
  if (committed) return committed;
  return draft.transcriptSegments
    .map((segment) => segment.text.trim())
    .filter(Boolean)
    .join("\n");
});
const currentWorkflowScript = computed(() =>
  sanitizeWorkflowScriptText(rawWorkflowScript.value),
);

function ensureStreamingScriptComplete() {
  if (isStreamingToScript.value) {
    interruptStreamWithFullText();
  }
}

const workflowProgressState = computed(() => {
  const prerequisitesReady = Boolean(
    currentWorkflowScript.value &&
    selectedAvatarId.value &&
    selectedVoiceId.value &&
    selectedSubtitleTemplateId.value,
  );

  if (subtitleWorkflowFinalUrl.value) {
    return {
      percent: 100,
      doneCount: 5,
      activeIndex: 4,
      status: "完整视频已生成",
      hint: "无字幕成片已经输出，可以直接预览结果。",
    };
  }
  if (smartClipRenderTask.value?.status === "failed") {
    return {
      percent: 100,
      doneCount: 0,
      activeIndex: 0,
      status: "生成失败",
      hint:
        smartClipRenderTask.value.error || "生成失败，请检查素材后重新生成。",
    };
  }
  if (
    smartClipRendering.value ||
    smartClipRenderTask.value?.status === "processing" ||
    smartClipRenderTask.value?.status === "pending"
  ) {
    return {
      percent: smartClipRenderTask.value?.progress ?? 88,
      doneCount: 3,
      activeIndex: 3,
      status: "正在输出最终视频",
      hint: "正在把数字人口型和声音合成完整成片。",
    };
  }
  if (false) {
    return {
      percent: 72,
      doneCount: 3,
      activeIndex: 3,
      status: "5 秒预览已生成",
      hint: "请检查声音和口型同步效果，确认后输出完整视频。",
    };
  }
  if (smartClipCutDetecting.value) {
    return {
      percent: 42,
      doneCount: 1,
      activeIndex: 1,
      status: "正在合成预览",
      hint: "系统正在生成音轨，并制作可检查的 5 秒无字幕预览。",
    };
  }
  if (prerequisitesReady) {
    return {
      percent: 12,
      doneCount: 0,
      activeIndex: 0,
      status: "素材已就绪",
      hint: "点击生成 5 秒预览，先看效果再输出完整视频。",
    };
  }
  return {
    percent: 0,
    doneCount: 0,
    activeIndex: 0,
    status: "等待补齐素材",
    hint: "先确认文案、数字人和音色。",
  };
});
const workflowProgressSteps = computed(() => {
  const smartSteps = [
    { label: "生成音轨" },
    { label: "整理字幕" },
    { label: "剪辑气口" },
    { label: "对齐口型" },
    { label: "输出成片" },
  ];
  return smartSteps.map((step, index) => ({
    ...step,
    status:
      index < workflowProgressState.value.doneCount
        ? "done"
        : workflowProgressState.value.percent > 0 &&
            index === workflowProgressState.value.activeIndex
          ? "active"
          : "idle",
  }));
  const steps = [
    { label: "生成音轨" },
    { label: "合成预览" },
    { label: "对齐口型" },
    { label: "输出成片" },
  ];
  return steps.map((step, index) => ({
    ...step,
    status:
      index < workflowProgressState.value.doneCount
        ? "done"
        : workflowProgressState.value.percent > 0 &&
            index === workflowProgressState.value.activeIndex
          ? "active"
          : "idle",
  }));
});
const workflowSimpleSteps = computed(() => {
  return ["生成音轨", "整理字幕", "剪辑气口", "对齐口型", "输出成片"].map(
    (label, index) => ({
      label,
      status: workflowProgressSteps.value[index]?.status ?? "idle",
    }),
  );
  const labels = ["生成音轨", "合成预览", "对齐口型", "输出成片"];
  return labels.map((label, index) => ({
    label,
    status: workflowProgressSteps.value[index]?.status ?? "idle",
  }));
});

const firstReadyVideoUrl = computed(() => {
  if (subtitleWorkflowFinalUrl.value) return subtitleWorkflowFinalUrl.value;
  return null;
});
const generatedVideoCount = computed(() => {
  if (subtitleWorkflowFinalUrl.value) return 1;
  return 0;
});
const publishReadyItems = computed(() => {
  if (subtitleWorkflowFinalUrl.value) {
    return [
      {
        index: 1,
        videoUrl: subtitleWorkflowFinalUrl.value,
        text: currentWorkflowScript.value || "已生成最终视频",
      },
    ];
  }
  return [];
});
const footerNextLabel = computed(() => {
  if (activeStep.value === 1) return "下一步：配音 & 数字人";
  if (activeStep.value === 2) return "下一步：一键成片";
  if (activeStep.value === 3) return "下一步：自动发布";
  return "四步已完成";
});

function revokeGeneratedPreviewObjectUrls() {
  for (const url of generatedPreviewObjectUrls.value) {
    URL.revokeObjectURL(url);
  }
  generatedPreviewObjectUrls.value = [];
}

function resolveProtectedMediaUrl(url: string) {
  const trimmed = url.trim();
  if (!trimmed) return "";
  if (/^(https?:|data:|blob:)/i.test(trimmed)) return trimmed;
  if (trimmed.startsWith("/")) return trimmed;
  return `${apiBasePath}/${trimmed.replace(/^\/+/, "")}`;
}

function isAvatarPlaceholderCover(url: string | null | undefined) {
  const trimmed = url?.trim();
  if (!trimmed) return true;
  const normalized = (() => {
    try {
      return decodeURIComponent(trimmed).toLowerCase();
    } catch {
      return trimmed.toLowerCase();
    }
  })();
  return (
    normalized.includes("placehold.co") && normalized.includes("text=avatar")
  );
}

function resolveAvatarCoverImageUrl(item: AvatarResource) {
  if (isAvatarPlaceholderCover(item.coverUrl)) return "";
  return resolveProtectedMediaUrl(item.coverUrl);
}

function resolveAvatarCoverVideoUrl(item: AvatarResource) {
  return avatarCoverVideoUrls.value[item.id] ?? "";
}

function revokeAvatarCoverVideoUrl(id: string) {
  const url = avatarCoverVideoUrls.value[id];
  if (url?.startsWith("blob:")) URL.revokeObjectURL(url);
  const next = { ...avatarCoverVideoUrls.value };
  delete next[id];
  avatarCoverVideoUrls.value = next;
}

function clearAvatarCoverVideoUrls() {
  for (const id of Object.keys(avatarCoverVideoUrls.value)) {
    revokeAvatarCoverVideoUrl(id);
  }
}

async function ensureAvatarVideoCover(item: AvatarResource) {
  if (!isAvatarPlaceholderCover(item.coverUrl)) return;
  const source = item.originalVideoUrl?.trim();
  if (
    !source ||
    avatarCoverVideoUrls.value[item.id] ||
    pendingAvatarCoverIds.has(item.id)
  )
    return;

  pendingAvatarCoverIds.add(item.id);
  try {
    const nextUrl = /^(https?:|data:|blob:)/i.test(source)
      ? source
      : avatarVideoStreamUrl(source);

    if (!selectedAvatarIds.value.includes(item.id)) {
      return;
    }

    avatarCoverVideoUrls.value = {
      ...avatarCoverVideoUrls.value,
      [item.id]: nextUrl,
    };
  } catch {
    // 封面兜底失败不阻断创作流程，卡片会继续显示文字占位。
  } finally {
    pendingAvatarCoverIds.delete(item.id);
  }
}

function syncAvatarVideoCovers(items: AvatarResource[]) {
  const visibleIds = new Set(items.map((item) => item.id));
  for (const id of Object.keys(avatarCoverVideoUrls.value)) {
    if (!visibleIds.has(id)) revokeAvatarCoverVideoUrl(id);
  }
  for (const item of items) {
    void ensureAvatarVideoCover(item);
  }
}

async function resolveGeneratedPreviewVideoUrl(url: string | null) {
  const source = url?.trim();
  if (!source) return null;
  if (/^(https?:|data:|blob:)/i.test(source)) return source;

  const token = localStorage.getItem("kb_token");
  const response = await fetch(resolveProtectedMediaUrl(source), {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (!response.ok) {
    throw new Error(`预览视频加载失败（${response.status}）`);
  }
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  generatedPreviewObjectUrls.value = [
    ...generatedPreviewObjectUrls.value,
    objectUrl,
  ];
  return objectUrl;
}

function syncPublishCopyFromScript(force = false) {
  if (publishCopyTouched.value && !force) return;
  const next = draft.manualScriptDraft.trim().slice(0, 140);
  if (next) {
    publishCopy.value = next;
  }
}

function addAvatarToCurrentCreation(
  id: string,
  options: { silent?: boolean } = {},
) {
  const nextId = id.trim();
  if (!nextId) return false;
  if (!avatarResourceItems.value.some((item) => item.id === nextId))
    return false;

  if (
    !selectedAvatarIds.value.includes(nextId) &&
    selectedAvatarIds.value.length >= 7
  ) {
    if (!options.silent) {
      message.warning("最多添加 7 位数字人，请先移除一个再添加。");
    }
    return false;
  }

  selectedAvatarIds.value = [
    nextId,
    ...selectedAvatarIds.value.filter((itemId) => itemId !== nextId),
  ].slice(0, 7);
  selectedAvatarId.value = nextId;
  return true;
}

function selectAvatarForCurrentCreation(id: string) {
  if (!selectedAvatarIds.value.includes(id)) return;
  selectedAvatarId.value = id;
}

function removeAvatarFromCurrentCreation(id: string) {
  selectedAvatarIds.value = selectedAvatarIds.value.filter(
    (itemId) => itemId !== id,
  );
  if (selectedAvatarId.value === id) {
    selectedAvatarId.value = selectedAvatarIds.value[0] ?? "";
  }
  message.success("已从当前创作移除该数字人。");
}

type RenderResourcesLoadState = {
  avatars: boolean;
  voices: boolean;
  subtitleTemplates: boolean;
};

async function loadRenderResources(): Promise<RenderResourcesLoadState> {
  renderResourceLoading.value = true;
  const loadState: RenderResourcesLoadState = {
    avatars: false,
    voices: false,
    subtitleTemplates: false,
  };
  try {
    const [avatarsResult, voicesResult, subtitleTemplatesResult] =
      await Promise.allSettled([
        listAvatarResources({ scope: "all", limit: 40 }),
        listVoiceResources({ scope: "all", limit: 40 }),
        listSubtitleTemplateResources({ scope: "all", limit: 40 }),
      ]);

    if (avatarsResult.status === "fulfilled") {
      loadState.avatars = true;
      avatarResourceItems.value = avatarsResult.value.items.filter((item) =>
        Boolean(item.originalVideoUrl),
      );
      avatarOptions.value = avatarResourceItems.value.map((item) => ({
        label: item.name,
        value: item.id,
      }));

      const avatarIds = new Set(avatarOptions.value.map((item) => item.value));
      const routeAvatarId =
        typeof route.query.avatarId === "string"
          ? route.query.avatarId.trim()
          : "";
      requestedAvatarUnavailable.value = false;
      selectedAvatarIds.value = selectedAvatarIds.value
        .filter((id) => avatarIds.has(id))
        .slice(0, 7);
      if (routeAvatarId && avatarIds.has(routeAvatarId)) {
        if (consumedRouteAvatarId.value !== routeAvatarId) {
          addAvatarToCurrentCreation(routeAvatarId, { silent: true });
          consumedRouteAvatarId.value = routeAvatarId;
        }
      } else if (routeAvatarId) {
        requestedAvatarUnavailable.value = true;
      }
      if (!selectedAvatarIds.value.includes(selectedAvatarId.value)) {
        selectedAvatarId.value = selectedAvatarIds.value[0] ?? "";
      }
    }

    if (voicesResult.status === "fulfilled") {
      loadState.voices = true;
      voiceResourceItems.value = voicesResult.value.items.filter(
        (item) => !hiddenRecommendedVoiceIds.has(item.id),
      );
      voiceOptions.value = voiceResourceItems.value.map((item) => ({
        label: item.name,
        value: item.id,
      }));
      const voiceIds = new Set(voiceOptions.value.map((item) => item.value));
      if (!voiceIds.has(selectedVoiceId.value)) {
        selectedVoiceId.value = voiceOptions.value[0]?.value ?? "";
      }
    }

    if (subtitleTemplatesResult.status === "fulfilled") {
      loadState.subtitleTemplates = true;
      subtitleTemplateItems.value = subtitleTemplatesResult.value.items;
      subtitleTemplateOptions.value = subtitleTemplatesResult.value.items.map(
        (item) => ({
          label: item.name,
          value: item.id,
        }),
      );
      const subtitleTemplateIds = new Set(
        subtitleTemplateOptions.value.map((item) => item.value),
      );
      if (!subtitleTemplateIds.has(selectedSubtitleTemplateId.value)) {
        selectedSubtitleTemplateId.value =
          subtitleTemplateOptions.value[0]?.value ?? "";
      }
    }
  } finally {
    renderResourceLoading.value = false;
  }
  return loadState;
}

async function createAvatarFromStudio(body: CreateAvatarResourceDraft) {
  creatingAvatar.value = true;
  try {
    const item = body.uploadFile
      ? await uploadAvatarResource(body)
      : await createAvatarResource(body);
    await loadRenderResources();
    if (
      !avatarResourceItems.value.some((resource) => resource.id === item.id)
    ) {
      avatarResourceItems.value = [item, ...avatarResourceItems.value].slice(
        0,
        40,
      );
      avatarOptions.value = [
        { label: item.name, value: item.id },
        ...avatarOptions.value.filter((option) => option.value !== item.id),
      ];
    }
    addAvatarToCurrentCreation(item.id);
    createAvatarOpen.value = false;
    message.success("数字人视频已加入当前创作，并自动选中。");
  } catch (e: unknown) {
    message.error(describeHttpOrNetworkError(e));
  } finally {
    creatingAvatar.value = false;
  }
}

async function cloneVoiceFromStudio(body: CreateVoiceResourceDraft) {
  cloningVoice.value = true;
  try {
    const item = body.sampleFile
      ? await cloneVoiceResourceUpload(body)
      : await cloneVoiceResource(body);
    const loadState = await loadRenderResources();
    if (!voiceResourceItems.value.some((resource) => resource.id === item.id)) {
      voiceResourceItems.value = [item, ...voiceResourceItems.value].slice(
        0,
        40,
      );
    }
    if (!voiceOptions.value.some((option) => option.value === item.id)) {
      voiceOptions.value = [
        { label: item.name, value: item.id },
        ...voiceOptions.value.filter((option) => option.value !== item.id),
      ];
    }
    selectedVoiceId.value = item.id;
    cloneVoiceOpen.value = false;
    if (!loadState.voices) {
      message.warning("克隆音频已创建，但音色列表刷新失败，已先加入当前创作。");
    }
    if (item.provider === "local-upload") {
      voiceSourceMode.value = "local";
      const reason = item.cloneError
        ? `原因：${item.cloneError.slice(0, 160)}`
        : "可先作为本地音频样本使用";
      message.warning(
        `音频已加入当前创作；模型克隆未通过，已保存为本地样本。${reason}`,
      );
      return;
    }
    message.success("克隆音频已加入当前创作，并自动选中。");
  } catch (e: unknown) {
    message.error(describeHttpOrNetworkError(e));
  } finally {
    cloningVoice.value = false;
  }
}

function resetVoicePreviewState() {
  clearVoicePreviewProgress();
  clearVoicePreviewPolling();
  voicePreviewUrl.value = null;
  voicePreviewHint.value = "";
  voicePreviewMode.value = "";
  voicePreviewDurationSeconds.value = 0;
  voicePreviewProgress.value = 0;
  voicePreviewProgressLabel.value = "准备生成音频";
  voicePreviewTaskId.value = "";
  voicePreviewTaskStatus.value = "idle";
  voicePreviewError.value = "";
}

function clearVoicePreviewProgress() {
  if (voicePreviewProgressTimer !== null) {
    window.clearInterval(voicePreviewProgressTimer);
    voicePreviewProgressTimer = null;
  }
}

function clearVoicePreviewPolling() {
  if (voicePreviewPollTimer !== null) {
    window.clearTimeout(voicePreviewPollTimer);
    voicePreviewPollTimer = null;
  }
}

function scrollVoiceShellToOutput() {
  void nextTick(() => {
    const shell = voiceShellRef.value;
    if (!shell) return;
    shell.scrollTo({
      top: shell.scrollHeight,
      behavior: "smooth",
    });
  });
}

function startVoicePreviewProgress() {
  clearVoicePreviewProgress();
  voicePreviewProgress.value = 8;
  voicePreviewProgressLabel.value = "正在整理文案和音色参数";
  scrollVoiceShellToOutput();
  voicePreviewProgressTimer = window.setInterval(() => {
    const current = voicePreviewProgress.value;
    if (current < 36) {
      voicePreviewProgress.value = Math.min(36, current + 7);
      voicePreviewProgressLabel.value = "正在整理文案和音色参数";
      return;
    }
    if (current < 72) {
      voicePreviewProgress.value = Math.min(72, current + 5);
      voicePreviewProgressLabel.value = "正在请求语音生成接口";
      return;
    }
    voicePreviewProgress.value = Math.min(92, current + 2);
    voicePreviewProgressLabel.value = "正在保存试听音频";
  }, 420);
}

function finishVoicePreviewProgress(ok: boolean) {
  clearVoicePreviewProgress();
  voicePreviewProgress.value = ok ? 100 : 0;
  voicePreviewProgressLabel.value = ok
    ? "音频已生成，可以先试听效果"
    : "生成失败，请调整后重试";
  scrollVoiceShellToOutput();
}

function patchVoicePreviewProgressByTaskStatus(
  status: "queued" | "running" | "saving",
) {
  if (status === "queued") {
    voicePreviewProgress.value = Math.max(voicePreviewProgress.value, 22);
    voicePreviewProgressLabel.value = "任务已提交，正在排队生成";
    return;
  }
  if (status === "running") {
    voicePreviewProgress.value = Math.max(voicePreviewProgress.value, 62);
    voicePreviewProgressLabel.value = "任务生成中，正在等待语音结果";
    return;
  }
  voicePreviewProgress.value = Math.max(voicePreviewProgress.value, 86);
  voicePreviewProgressLabel.value = "语音已生成，正在保存试听音频";
}

function applyVoicePreviewResult(data: {
  audioUrl?: string;
  hint?: string;
  ttsMode?: "provider" | "mock";
  durationSeconds?: number;
}) {
  const nextUrl = data.audioUrl?.trim();
  if (!nextUrl) return false;
  voicePreviewUrl.value = nextUrl;
  voicePreviewHint.value = data.hint ?? "";
  voicePreviewMode.value = data.ttsMode ?? "";
  voicePreviewDurationSeconds.value = Number.isFinite(data.durationSeconds)
    ? Math.max(0, Number(data.durationSeconds))
    : 0;
  voicePreviewTaskStatus.value = "ready";
  finishVoicePreviewProgress(true);
  return true;
}

async function pollVoicePreviewUntilReady(
  previewTaskId: string,
  statusUrl: string | undefined,
  requestSeq: number,
) {
  const startedAt = Date.now();
  const timeoutMs = 180_000;

  while (requestSeq === voicePreviewRequestSeq) {
    if (Date.now() - startedAt > timeoutMs) {
      voicePreviewTaskStatus.value = "timeout";
      voicePreviewError.value = "等待配音结果超时，请重试。";
      finishVoicePreviewProgress(false);
      message.error("等待配音结果超时，请重试。");
      return;
    }

    await new Promise<void>((resolve) => {
      clearVoicePreviewPolling();
      voicePreviewPollTimer = window.setTimeout(() => {
        voicePreviewPollTimer = null;
        resolve();
      }, 1500);
    });
    if (requestSeq !== voicePreviewRequestSeq) return;

    try {
      const task = await getVoicePreviewTaskStatus(previewTaskId, statusUrl);
      if (requestSeq !== voicePreviewRequestSeq) return;

      if (task.status === "failed") {
        voicePreviewTaskStatus.value = "failed";
        voicePreviewError.value =
          task.error?.trim() || "配音任务失败，请重试。";
        finishVoicePreviewProgress(false);
        message.error(voicePreviewError.value);
        return;
      }

      if (task.status === "succeeded") {
        if (applyVoicePreviewResult(task)) return;
        voicePreviewTaskStatus.value = "saving";
        patchVoicePreviewProgressByTaskStatus("saving");
        continue;
      }

      voicePreviewTaskStatus.value = task.status;
      voicePreviewHint.value = task.hint ?? voicePreviewHint.value;
      patchVoicePreviewProgressByTaskStatus(task.status);
    } catch (e: unknown) {
      if (requestSeq !== voicePreviewRequestSeq) return;
      voicePreviewTaskStatus.value = "failed";
      voicePreviewError.value = describeHttpOrNetworkError(e);
      finishVoicePreviewProgress(false);
      message.error(voicePreviewError.value);
      return;
    }
  }
}

function formatSecondsClock(value: number) {
  const total = Math.max(0, Math.round(value));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function nudgeVoicePower(delta: number) {
  const next = Number((selectedVoicePower.value + delta).toFixed(2));
  selectedVoicePower.value = Math.min(1.5, Math.max(0.6, next));
}

function buildVoiceTuningPayload() {
  return {
    voiceLanguage: selectedVoiceLanguage.value,
    voiceEmotion: selectedVoiceEmotion.value,
    voiceEmotionIntensity: selectedVoicePower.value,
    voiceRate: selectedVoiceRate.value,
    voiceVolume: selectedVoiceVolume.value,
  };
}

function buildVoiceGenerationState(
  selectedId: string,
  resource: VoiceResource | null,
): VoiceGenerationState {
  if (!selectedId) {
    return { ready: false, reason: "未选音色：请先选择一个配音音色。" };
  }
  if (!resource) {
    return {
      ready: false,
      reason:
        "资源未匹配：当前选中的音色不在资源列表中，请刷新资源或重新选择。",
    };
  }
  if (resource.cloneStatus === "processing") {
    return {
      ready: false,
      reason: "音色未 ready：当前音色仍在克隆处理中，请稍后刷新后再生成。",
    };
  }
  if (resource.cloneStatus === "failed") {
    const error = resource.cloneError
      ? `原因：${resource.cloneError.slice(0, 120)}`
      : "请重新上传样本或选择其他音色。";
    return { ready: false, reason: `音色未 ready：克隆失败。${error}` };
  }
  if (resource.cloneStatus !== "ready") {
    return {
      ready: false,
      reason: "音色未 ready：接口未返回 ready 状态，请刷新资源列表后再试。",
    };
  }
  if (resource.provider === "local-upload") {
    return {
      ready: false,
      reason:
        "所选音色不支持生成：本地上传音频只能作为样本留档，请选择支持 TTS 的克隆音色或推荐音色。",
    };
  }
  if (!resource.providerVoice) {
    return {
      ready: false,
      reason:
        "所选音色不支持生成：接口缺少 providerVoice，无法提交到 TTS/成片链路。",
    };
  }
  return { ready: true, reason: "" };
}

async function onGenerateVoicePreview() {
  await onGenerateVoicePreviewV2();
}

async function onGenerateVoicePreviewV2() {
  ensureStreamingScriptComplete();
  const blockReason = voicePreviewBlockReason.value;
  if (blockReason) {
    message.warning(blockReason);
    return;
  }

  const script = currentWorkflowScript.value;
  const requestSeq = ++voicePreviewRequestSeq;

  resetVoicePreviewState();
  voicePreviewLoading.value = true;
  voicePreviewTaskStatus.value = "submitted";
  startVoicePreviewProgress();

  try {
    const data = await createVoicePreview({
      script,
      voiceResourceId: selectedVoiceId.value,
      ...buildVoiceTuningPayload(),
    });
    if (requestSeq !== voicePreviewRequestSeq) return;

    voicePreviewHint.value = data.hint ?? "";

    if (applyVoicePreviewResult(data)) {
      message.success("Preview audio is ready.");
      return;
    }

    const previewTaskId = data.previewTaskId?.trim();
    if (previewTaskId) {
      voicePreviewTaskId.value = previewTaskId;
      if (data.status === "running") {
        voicePreviewTaskStatus.value = "running";
        patchVoicePreviewProgressByTaskStatus("running");
      } else {
        voicePreviewTaskStatus.value = "queued";
        patchVoicePreviewProgressByTaskStatus("queued");
      }
      await pollVoicePreviewUntilReady(
        previewTaskId,
        data.statusUrl,
        requestSeq,
      );
      if (requestSeq !== voicePreviewRequestSeq) return;
      if (voicePreviewUrl.value) {
        message.success("Preview audio is ready.");
      }
      return;
    }

    voicePreviewTaskStatus.value = "failed";
    voicePreviewError.value =
      data.error?.trim() || "Preview request finished without an audio URL.";
    finishVoicePreviewProgress(false);
    message.error(voicePreviewError.value);
  } catch (e: unknown) {
    if (requestSeq !== voicePreviewRequestSeq) return;
    voicePreviewTaskStatus.value = "failed";
    voicePreviewError.value = describeHttpOrNetworkError(e);
    finishVoicePreviewProgress(false);
    message.error(voicePreviewError.value);
  } finally {
    if (requestSeq === voicePreviewRequestSeq) {
      voicePreviewLoading.value = false;
    }
  }
}

async function downloadProtectedFile(url: string, fallbackName: string) {
  const token = localStorage.getItem("kb_token");
  const response = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (!response.ok) {
    throw new Error(`下载失败（${response.status}）`);
  }
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = fallbackName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}

async function onDownloadVoicePreview() {
  if (!voicePreviewUrl.value) return;
  try {
    const extension = voicePreviewMode.value === "mock" ? "wav" : "mp3";
    await downloadProtectedFile(
      voicePreviewUrl.value,
      `voice-preview-${Date.now()}.${extension}`,
    );
  } catch (e: unknown) {
    message.error(describeHttpOrNetworkError(e));
  }
}

function onProceedFromStepTwo() {
  const blockReason = stepTwoGenerateBlockReason.value;
  if (blockReason) {
    message.warning(blockReason);
    return;
  }
  syncSmartClipSubtitlesFromFirstStep(true);
  activeStep.value = 3;
  message.success("已带着当前数字人与声音配置进入一键成片。");
}

function goToResourceLibrary(tab: "avatars" | "voices" | "subtitle-templates") {
  void router.push({ name: "resource-library", query: { tab } });
}

async function refreshDyCookieStatus() {
  try {
    const { configured } = await getDyDownloaderCookieConfigured();
    dyCookieConfigured.value = configured;
  } catch {
    dyCookieConfigured.value = null;
  }
}

async function refreshPipelineHealth() {
  pipelineHealthError.value = "";
  try {
    await getTranscribePipelineHealth();
  } catch (e) {
    pipelineHealthError.value = describeHttpOrNetworkError(e);
  }
}

function buildBenchmarkIdeaDraft(mode: "ai" | "custom") {
  const profile = benchmarkProfile.value;
  if (!profile) return "";

  const sampleLines = benchmarkSamples.value
    .slice(0, 3)
    .map((item, index) => `${index + 1}. ${item.title}`);

  if (mode === "ai") {
    const suggestions = benchmarkIdeaSuggestions.value.length
      ? benchmarkIdeaSuggestions.value
      : ["围绕这个账号的高互动表达方式，整理 5 条你的口播选题"];

    return [
      `对标账号：${profile.nickname}`,
      `账号定位：${profile.signature}`,
      `近期作品参考：`,
      ...sampleLines,
      "",
      "建议选题：",
      ...suggestions.map((item, index) => `${index + 1}. ${item}`),
    ].join("\n");
  }

  return [
    `对标账号：${profile.nickname}`,
    `你准备模仿的内容方向：${profile.signature}`,
    "",
    "请在下面手动整理你的口播文案：",
    "1. 开场钩子：",
    "2. 核心观点：",
    "3. 案例或步骤：",
    "4. 收尾行动：",
    "",
    "参考作品：",
    ...sampleLines,
  ].join("\n");
}

async function focusOutlineEditor() {
  await nextTick();
  const editor = document.querySelector<HTMLTextAreaElement>(
    ".outline-editor textarea",
  );
  editor?.focus();
}

function resetOralScriptPolish() {
  oralScriptPolish.value = null;
}

async function applyBenchmarkIdeaDraft(mode: "ai" | "custom") {
  if (!benchmarkProfile.value) {
    message.warning("请先学习一个抖音主页，再生成选题。");
    return;
  }
  resetOralScriptPolish();
  draft.manualScriptDraft = buildBenchmarkIdeaDraft(mode);
  syncPublishCopyFromScript(true);
  await focusOutlineEditor();
  message.success(
    mode === "ai" ? "已生成对标选题草稿。" : "已切到自定义选题草稿。",
  );
}

async function onLearnDouyinHomepage() {
  const homepageUrl = benchmarkHomepageUrl.value.trim();
  if (!homepageUrl) {
    message.warning("请先粘贴抖音主页链接。");
    return;
  }

  benchmarkLearning.value = true;
  benchmarkLearningHint.value = "";
  try {
    const data = await learnDouyinHomepage({ homepageUrl });
    benchmarkProfile.value = data.profile;
    benchmarkSamples.value = data.samples;
    benchmarkIdeaSuggestions.value = data.ideaSuggestions;
    benchmarkLearningHint.value = data.hint;
    message.success(`已学习 ${data.profile.nickname} 的主页内容。`);
  } catch (e: unknown) {
    benchmarkLearningHint.value = describeHttpOrNetworkError(e);
    message.error(benchmarkLearningHint.value);
  } finally {
    benchmarkLearning.value = false;
  }
}

async function onOptimizeOralScript() {
  const sourceText = oralScriptSourceText.value.trim();
  if (!sourceText) {
    message.warning("请先完成转写，或先在文案框里准备好原始内容。");
    return;
  }

  optimizingOralScript.value = true;
  cancelStream();
  try {
    const result = await optimizeOralScript({
      sourceText,
      sourceVideoUrl: draft.videoUrl.trim() || undefined,
    });
    oralScriptPolish.value = result;
    draft.manualScriptDraft = result.optimizedScript.trim();
    syncPublishCopyFromScript(true);
    await focusOutlineEditor();
    message.success(
      `已生成带 3 秒钩子和 10 秒钩子的口播文案（方案：${result.strategyLabel}）${
        result.llmUsed ? "" : "，当前为回退结果"
      }。`,
    );
  } catch (e: unknown) {
    message.error(describeHttpOrNetworkError(e));
  } finally {
    optimizingOralScript.value = false;
  }
}

function goPrev() {
  activeStep.value = Math.max(1, activeStep.value - 1);
}

function goNext() {
  if (activeStep.value === 1) {
    ensureStreamingScriptComplete();
  }
  if (activeStep.value === 2) {
    const blockReason = stepTwoGenerateBlockReason.value;
    if (blockReason) {
      message.warning(blockReason);
      return;
    }
  }
  if (activeStep.value === 2) {
    syncSmartClipSubtitlesFromFirstStep(true);
  }
  if (activeStep.value === 3 && generatedVideoCount.value <= 0) {
    message.warning("请先生成整段对口型视频，再进入自动发布。");
    return;
  }
  activeStep.value = Math.min(4, activeStep.value + 1);
}

function jumpToStep(stepNo: number) {
  if (stepNo <= activeStep.value) {
    activeStep.value = stepNo;
    return;
  }
  while (activeStep.value < stepNo) {
    const before = activeStep.value;
    goNext();
    if (activeStep.value === before) return;
  }
}

async function onFetchVideoMeta() {
  const link = validateSourceVideoInput(draft.videoUrl);
  if (!link.ok || !link.normalizedUrl) {
    message.error(link.message ?? "请先填写可识别的视频链接。");
    return;
  }
  draft.videoUrl = link.normalizedUrl;

  loadingMeta.value = true;
  try {
    const meta = await fetchVideoMeta({ sourceVideoUrl: link.normalizedUrl });
    draft.setVideoMeta(meta);
    await rememberRecentExtraction(meta, link.normalizedUrl);
    if (!isDouyinNormalizedUrl(link.normalizedUrl)) {
      resetOralScriptPolish();
      draft.prefillManualScriptFromMeta(meta);
    }
  } catch (e: unknown) {
    message.error(describeHttpOrNetworkError(e));
    return;
  } finally {
    loadingMeta.value = false;
  }

  await nextTick();
  if (!isDouyinNormalizedUrl(link.normalizedUrl)) {
    message.success("已获取视频信息。");
    return;
  }

  douyinPipeline.value = true;
  pipelinePhase.value = "download";
  pipelineProgress.value = 8;
  pipelineBarProcessing.value = true;
  try {
    const saved = await downloadSourceVideoFile({
      sourceVideoUrl: link.normalizedUrl,
      transcribe: false,
    });
    const basename = saved.savedPath.split(/[/\\]/).pop()?.trim() || null;
    if (!basename) {
      message.error("未能识别服务端保存的视频文件名。");
      return;
    }
    lastSavedVideoBasename.value = basename;

    pipelinePhase.value = "transcribe";
    pipelineProgress.value = 50;
    const result = await transcribeSavedVideo({ fileName: basename });
    pipelineProgress.value = 100;
    pipelineBarProcessing.value = false;

    if (result.transcript) {
      resetOralScriptPolish();
      const applied = applySafeTranscriptToEditableScript({
        fullText: result.transcript.fullText,
        segments: result.transcript.segments,
        transcriptId: result.transcript.transcriptId,
      });
      if (applied) message.success("抖音视频已下载并完成文案转写。");
    }
    if (result.transcriptionError) {
      message.warning(result.transcriptionError);
    }
  } catch (e: unknown) {
    lastSavedVideoBasename.value = null;
    message.warning(
      `视频下载或转写失败：${await describeHttpOrNetworkErrorMaybeBlob(e)}`,
    );
  } finally {
    douyinPipeline.value = false;
    pipelinePhase.value = "idle";
    pipelineProgress.value = 0;
    pipelineBarProcessing.value = false;
    void refreshDyCookieStatus();
    void refreshPipelineHealth();
  }
}

function onUseScriptAndNext() {
  ensureStreamingScriptComplete();
  if (draft.manualScriptDraft.trim()) {
    draft.commitManualScriptToPipeline();
    syncPublishCopyFromScript();
  }
  syncSmartClipSubtitlesFromFirstStep(true);
  activeStep.value = 2;
}

async function onRetranscribeFromLocal() {
  const name = lastSavedVideoBasename.value?.trim();
  if (!name) {
    message.warning("还没有可重转写的本地视频，请先完成一次抖音抓取。");
    return;
  }
  retranscribingLocal.value = true;
  try {
    const result = await transcribeSavedVideo({ fileName: name });
    if (result.transcript) {
      resetOralScriptPolish();
      const applied = applySafeTranscriptToEditableScript({
        fullText: result.transcript.fullText,
        segments: result.transcript.segments,
        transcriptId: result.transcript.transcriptId,
      });
      if (applied) message.success("已从本地保存视频重新生成文案。");
    }
    if (result.transcriptionError) {
      message.warning(result.transcriptionError);
    }
  } catch (e: unknown) {
    message.error(describeHttpOrNetworkError(e));
  } finally {
    retranscribingLocal.value = false;
  }
}

async function onTranscribeNonDouyinFromUrl() {
  const link = validateSourceVideoInput(draft.videoUrl);
  if (!link.ok || !link.normalizedUrl) {
    message.error(link.message ?? "请先填写可解析的视频链接。");
    return;
  }
  transcribeUrlLoading.value = true;
  try {
    const data = await transcribeFromUrl({
      sourceVideoUrl: link.normalizedUrl,
    });
    resetOralScriptPolish();
    const applied = applySafeTranscriptToEditableScript({
      fullText: data.fullText,
      segments: data.segments,
      transcriptId: data.transcriptId,
    });
    if (applied) message.success("当前链接内容已完成转写。");
  } catch (e: unknown) {
    message.error(describeHttpOrNetworkError(e));
  } finally {
    transcribeUrlLoading.value = false;
  }
}

function formatBenchmarkSampleDate(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "近期发布";
  if (/^\d{10,13}$/.test(trimmed)) {
    const ms = trimmed.length === 13 ? Number(trimmed) : Number(trimmed) * 1000;
    const date = new Date(ms);
    if (!Number.isNaN(date.getTime())) {
      return `${date.getMonth() + 1}/${date.getDate()}`;
    }
  }
  return trimmed;
}

function formatSmartClipSeconds(value: number | null | undefined) {
  const seconds =
    typeof value === "number" && Number.isFinite(value)
      ? Math.max(0, value)
      : 0;
  return `${seconds.toFixed(seconds >= 10 ? 1 : 2)}s`;
}

function resetSmartClipResultState() {
  clearSmartClipPollTimer();
  smartClipRenderTask.value = null;
  smartClipRendering.value = false;
  subtitleWorkflowFinalUrl.value = null;
  subtitleWorkflowHint.value = "";
}

function buildSmartClipSubtitles(force = false) {
  const script = currentWorkflowScript.value;
  if (
    !force &&
    smartClipSubtitles.value.length > 0 &&
    smartClipSubtitleSourceText.value === script
  )
    return;
  if (!script) {
    smartClipSubtitles.value = [];
    smartClipSubtitleSourceText.value = "";
    return;
  }

  const segments = extractedScriptLines.value.length
    ? extractedScriptLines.value
    : splitScriptIntoSemanticSegments(script, 44);
  let cursor = 0;
  smartClipSubtitles.value = segments.map((text, index) => {
    const duration = Math.max(1.2, Math.min(6, text.length * 0.18));
    const startTime = Number(cursor.toFixed(2));
    cursor += duration;
    const endTime = Number(cursor.toFixed(2));
    return {
      id: `sub_${String(index + 1).padStart(3, "0")}_${script.length}`,
      startTime,
      endTime,
      text,
      highlightRanges: text.length
        ? [
            {
              start: 0,
              end: Math.min(4, text.length),
              color: "#FFD94A",
              fontWeight: 900,
            },
          ]
        : [],
    };
  });
  smartClipSubtitleSourceText.value = script;
}

function syncSmartClipSubtitlesFromFirstStep(force = false) {
  ensureStreamingScriptComplete();
  buildSmartClipSubtitles(force);
}

function toggleSmartClipSubtitleHighlight(subtitle: SmartClipSubtitle) {
  const index = smartClipSubtitles.value.findIndex(
    (item) => item.id === subtitle.id,
  );
  if (index < 0) return;
  const hasHighlight = Boolean(subtitle.highlightRanges?.length);
  smartClipSubtitles.value[index] = {
    ...subtitle,
    highlightRanges: hasHighlight
      ? []
      : [
          {
            start: 0,
            end: Math.min(4, subtitle.text.length),
            color: "#FFD94A",
            fontWeight: 900,
          },
        ],
  };
}

function shuffleSmartClipTitle() {
  const candidates = [
    ["7步让AI写出爆款", "直播话术!"],
    ["别硬扛了", "AI帮你拆话术"],
    ["一套结构化内容", "让口播更抓人"],
    ["直播开场不会说?", "先套这个脚本"],
  ];
  const current = smartClipTitleLines.value.join("");
  const next =
    candidates.find((item) => item.join("") !== current) ?? candidates[0];
  smartClipTitleLines.value = [...next];
}

function clearSmartClipSubtitles() {
  smartClipSubtitles.value = [];
}

function confirmSmartClipSubtitles() {
  message.success("字幕已确认，点击立即剪辑即可生成最终成片。");
}

async function onDetectSmartClipCutPoints(options: { silent?: boolean } = {}) {
  if (!selectedAvatarId.value) {
    message.warning("请先选择数字人视频");
    return false;
  }
  smartClipCutDetecting.value = true;
  try {
    const data = await detectSmartClipCutPoints("studio-current", {
      mode: smartClipCutMode.value,
      config: smartClipCutConfigs[smartClipCutMode.value],
      avatarResourceId: selectedAvatarId.value,
    });
    smartClipCutPoints.value = data.cutPoints;
    smartClipCutSummary.value = data.summary;
    smartClipCutApplied.value = false;
    if (!options.silent) {
      message.success(
        `已检测到 ${data.summary.totalCount} 个气口，预计压缩 ${formatSmartClipSeconds(data.summary.totalCutDuration)}。`,
      );
    }
    return true;
  } catch (e: unknown) {
    message.error(describeHttpOrNetworkError(e));
    return false;
  } finally {
    smartClipCutDetecting.value = false;
  }
}

function onApplySmartClipCutSuggestions() {
  if (!smartClipCutPoints.value.length) {
    message.warning("请先检测气口");
    return;
  }
  smartClipCutPoints.value = smartClipCutPoints.value.map((item) => ({
    ...item,
    enabled: true,
  }));
  const totalCutDuration = Number(
    smartClipCutPoints.value
      .reduce((sum, item) => sum + item.cutDuration, 0)
      .toFixed(2),
  );
  smartClipCutSummary.value = {
    ...smartClipCutSummary.value,
    totalCount: smartClipCutPoints.value.length,
    totalCutDuration,
    estimatedDuration: Number(
      Math.max(
        0,
        smartClipCutSummary.value.originalDuration - totalCutDuration,
      ).toFixed(2),
    ),
  };
  smartClipCutApplied.value = true;
  message.success("已应用剪辑建议，最终成片会自动压缩这些气口。");
}

function clearSmartClipPollTimer() {
  if (smartClipPollTimer !== null) {
    window.clearInterval(smartClipPollTimer);
    smartClipPollTimer = null;
  }
}

async function refreshSmartClipRenderTask(taskId: string) {
  const task = await getSmartClipRenderTask(taskId);
  smartClipRenderTask.value = task;
  if (task.status === "completed" && task.outputUrl) {
    clearSmartClipPollTimer();
    smartClipRendering.value = false;
    subtitleWorkflowFinalUrl.value = await resolveGeneratedPreviewVideoUrl(
      task.outputUrl,
    );
    subtitleWorkflowHint.value = "成片已生成，可以下载使用";
    message.success("成片已生成，可以下载使用。");
  } else if (task.status === "failed") {
    clearSmartClipPollTimer();
    smartClipRendering.value = false;
    subtitleWorkflowHint.value = task.error || "生成失败，请重新生成";
    message.error(subtitleWorkflowHint.value);
  }
}

function startSmartClipTaskPolling(taskId: string) {
  clearSmartClipPollTimer();
  smartClipPollTimer = window.setInterval(() => {
    void refreshSmartClipRenderTask(taskId).catch((e: unknown) => {
      subtitleWorkflowHint.value = describeHttpOrNetworkError(e);
    });
  }, 2500);
}

async function onRenderSmartClipFinal() {
  ensureStreamingScriptComplete();
  buildSmartClipSubtitles(true);
  const setupBlockReason = smartClipRenderBlockReason.value;
  if (setupBlockReason) {
    message.warning(setupBlockReason);
    return;
  }
  const script = currentWorkflowScript.value;
  if (!script) {
    message.warning("请先在第一步整理好口播文案");
    return;
  }
  if (!selectedAvatarId.value) {
    message.warning("请先选择数字人视频");
    return;
  }
  if (!selectedVoiceId.value) {
    message.warning("请先选择配音音色");
    return;
  }
  if (!selectedSubtitleTemplateId.value) {
    message.warning("请先选择字幕模板");
    return;
  }
  if (!smartClipSubtitles.value.length) {
    message.warning("字幕列表为空，请先确认文案");
    return;
  }

  if (smartClipCutBreathEnabled.value && !smartClipCutPoints.value.length) {
    const detected = await onDetectSmartClipCutPoints({ silent: true });
    if (!detected) {
      message.warning("气口检测暂时不可用，将直接进入成片生成。");
    }
  }

  resetSmartClipResultState();
  smartClipRendering.value = true;
  subtitleWorkflowHint.value = "正在生成成片，请勿关闭页面";
  revokeGeneratedPreviewObjectUrls();

  try {
    const task = await renderSmartClipFinal("studio-current", {
      script,
      avatarResourceId: selectedAvatarId.value,
      voiceResourceId: selectedVoiceId.value,
      subtitleTemplateId: selectedSubtitleTemplateId.value,
      subtitles: smartClipSubtitles.value,
      cutConfig: {
        enabled: smartClipCutBreathEnabled.value,
        mode: smartClipCutMode.value,
        config: smartClipCutConfigs[smartClipCutMode.value],
        cutPoints: smartClipCutPoints.value,
      },
      backgroundMusic: {
        enabled: smartClipBackgroundMusicEnabled.value,
        musicId: smartClipBackgroundMusicId.value,
        volume: smartClipBackgroundMusicVolume.value,
      },
      pipMaterials: {
        enabled: smartClipPipEnabled.value,
        items: [],
      },
      renderOptions: {
        resolution:
          renderResolutionChoice.value === "2k" ? "1440x2560" : "1080x1920",
        format: "mp4",
        burnSubtitles: smartClipTextSubtitlesEnabled.value,
      },
      ...buildVoiceTuningPayload(),
    });
    smartClipRenderTask.value = task;
    startSmartClipTaskPolling(task.taskId);
    await refreshSmartClipRenderTask(task.taskId);
  } catch (e: unknown) {
    smartClipRendering.value = false;
    subtitleWorkflowHint.value = describeHttpOrNetworkError(e);
    message.error(subtitleWorkflowHint.value);
  }
}

async function onGenerateSubtitlePreview() {
  await onDetectSmartClipCutPoints();
  return;
  ensureStreamingScriptComplete();
  const script = currentWorkflowScript.value;
  if (!script) {
    message.warning(
      rawWorkflowScript.value
        ? "当前内容是系统占位提示，请先转写或填写真实口播文案。"
        : "请先在第一步整理好口播文案",
    );
    return;
  }
  if (!selectedAvatarId.value) {
    message.warning("请先选择一个数字人视频");
    return;
  }
  if (!selectedVoiceId.value) {
    message.warning("请先选择一个配音音色");
    return;
  }

  subtitleWorkflowPreviewLoading.value = true;
  subtitleWorkflowHint.value = "";
  subtitleWorkflowDraftId.value = "";
  subtitleWorkflowPreviewUrl.value = null;
  subtitleWorkflowFinalUrl.value = null;
  subtitleWorkflowJson.value = null;
  subtitleWorkflowTimelineSource.value = "";
  revokeGeneratedPreviewObjectUrls();

  try {
    const data = await createSubtitleWorkflowPreview({
      script,
      avatarResourceId: selectedAvatarId.value,
      voiceResourceId: selectedVoiceId.value,
      subtitleTemplateId: selectedSubtitleTemplateId.value || undefined,
      subtitlesEnabled: false,
      previewSeconds: 5,
      ...buildVoiceTuningPayload(),
    });
    subtitleWorkflowDraftId.value = data.draftId;
    subtitleWorkflowJson.value = data.subtitleJson;
    subtitleWorkflowTimelineSource.value = data.timelineSource;
    subtitleWorkflowHint.value = data.hint;
    subtitleWorkflowPreviewUrl.value = await resolveGeneratedPreviewVideoUrl(
      data.previewUrl,
    );
    message.success("5 秒无字幕预览已经生成，可以先确认后再出最终成片");
  } catch (e: unknown) {
    subtitleWorkflowHint.value = describeHttpOrNetworkError(e);
    message.error(subtitleWorkflowHint.value);
  } finally {
    subtitleWorkflowPreviewLoading.value = false;
  }
}

async function onFinalizeSubtitleWorkflow() {
  await onRenderSmartClipFinal();
  return;
  if (!subtitleWorkflowDraftId.value) {
    message.warning("请先生成 5 秒预览，再确认输出最终视频");
    return;
  }

  subtitleWorkflowFinalizeLoading.value = true;
  try {
    const data = await finalizeSubtitleWorkflow({
      draftId: subtitleWorkflowDraftId.value,
    });
    subtitleWorkflowJson.value = data.subtitleJson;
    subtitleWorkflowHint.value = data.hint;
    subtitleWorkflowFinalUrl.value = await resolveGeneratedPreviewVideoUrl(
      data.videoUrl,
    );
    message.success(
      data.fallback ? "已输出可预览成片（当前走了回退链路）" : "最终视频已输出",
    );
  } catch (e: unknown) {
    subtitleWorkflowHint.value = describeHttpOrNetworkError(e);
    message.error(subtitleWorkflowHint.value);
  } finally {
    subtitleWorkflowFinalizeLoading.value = false;
  }
}

watch(
  () => route.query.avatarId,
  (value) => {
    const next = typeof value === "string" ? value.trim() : "";
    if (next && avatarOptions.value.some((item) => item.value === next)) {
      addAvatarToCurrentCreation(next, { silent: true });
      consumedRouteAvatarId.value = next;
      if (activeStep.value < 2) activeStep.value = 2;
    }
  },
);

watch(selectedAvatarCardItems, (items) => syncAvatarVideoCovers(items), {
  immediate: true,
});

watch(
  () => draft.manualScriptDraft,
  () => syncPublishCopyFromScript(),
);

watch(
  () => currentWorkflowScript.value,
  () => {
    buildSmartClipSubtitles(true);
    resetSmartClipResultState();
  },
);

watch(
  () => activeStep.value,
  (step) => {
    if (step === 3) {
      syncSmartClipSubtitlesFromFirstStep();
    }
  },
);

watch(
  () => smartClipCutMode.value,
  () => {
    smartClipCutPoints.value = [];
    smartClipCutApplied.value = false;
    smartClipCutSummary.value = {
      totalCount: 0,
      totalCutDuration: 0,
      originalDuration: 0,
      estimatedDuration: 0,
    };
  },
);

watch(
  [
    () => selectedVoiceId.value,
    () => currentWorkflowScript.value,
    () => voiceSourceMode.value,
    () => selectedVoiceLanguage.value,
    () => selectedVoiceEmotion.value,
    () => selectedVoicePower.value,
    () => selectedVoiceRate.value,
    () => selectedVoiceVolume.value,
  ],
  () => resetVoicePreviewState(),
);

watch(
  [() => user.token, () => user.profile?.id, () => user.profile?.email],
  () => {
    void loadRecentExtractionRecords();
  },
);

onMounted(() => {
  void loadRecentExtractionRecords();
  clearInternalPipelineScriptDraft();
  void loadRenderResources();
  void refreshDyCookieStatus();
  void refreshPipelineHealth();
  syncPublishCopyFromScript(true);
  buildSmartClipSubtitles(true);
});

onUnmounted(() => {
  clearSmartClipPollTimer();
  clearVoicePreviewProgress();
  clearVoicePreviewPolling();
  voicePreviewRequestSeq += 1;
  cancelStream();
  revokeGeneratedPreviewObjectUrls();
  clearAvatarCoverVideoUrls();
});
</script>

<template>
  <main class="video-create">
    <header class="create-topbar">
      <RouterLink :to="{ name: 'landing' }" class="back-link"
        >‹ 返回首页</RouterLink
      >
      <ol class="stepper" aria-label="视频创作步骤">
        <li
          v-for="step in steps"
          :key="step.no"
          :class="[
            'stepper__item',
            { 'stepper__item--active': step.no === activeStep },
          ]"
          @click="jumpToStep(step.no)"
        >
          <span>{{ step.no }}</span>
          <strong>{{ step.title }}</strong>
        </li>
      </ol>
      <div class="topbar-progress">
        <n-text depth="3">{{ steps[activeStep - 1]?.desc }}</n-text>
      </div>
    </header>

    <Transition name="step-switch" mode="out-in">
      <section v-if="activeStep === 1" key="step-1" class="create-layout">
        <div class="main-board">
          <h1>第一步：搞定文案</h1>

          <div class="workspace">
            <section class="panel panel--input panel--source">
              <div class="source-switch">
                <button
                  type="button"
                  class="source-switch__item"
                  :class="{
                    'source-switch__item--active': sourceMode === 'homepage',
                  }"
                  @click="sourceMode = 'homepage'"
                >
                  <span class="source-switch__icon">主</span>
                  <strong>抖音主页</strong>
                </button>
                <button
                  type="button"
                  class="source-switch__item"
                  :class="{
                    'source-switch__item--active': sourceMode === 'hotlink',
                  }"
                  @click="sourceMode = 'hotlink'"
                >
                  <span class="source-switch__icon">链</span>
                  <strong>爆款链接</strong>
                </button>
              </div>

              <div v-if="sourceMode === 'homepage'" class="benchmark-pane">
                <div class="benchmark-input-row">
                  <n-input
                    v-model:value="benchmarkHomepageUrl"
                    size="medium"
                    clearable
                    placeholder="粘贴抖音主页链接，例如 https://www.douyin.com/user/xxx"
                  />
                  <n-button
                    type="primary"
                    class="gradient-btn benchmark-submit"
                    :loading="benchmarkLearning"
                    @click="onLearnDouyinHomepage"
                  >
                    学习该对标
                  </n-button>
                </div>

                <div class="benchmark-note-row">
                  <n-text depth="3" class="helper-text helper-text--inline">
                    粘贴抖音主页链接并点击学习后，系统会自动解析账号内容并将对标对象显示在下方。
                  </n-text>
                  <n-tag
                    v-if="dyCookieConfigured === true"
                    size="small"
                    type="success"
                    :bordered="false"
                  >
                    Cookie 已配置
                  </n-tag>
                  <n-tag
                    v-else-if="dyCookieConfigured === false"
                    size="small"
                    type="warning"
                    :bordered="false"
                  >
                    Cookie 未配置
                  </n-tag>
                </div>

                <n-alert
                  v-if="benchmarkLearningHint"
                  type="info"
                  :show-icon="false"
                  style="margin-top: 14px"
                >
                  {{ benchmarkLearningHint }}
                </n-alert>

                <div
                  v-if="hasLearnedBenchmark && benchmarkProfile"
                  class="benchmark-result"
                >
                  <div class="benchmark-result__label">
                    <span class="benchmark-result__dot"></span>
                    <strong>已学习的对标对象 (1)</strong>
                  </div>

                  <button type="button" class="benchmark-card">
                    <img
                      v-if="benchmarkProfile.avatarUrl"
                      :src="benchmarkProfile.avatarUrl"
                      :alt="benchmarkProfile.nickname"
                      class="benchmark-card__avatar"
                    />
                    <div
                      v-else
                      class="benchmark-card__avatar benchmark-card__avatar--fallback"
                    >
                      {{ benchmarkProfile.nickname.slice(0, 1) }}
                    </div>

                    <div class="benchmark-card__body">
                      <div class="benchmark-card__title">
                        <n-tag size="small" :bordered="false" type="primary"
                          >抖音</n-tag
                        >
                        <strong>{{ benchmarkProfile.nickname }}</strong>
                      </div>
                      <div class="benchmark-card__stats">
                        <span
                          >{{
                            formatStatCount(benchmarkProfile.awemeCount)
                          }}
                          作品</span
                        >
                        <span
                          >{{
                            formatStatCount(benchmarkProfile.followerCount)
                          }}
                          粉丝</span
                        >
                        <span
                          >{{
                            formatStatCount(benchmarkProfile.totalFavorited)
                          }}
                          获赞</span
                        >
                      </div>
                      <p>{{ benchmarkProfile.signature }}</p>
                    </div>

                    <div class="benchmark-card__check">✓</div>
                  </button>

                  <div
                    v-if="benchmarkSamples.length"
                    class="benchmark-post-grid"
                  >
                    <article
                      v-for="sample in benchmarkSamples.slice(0, 3)"
                      :key="sample.awemeId"
                      class="benchmark-post"
                    >
                      <div class="benchmark-post__meta">
                        <strong>{{
                          sample.diggCount > 0
                            ? `${formatStatCount(sample.diggCount)} 点赞`
                            : "近期作品"
                        }}</strong>
                        <span>{{
                          formatBenchmarkSampleDate(sample.createdAt)
                        }}</span>
                      </div>
                      <p>{{ sample.title }}</p>
                    </article>
                  </div>

                  <div class="benchmark-action-row">
                    <button
                      type="button"
                      class="idea-action idea-action--primary"
                      @click="applyBenchmarkIdeaDraft('ai')"
                    >
                      大脑生成选题
                    </button>
                    <button
                      type="button"
                      class="idea-action"
                      @click="applyBenchmarkIdeaDraft('custom')"
                    >
                      自定义选题
                    </button>
                  </div>
                </div>

                <div v-else class="benchmark-empty">
                  <strong>先学习一个抖音主页</strong>
                  <p>学完后这里会展示账号卡片、近期作品线索和选题入口。</p>
                </div>
              </div>

              <div v-else class="hotlink-pane">
                <div class="panel-head panel-head--subtle">
                  <span>爆款链接输入</span>
                  <n-tag size="small" :bordered="false" type="info"
                    >保留原链路</n-tag
                  >
                </div>

                <VideoLinkInput
                  v-model="draft.videoUrl"
                  :invalid="urlInvalid"
                />

                <n-space
                  align="center"
                  :size="12"
                  style="flex-wrap: wrap; margin-top: 14px"
                >
                  <n-button
                    :disabled="!linkReady"
                    :loading="loadingMeta || douyinPipeline"
                    type="primary"
                    class="gradient-btn"
                    @click="onFetchVideoMeta"
                  >
                    提取文案
                  </n-button>
                  <n-tag
                    v-if="dyCookieConfigured === true"
                    size="small"
                    type="success"
                    :bordered="false"
                  >
                    抖音 Cookie 已配置
                  </n-tag>
                  <n-tag
                    v-else-if="dyCookieConfigured === false"
                    size="small"
                    type="warning"
                    :bordered="false"
                  >
                    抖音 Cookie 未配置
                  </n-tag>
                </n-space>

                <section class="recent-extract">
                  <div class="recent-extract__head">
                    <div>
                      <span>最近提取记录</span>
                      <strong>点击左侧视频预览复制链接</strong>
                    </div>
                    <n-tag size="small" :bordered="false" type="info">
                      {{
                        recentExtractionRecords.length
                          ? `${recentExtractionRecords.length} 条`
                          : "暂无记录"
                      }}
                    </n-tag>
                  </div>

                  <div
                    v-if="recentExtractionRecords.length"
                    class="recent-extract__list"
                  >
                    <article
                      v-for="record in recentExtractionRecords"
                      :key="record.id"
                      class="recent-extract-card"
                    >
                      <button
                        type="button"
                        class="recent-extract-card__preview"
                        title="点击复制短视频链接"
                        @click="copyRecentExtractionLink(record)"
                      >
                        <video
                          v-if="record.videoUrl"
                          :src="record.videoUrl"
                          :poster="record.coverUrl || undefined"
                          muted
                          playsinline
                          preload="metadata"
                        ></video>
                        <img
                          v-else-if="record.coverUrl"
                          :src="record.coverUrl"
                          :alt="record.title"
                          loading="lazy"
                        />
                        <span v-else class="recent-extract-card__fallback"
                          >视频</span
                        >
                        <i>复制</i>
                      </button>

                      <div class="recent-extract-card__body">
                        <div class="recent-extract-card__title">
                          <n-tag
                            size="small"
                            round
                            :bordered="false"
                            type="default"
                          >
                            {{ record.platform }}
                          </n-tag>
                          <strong>{{ record.title }}</strong>
                        </div>
                        <p>{{ record.summary }}</p>
                        <small>{{
                          formatRecentExtractionTime(record.extractedAt)
                        }}</small>
                      </div>
                    </article>
                  </div>

                  <div v-else class="recent-extract__empty">
                    提取一次爆款链接后，这里会自动保存最近记录。
                  </div>
                </section>

                <n-text
                  v-if="pipelineHealthError"
                  depth="3"
                  class="helper-text"
                >
                  {{ pipelineHealthError }}
                </n-text>

                <div class="input-actions input-actions--triple">
                  <n-button
                    v-if="canTranscribeNonDouyinUrl"
                    block
                    secondary
                    :loading="transcribeUrlLoading"
                    @click="onTranscribeNonDouyinFromUrl"
                  >
                    从当前链接转写
                  </n-button>
                  <n-button
                    v-if="lastSavedVideoBasename"
                    block
                    secondary
                    :loading="retranscribingLocal"
                    @click="onRetranscribeFromLocal"
                  >
                    从本地保存视频重转写
                  </n-button>
                </div>

                <template v-if="douyinPipeline">
                  <n-progress
                    type="line"
                    :percentage="pipelineProgress"
                    :processing="pipelineBarProcessing"
                    indicator-placement="inside"
                    style="margin-top: 18px"
                  />
                  <n-text depth="3" class="helper-text">{{
                    pipelineStatusLabel
                  }}</n-text>
                </template>

                <template v-if="draft.videoMeta">
                  <n-alert
                    v-if="draft.videoMeta.warnings.length"
                    type="warning"
                    :show-icon="false"
                    style="margin-top: 18px"
                  >
                    <div
                      v-for="(warning, index) in draft.videoMeta.warnings"
                      :key="index"
                    >
                      {{ warning }}
                    </div>
                  </n-alert>

                  <div class="meta-board">
                    <div class="meta-board__header">
                      <div>
                        <span class="meta-board__eyebrow">获取信息</span>
                        <strong>视频基础内容</strong>
                      </div>
                      <n-tag size="small" round :bordered="false" type="success"
                        >已解析</n-tag
                      >
                    </div>

                    <div class="meta-board__summary">
                      <div class="meta-chip meta-chip--title">
                        <span>标题</span>
                        <strong>{{
                          draft.videoMeta.title || "暂无标题"
                        }}</strong>
                      </div>
                      <div class="meta-chip">
                        <span>点赞</span>
                        <strong>{{
                          formatStatCount(draft.videoMeta.likeCount)
                        }}</strong>
                      </div>
                    </div>

                    <div class="meta-section">
                      <span>内容</span>
                      <p>
                        {{
                          draft.videoMeta.content ||
                          draft.videoMeta.description ||
                          "暂无可解析内容"
                        }}
                      </p>
                    </div>

                    <div class="meta-section meta-section--tags">
                      <span>标签</span>
                      <div
                        v-if="draft.videoMeta.tags?.length"
                        class="meta-tag-list"
                      >
                        <n-tag
                          v-for="(tag, index) in (
                            draft.videoMeta.tags ?? []
                          ).slice(0, 8)"
                          :key="`${tag}-${index}`"
                          size="small"
                          round
                          :bordered="false"
                        >
                          #{{ tag.replace(/^#/, "") }}
                        </n-tag>
                      </div>
                      <p v-else class="meta-empty">暂无标签</p>
                    </div>
                  </div>
                </template>
              </div>
            </section>

            <section class="panel panel--outline script-extract-panel">
              <div class="script-extract-head">
                <div class="script-extract-title">
                  <span class="script-extract-title__icon">▤</span>
                  <strong>提取的文案</strong>
                </div>
                <span class="script-extract-count"
                  >字数: {{ draft.manualScriptDraft.length }}</span
                >
              </div>

              <div class="script-extract-tip">
                <span>!</span>
                <p>提示：{{ scriptBlockHint }}</p>
              </div>
              <n-text
                v-if="isStreamingToScript"
                depth="3"
                class="helper-text helper-text--accent"
              >
                正在流式写入口播文案，点一下输入框会立刻补全全文。
              </n-text>

              <div v-if="oralScriptPolish" class="hook-preview">
                <div class="hook-preview__item">
                  <span>3s 钩子</span>
                  <strong>{{ oralScriptPolish.hook3s }}</strong>
                </div>
                <div class="hook-preview__item">
                  <span>10s 钩子</span>
                  <strong>{{ oralScriptPolish.hook10s }}</strong>
                </div>
              </div>

              <n-input
                v-model:value="draft.manualScriptDraft"
                type="textarea"
                class="outline-editor"
                :autosize="{ minRows: 8, maxRows: 8 }"
                :maxlength="50000"
                placeholder="在这里整理、改写并确认你要驱动配音的视频文案…"
                @click="interruptStreamWithFullText"
              />

              <div class="outline-footer script-extract-footer">
                <div class="script-extract-ready">
                  <span />
                  <n-text depth="3">READY TO CREATE</n-text>
                </div>
              </div>

              <div class="script-extract-actions">
                <n-button
                  class="script-extract-action script-extract-action--primary"
                  type="primary"
                  @click="onUseScriptAndNext"
                >
                  <span class="script-extract-action__icon">▦</span>
                  <span>
                    <strong>一键成片</strong>
                    <small>全自动生成</small>
                  </span>
                </n-button>
                <n-button
                  class="script-extract-action script-extract-action--secondary"
                  type="primary"
                  :loading="optimizingOralScript"
                  :disabled="!oralScriptSourceText"
                  @click="onOptimizeOralScript"
                >
                  <span class="script-extract-action__icon">✦</span>
                  <span>
                    <strong>仿写文案</strong>
                    <small>深度参考爆款逻辑</small>
                  </span>
                </n-button>
              </div>
            </section>
          </div>
        </div>

        <aside class="script-side">
          <div class="script-side__head">
            <div>
              <n-text strong>文案生成结果</n-text>
              <p>按句意自动分段</p>
            </div>
            <n-space size="small">
              <n-tag size="small" :bordered="false" type="info">
                {{
                  extractedScriptLines.length
                    ? `${extractedScriptLines.length} 段`
                    : "等待转写"
                }}
              </n-tag>
            </n-space>
          </div>

          <ol v-if="extractedScriptLines.length" class="script-list">
            <li
              v-for="(line, idx) in extractedScriptLines"
              :key="`${idx}-${line}`"
            >
              <span>{{ idx + 1 }}</span>
              <p>{{ line }}</p>
            </li>
          </ol>
          <div v-else class="empty-side">
            <strong>还没有可用文案</strong>
            <p>先抓取视频链接，或上传一段音视频来完成转写。</p>
          </div>
          <div v-if="oralScriptPolish" class="hook-side-card">
            <div class="hook-side-card__head">
              <strong>口播优化结果</strong>
              <n-space size="small">
                <n-tag size="small" :bordered="false" type="success"
                  >已生成</n-tag
                >
                <n-tag
                  size="small"
                  :bordered="false"
                  :type="oralScriptPolish.llmUsed ? 'info' : 'warning'"
                >
                  {{ oralScriptPolish.strategyLabel }}
                </n-tag>
              </n-space>
            </div>
            <div class="hook-side-card__block">
              <span>3s 钩子</span>
              <p>{{ oralScriptPolish.hook3s }}</p>
            </div>
            <div class="hook-side-card__block">
              <span>10s 钩子</span>
              <p>{{ oralScriptPolish.hook10s }}</p>
            </div>
          </div>
        </aside>
      </section>

      <section
        v-else-if="activeStep === 2"
        key="step-2"
        class="step-two-layout"
      >
        <div class="step-two-head">
          <h1>第二步：数字人对口型</h1>
          <p>把文案、克隆声音、数字人视频放在同一屏确认，先试听再进入成片。</p>
        </div>

        <div class="step-two-workbench">
          <section class="panel step-two-script-panel">
            <div class="step-two-block-head">
              <div class="step-two-block-head__main">
                <span class="step-two-block-icon">T</span>
                <div>
                  <strong>口播文案</strong>
                  <p>可手动修改</p>
                </div>
              </div>
              <n-tag size="small" :bordered="false" type="info">
                {{
                  extractedScriptLines.length
                    ? `${extractedScriptLines.length} 段`
                    : "等待文案"
                }}
              </n-tag>
            </div>

            <div class="step-two-script-meta">
              <span>文案预览</span>
              <strong>{{ currentWorkflowScript.length }} / 50000</strong>
            </div>

            <div
              v-if="extractedScriptLines.length"
              class="step-two-script-frame"
            >
              <div class="step-two-script-scroll">
                <ol class="step-two-script-list">
                  <li
                    v-for="(line, idx) in extractedScriptLines"
                    :key="`${idx}-${line}`"
                    class="step-two-script-line"
                  >
                    <span>{{ String(idx + 1).padStart(2, "0") }}</span>
                    <p>{{ line }}</p>
                  </li>
                </ol>
              </div>
            </div>
            <div
              v-else
              class="step-two-script-frame step-two-script-frame--empty"
            >
              <div class="empty-block empty-block--embedded">
                <strong>还没有可承接的文案</strong>
                <p>先回到第一步抓取或整理一份口播文案。</p>
              </div>
            </div>

            <div v-if="oralScriptPolish" class="step-two-hook-row">
              <article class="step-two-hook-card">
                <span>3s 钩子</span>
                <strong>{{ oralScriptPolish.hook3s }}</strong>
              </article>
              <article class="step-two-hook-card">
                <span>10s 钩子</span>
                <strong>{{ oralScriptPolish.hook10s }}</strong>
              </article>
            </div>

            <div class="step-two-footnote">
              <span>当前文案会直接用于生成音轨和对口型，暂不叠加字幕。</span>
              <n-button
                class="step-two-footnote__action"
                text
                type="primary"
                @click="jumpToStep(1)"
                >返回第一步修改</n-button
              >
            </div>
          </section>

          <section class="panel step-two-voice-panel">
            <div class="step-two-block-head">
              <div class="step-two-block-head__main">
                <span class="step-two-block-icon step-two-block-icon--voice"
                  >声</span
                >
                <div>
                  <strong>配音设置</strong>
                  <p>选择声音来源</p>
                </div>
              </div>
              <n-space size="small">
                <n-button
                  secondary
                  type="primary"
                  size="small"
                  @click="cloneVoiceOpen = true"
                >
                  + 声音克隆
                </n-button>
                <n-button
                  quaternary
                  type="primary"
                  size="small"
                  @click="goToResourceLibrary('voices')"
                >
                  音色库
                </n-button>
              </n-space>
            </div>

            <div class="voice-source-switch">
              <button
                type="button"
                class="voice-source-switch__item"
                :class="{
                  'voice-source-switch__item--active':
                    voiceSourceMode === 'tts',
                }"
                @click="voiceSourceMode = 'tts'"
              >
                文本转语音
              </button>
              <button
                type="button"
                class="voice-source-switch__item"
                :class="{
                  'voice-source-switch__item--active':
                    voiceSourceMode === 'local',
                }"
                @click="voiceSourceMode = 'local'"
              >
                本地语音
              </button>
            </div>

            <template v-if="voiceSourceMode === 'tts'">
              <div ref="voiceShellRef" class="step-two-voice-shell">
                <div class="step-two-control-grid">
                  <article class="step-two-control-card">
                    <span>选择音色</span>
                    <div class="step-two-control-card__main">
                      <button
                        v-if="selectedVoiceResource?.audioUrl"
                        type="button"
                        class="voice-sample-play"
                        @click="
                          toggleAudioPlayback(
                            `voice-sample:${selectedVoiceResource?.id ?? ''}`,
                            resolveProtectedMediaUrl(
                              selectedVoiceResource?.audioUrl ?? '',
                            ),
                          )
                        "
                      >
                        {{
                          audioPlayingId ===
                          `voice-sample:${selectedVoiceResource?.id ?? ""}`
                            ? "停"
                            : "播"
                        }}
                      </button>
                      <n-select
                        v-model:value="selectedVoiceId"
                        :options="voiceOptions"
                        :loading="renderResourceLoading"
                        placeholder="选择一个克隆音色"
                      />
                    </div>
                    <small>{{
                      selectedVoiceResource?.owner === "mine"
                        ? "我的克隆音色"
                        : "推荐音色"
                    }}</small>
                  </article>

                  <article class="step-two-control-card">
                    <span>选择语言</span>
                    <div class="step-two-control-card__main">
                      <n-select
                        v-model:value="selectedVoiceLanguage"
                        :options="voiceLanguageOptions"
                        placeholder="选择语言"
                      />
                    </div>
                    <small>当前只影响配音配置，不会改动原文案。</small>
                  </article>

                  <article class="step-two-control-card">
                    <span>情绪</span>
                    <div class="step-two-control-card__main">
                      <n-select
                        v-model:value="selectedVoiceEmotion"
                        :options="voiceEmotionOptions"
                        placeholder="选择情绪"
                      />
                    </div>
                    <small>建议和数字人口型风格保持一致。</small>
                  </article>

                  <article class="step-two-control-card">
                    <span>强度</span>
                    <div class="voice-power-stepper">
                      <button type="button" @click="nudgeVoicePower(-0.03)">
                        -
                      </button>
                      <strong>{{ selectedVoicePower.toFixed(2) }}</strong>
                      <button type="button" @click="nudgeVoicePower(0.03)">
                        +
                      </button>
                    </div>
                    <small>更高的强度会让播报更有存在感。</small>
                  </article>
                </div>

                <div class="step-two-slider-grid">
                  <article class="step-two-slider-card">
                    <div class="step-two-slider-card__head">
                      <span>语速调节</span>
                      <strong>{{ selectedVoiceRate.toFixed(2) }}</strong>
                    </div>
                    <n-slider
                      v-model:value="selectedVoiceRate"
                      :min="0.5"
                      :max="1.5"
                      :step="0.01"
                    />
                  </article>
                  <article class="step-two-slider-card">
                    <div class="step-two-slider-card__head">
                      <span>音量调节</span>
                      <strong>{{ selectedVoiceVolume.toFixed(2) }}</strong>
                    </div>
                    <n-slider
                      v-model:value="selectedVoiceVolume"
                      :min="0.6"
                      :max="1.4"
                      :step="0.01"
                    />
                  </article>
                </div>

                <n-alert
                  v-if="!hasVoiceOptions"
                  class="step-two-inline-alert"
                  type="warning"
                  :show-icon="false"
                >
                  还没有可用的克隆音色，先上传一段样本音频，我会自动刷新当前列表。
                </n-alert>

                <n-alert
                  v-else-if="voicePreviewBlockReason"
                  class="step-two-inline-alert"
                  type="warning"
                  :show-icon="false"
                >
                  {{ voicePreviewBlockReason }}
                </n-alert>

                <button
                  type="button"
                  class="step-two-primary-btn"
                  :disabled="
                    Boolean(voicePreviewBlockReason) || voicePreviewLoading
                  "
                  :title="voicePreviewBlockReason || undefined"
                  @click="onGenerateVoicePreview"
                >
                  {{ voicePreviewLoading ? "正在生成音频..." : "生成音频" }}
                </button>

                <Transition name="voice-progress">
                  <article
                    v-if="voicePreviewLoading || voicePreviewProgress > 0"
                    class="voice-generate-progress"
                    :class="{
                      'voice-generate-progress--done':
                        voicePreviewProgress >= 100,
                    }"
                  >
                    <div class="voice-generate-progress__head">
                      <span>生成进度</span>
                      <strong>{{ Math.round(voicePreviewProgress) }}%</strong>
                    </div>
                    <div class="voice-generate-progress__bar">
                      <i :style="{ width: `${voicePreviewProgress}%` }"></i>
                    </div>
                    <p>{{ voicePreviewProgressLabel }}</p>
                  </article>
                </Transition>

                <article
                  v-if="hasVoicePreviewOutput"
                  class="voice-preview-card"
                  :class="{
                    'voice-preview-card--ready':
                      voicePreviewTaskStatus === 'ready',
                  }"
                >
                  <div class="voice-preview-card__head">
                    <div>
                      <strong>{{ voicePreviewStateTitle }}</strong>
                      <p>{{ voicePreviewStateHint }}</p>
                    </div>
                    <n-tag
                      v-if="voicePreviewMode"
                      size="small"
                      :bordered="false"
                      :type="
                        voicePreviewMode === 'provider' ? 'success' : 'warning'
                      "
                    >
                      {{ voicePreviewMode === "provider" ? "RESULT" : "MOCK" }}
                    </n-tag>
                  </div>

                  <div class="voice-preview-card__player">
                    <button
                      type="button"
                      class="voice-preview-card__play"
                      :disabled="!voicePreviewUrl"
                      @click="
                        voicePreviewUrl &&
                        toggleAudioPlayback(
                          'voice-preview',
                          resolveProtectedMediaUrl(voicePreviewUrl),
                        )
                      "
                    >
                      {{ audioPlayingId === "voice-preview" ? "暂停" : "试听" }}
                    </button>
                    <div>
                      <strong>{{ selectedVoiceLabel }}</strong>
                      <p>
                        {{ formatSecondsClock(voicePreviewDurationSeconds) }}
                      </p>
                    </div>
                    <n-button
                      quaternary
                      size="small"
                      type="primary"
                      :disabled="!voicePreviewUrl"
                      @click="onDownloadVoicePreview"
                    >
                      下载
                    </n-button>
                  </div>
                </article>
              </div>
            </template>

            <div v-else class="voice-local-pane step-two-voice-shell">
              <n-alert type="info" :show-icon="false">
                本地语音模式用于直接管理你上传的克隆样本，选中的声音会继续参与后面的对口型生成。
              </n-alert>
              <div class="step-two-control-grid">
                <article class="step-two-control-card">
                  <span>当前克隆声音</span>
                  <div class="step-two-control-card__main">
                    <n-select
                      v-model:value="selectedVoiceId"
                      :options="voiceOptions"
                      :loading="renderResourceLoading"
                      placeholder="选择一个本地克隆声音"
                    />
                  </div>
                  <small>{{ selectedVoiceLabel }}</small>
                </article>
              </div>
              <div class="step-two-footnote">
                <span>如果样本还没上传，可以直接从这里继续补充。</span>
                <n-button text type="primary" @click="cloneVoiceOpen = true"
                  >添加克隆样本</n-button
                >
              </div>
            </div>
          </section>

          <section class="panel step-two-avatar-panel">
            <div class="step-two-block-head">
              <div class="step-two-block-head__main">
                <span class="step-two-block-icon step-two-block-icon--avatar"
                  >人</span
                >
                <div>
                  <strong>选数字人</strong>
                  <p>最多选 7 位</p>
                </div>
              </div>
              <n-space size="small">
                <n-button
                  secondary
                  type="primary"
                  size="small"
                  @click="createAvatarOpen = true"
                >
                  + 新建数字人
                </n-button>
                <n-button
                  quaternary
                  type="primary"
                  size="small"
                  @click="onProceedFromStepTwo"
                >
                  口型绑定
                </n-button>
              </n-space>
            </div>

            <div
              v-if="hasSelectedAvatarCards"
              class="avatar-strip avatar-strip--filled"
            >
              <button
                type="button"
                class="avatar-add-card avatar-add-card--compact"
                @click="createAvatarOpen = true"
              >
                <strong>+</strong>
                <span>添加</span>
              </button>

              <div
                v-for="item in selectedAvatarCardItems"
                :key="item.id"
                class="avatar-select-card"
                :class="{
                  'avatar-select-card--active': selectedAvatarId === item.id,
                }"
                role="button"
                tabindex="0"
                :aria-pressed="selectedAvatarId === item.id"
                @click="selectAvatarForCurrentCreation(item.id)"
                @keydown.enter.prevent="selectAvatarForCurrentCreation(item.id)"
                @keydown.space.prevent="selectAvatarForCurrentCreation(item.id)"
              >
                <button
                  type="button"
                  class="avatar-select-card__remove"
                  aria-label="移除数字人"
                  @click.stop="removeAvatarFromCurrentCreation(item.id)"
                >
                  ×
                </button>
                <img
                  v-if="resolveAvatarCoverImageUrl(item)"
                  class="avatar-select-card__image"
                  :src="resolveAvatarCoverImageUrl(item)"
                  :alt="item.name"
                />
                <video
                  v-else-if="resolveAvatarCoverVideoUrl(item)"
                  class="avatar-select-card__video"
                  :src="resolveAvatarCoverVideoUrl(item)"
                  muted
                  playsinline
                  preload="metadata"
                />
                <div v-else class="avatar-select-card__placeholder">
                  {{ item.name.slice(0, 1) }}
                </div>
                <strong class="avatar-select-card__name">{{
                  item.name
                }}</strong>
              </div>
            </div>
            <div v-else class="avatar-empty-state">
              <button
                type="button"
                class="avatar-add-card avatar-add-card--empty"
                @click="createAvatarOpen = true"
              >
                <strong>+</strong>
                <span>添加</span>
              </button>
              <p class="avatar-empty-state__hint">
                当前创作还没有添加数字人，点击添加可从服务器视频创建一条出镜素材。
              </p>
            </div>

            <n-alert
              v-if="false"
              class="step-two-inline-alert"
              type="warning"
              :show-icon="false"
            >
              当前还没有已上传的视频数字人，先直接在这里添加一条出镜视频即可。
            </n-alert>

            <n-alert
              v-if="requestedAvatarUnavailable && hasAvatarOptions"
              class="step-two-inline-alert"
              type="info"
              :show-icon="false"
            >
              你从资源库带过来的数字人暂时不可用，我先帮你落回了当前可用的视频素材。
            </n-alert>

            <article class="lip-sync-setup-card">
              <div class="lip-sync-setup-card__tabs">
                <button
                  type="button"
                  class="lip-sync-setup-card__tab"
                  :class="{
                    'lip-sync-setup-card__tab--active':
                      renderModelChoice === 'new',
                  }"
                  @click="renderModelChoice = 'new'"
                >
                  <strong>新锐模型</strong>
                  <span>速度快 · 效果自然</span>
                </button>
                <button
                  type="button"
                  class="lip-sync-setup-card__tab"
                  :class="{
                    'lip-sync-setup-card__tab--active':
                      renderModelChoice === 'classic',
                  }"
                  @click="renderModelChoice = 'classic'"
                >
                  <strong>经典模型</strong>
                  <span>画面细腻 · 稳定性佳</span>
                </button>
              </div>

              <div class="lip-sync-setup-card__resolution">
                <span>生成画质</span>
                <div>
                  <button
                    type="button"
                    class="resolution-chip"
                    :class="{
                      'resolution-chip--active':
                        renderResolutionChoice === '1080p',
                    }"
                    @click="renderResolutionChoice = '1080p'"
                  >
                    1080P 极速·推荐
                  </button>
                  <button
                    type="button"
                    class="resolution-chip"
                    :class="{
                      'resolution-chip--active':
                        renderResolutionChoice === '2k',
                    }"
                    @click="renderResolutionChoice = '2k'"
                  >
                    2k 超清
                  </button>
                </div>
              </div>

              <div class="lip-sync-setup-card__summary">
                <div class="summary-pill">
                  <span>已选数字人</span>
                  <strong>{{ selectedAvatarLabel }}</strong>
                </div>
                <div class="summary-pill">
                  <span>已选声音</span>
                  <strong>{{ selectedVoiceLabel }}</strong>
                </div>
              </div>

              <n-alert
                v-if="stepTwoGenerateBlockReason"
                class="step-two-inline-alert"
                type="warning"
                :show-icon="false"
              >
                {{ stepTwoGenerateBlockReason }}
              </n-alert>

              <button
                type="button"
                class="step-two-primary-btn step-two-primary-btn--video"
                :disabled="Boolean(stepTwoGenerateBlockReason)"
                :title="stepTwoGenerateBlockReason || undefined"
                @click="onProceedFromStepTwo"
              >
                立即生成口播视频
              </button>

              <button
                type="button"
                class="step-two-ghost-btn"
                @click="jumpToStep(3)"
              >
                查看结果
              </button>
            </article>
          </section>
        </div>
      </section>

      <StepThreeSmartEdit
        v-else-if="activeStep === 3"
        key="step-3"
        :subtitle-template-cover-url="selectedSubtitleTemplateCoverUrl"
        :subtitle-template-label="selectedSubtitleTemplateLabel"
        :avatar-cover-url="selectedAvatarCoverUrl"
        :storyboard-thumbnail-url="selectedAvatarCoverUrl"
        :title-lines="smartClipTitleLines"
        :cut-breath-enabled="smartClipCutBreathEnabled"
        :cut-mode="smartClipCutMode"
        :cut-summary="smartClipCutSummary"
        :pip-enabled="smartClipPipEnabled"
        :background-music-enabled="smartClipBackgroundMusicEnabled"
        :background-music-id="smartClipBackgroundMusicId"
        :background-music-volume="smartClipBackgroundMusicVolume"
        :subtitles="smartClipSubtitles"
        :text-subtitles-enabled="smartClipTextSubtitlesEnabled"
        :rendering="smartClipRendering"
        :final-video-url="subtitleWorkflowFinalUrl"
        :result-hint="
          subtitleWorkflowHint ||
          smartClipRenderBlockReason ||
          workflowProgressState.hint
        "
        :render-disabled-reason="smartClipRenderBlockReason"
        @update:title-lines="smartClipTitleLines = $event"
        @update:cut-breath-enabled="smartClipCutBreathEnabled = $event"
        @update:cut-mode="smartClipCutMode = $event"
        @update:pip-enabled="smartClipPipEnabled = $event"
        @update:background-music-enabled="
          smartClipBackgroundMusicEnabled = $event
        "
        @update:background-music-id="smartClipBackgroundMusicId = $event"
        @update:background-music-volume="
          smartClipBackgroundMusicVolume = $event
        "
        @update:text-subtitles-enabled="smartClipTextSubtitlesEnabled = $event"
        @update:subtitles="smartClipSubtitles = $event"
        @toggle-highlight="toggleSmartClipSubtitleHighlight"
        @shuffle-title="shuffleSmartClipTitle"
        @clear-subtitles="clearSmartClipSubtitles"
        @pull-subtitles="buildSmartClipSubtitles(true)"
        @restore-subtitles="buildSmartClipSubtitles(true)"
        @confirm-subtitles="confirmSmartClipSubtitles"
        @render="onRenderSmartClipFinal"
        @delete-video="subtitleWorkflowFinalUrl = null"
        @change-video="onRenderSmartClipFinal"
        @previous="goPrev"
        @next="goNext"
      />

      <section
        v-else-if="false && activeStep === 3"
        key="step-3-legacy"
        class="edit-layout smart-clip-layout"
      >
        <div class="smart-editor-shell">
          <div class="smart-editor-main">
            <header class="smart-editor-head">
              <h1>第三步：智能剪辑</h1>
              <span
                >建议顺序：字幕模板 → 标题 → 剪气口 → 画中画 → 背景音乐 →
                文字字幕</span
              >
            </header>

            <section class="smart-editor-left">
              <div class="smart-left-section-title">
                <span class="smart-left-icon">T</span>
                <div>
                  <strong>视频字幕样式</strong>
                  <p>选择符合视频风格的字幕排版与动效</p>
                </div>
              </div>

              <article class="smart-style-card">
                <div class="smart-style-cover">
                  <img
                    v-if="selectedSubtitleTemplateCover"
                    :src="
                      resolveProtectedMediaUrl(selectedSubtitleTemplateCover)
                    "
                    alt="字幕模板封面"
                  />
                  <div v-else class="smart-style-cover__empty">字幕</div>
                </div>
                <div class="smart-style-info">
                  <span>当前样式</span>
                  <button type="button" class="smart-style-name">
                    {{ selectedSubtitleTemplateLabel }}
                    <i>⌄</i>
                  </button>
                  <label>视频标题</label>
                  <div class="smart-title-row">
                    <input v-model="smartClipTitleLines[0]" type="text" />
                    <button type="button" @click="shuffleSmartClipTitle">
                      换一个
                    </button>
                  </div>
                  <input
                    v-model="smartClipTitleLines[1]"
                    class="smart-title-input"
                    type="text"
                  />
                </div>
                <button type="button" class="smart-template-change">
                  更换模板
                </button>
              </article>

              <div class="smart-option-list">
                <div class="smart-option-row">
                  <div>
                    <span class="smart-option-icon">⌘</span>
                    <strong>剪辑气口</strong>
                  </div>
                  <button
                    type="button"
                    class="smart-switch"
                    :class="{ 'smart-switch--on': smartClipCutBreathEnabled }"
                    @click="
                      smartClipCutBreathEnabled = !smartClipCutBreathEnabled
                    "
                  />
                </div>
                <div v-if="smartClipCutBreathEnabled" class="smart-cut-inline">
                  <button
                    v-for="mode in smartClipCutModeOptions"
                    :key="mode.value"
                    type="button"
                    :class="{ active: smartClipCutMode === mode.value }"
                    @click="smartClipCutMode = mode.value"
                  >
                    {{ mode.label }}
                  </button>
                  <span>
                    {{ smartClipCutSummary.totalCount }} 个气口 · 压缩
                    {{
                      formatSmartClipSeconds(
                        smartClipCutSummary.totalCutDuration,
                      )
                    }}
                  </span>
                </div>

                <div class="smart-option-row">
                  <div>
                    <span class="smart-option-icon">▣</span>
                    <strong>分镜素材</strong>
                  </div>
                  <button
                    type="button"
                    class="smart-switch"
                    :class="{ 'smart-switch--on': smartClipPipEnabled }"
                    @click="smartClipPipEnabled = !smartClipPipEnabled"
                  />
                </div>
                <div v-if="smartClipPipEnabled" class="smart-pip-strip">
                  <button type="button" class="smart-pip-add">
                    <span>＋</span>
                    <b>添加</b>
                  </button>
                  <div class="smart-pip-thumb">
                    <img
                      v-if="selectedAvatarCoverUrl"
                      :src="selectedAvatarCoverUrl"
                      alt="分镜素材"
                    />
                    <span v-else>素材</span>
                  </div>
                  <button type="button" class="smart-pip-config">配置 ›</button>
                </div>

                <div class="smart-option-row">
                  <div>
                    <span class="smart-option-icon">≋</span>
                    <strong>背景音乐</strong>
                  </div>
                  <button
                    type="button"
                    class="smart-switch"
                    :class="{
                      'smart-switch--on': smartClipBackgroundMusicEnabled,
                    }"
                    @click="
                      smartClipBackgroundMusicEnabled =
                        !smartClipBackgroundMusicEnabled
                    "
                  />
                </div>
                <div class="smart-music-row">
                  <button type="button" class="smart-play-dot">▶</button>
                  <select v-model="smartClipBackgroundMusicId">
                    <option value="cozy_vibes">Cozy Vibes</option>
                    <option value="clean_beat">Clean Beat</option>
                    <option value="soft_flow">Soft Flow</option>
                  </select>
                  <span>↥</span>
                  <input
                    v-model.number="smartClipBackgroundMusicVolume"
                    type="range"
                    min="0"
                    max="0.5"
                    step="0.01"
                  />
                  <b>{{ smartClipBackgroundMusicVolume.toFixed(2) }}</b>
                </div>
              </div>
            </section>

            <section class="smart-subtitle-workbench">
              <div class="smart-subtitle-head">
                <div>
                  <i></i>
                  <strong>字幕编辑</strong>
                  <span>支持划重点</span>
                </div>
                <div class="smart-subtitle-actions">
                  <label>
                    启用
                    <button
                      type="button"
                      class="smart-mini-switch"
                      :class="{
                        'smart-mini-switch--on': smartClipTextSubtitlesEnabled,
                      }"
                      @click="
                        smartClipTextSubtitlesEnabled =
                          !smartClipTextSubtitlesEnabled
                      "
                    />
                  </label>
                  <button
                    type="button"
                    class="danger"
                    @click="clearSmartClipSubtitles"
                  >
                    清空
                  </button>
                  <button type="button" @click="buildSmartClipSubtitles(true)">
                    拉取
                  </button>
                  <button type="button" @click="buildSmartClipSubtitles(true)">
                    还原
                  </button>
                  <button
                    type="button"
                    class="success"
                    @click="confirmSmartClipSubtitles"
                  >
                    已确认
                  </button>
                </div>
              </div>

              <div class="smart-line-editor">
                <div
                  v-for="(subtitle, index) in smartClipSubtitles"
                  :key="subtitle.id"
                  class="smart-line-row"
                >
                  <span>{{ String(index + 1).padStart(2, "0") }}</span>
                  <textarea v-model="subtitle.text" rows="1" />
                  <button
                    type="button"
                    :class="{ active: subtitle.highlightRanges?.length }"
                    @click="toggleSmartClipSubtitleHighlight(subtitle)"
                  >
                    重点
                  </button>
                </div>
                <div v-if="!smartClipSubtitles.length" class="smart-line-empty">
                  暂无字幕，请点击“拉取”从当前文案生成字幕行。
                </div>
              </div>

              <button
                type="button"
                class="smart-main-render"
                :disabled="smartClipRendering"
                @click="onRenderSmartClipFinal"
              >
                {{
                  subtitleWorkflowFinalUrl
                    ? "重新剪辑"
                    : smartClipRendering
                      ? `正在生成成片 ${workflowProgressState.percent}%`
                      : "立即剪辑"
                }}
                <span>↻</span>
              </button>
            </section>
          </div>

          <aside class="smart-result-panel">
            <div class="smart-result-head">
              <div>
                <span>▷</span>
                <strong>生成结果</strong>
              </div>
              <div class="smart-result-actions">
                <button
                  type="button"
                  class="danger"
                  @click="subtitleWorkflowFinalUrl = null"
                >
                  删除视频
                </button>
                <button type="button" @click="onRenderSmartClipFinal">
                  更换视频
                </button>
                <a
                  :class="{ disabled: !subtitleWorkflowFinalUrl }"
                  :href="subtitleWorkflowFinalUrl || undefined"
                  download="final-video.mp4"
                >
                  下载
                </a>
              </div>
            </div>

            <div class="smart-phone-result">
              <video
                v-if="subtitleWorkflowFinalUrl"
                :src="subtitleWorkflowFinalUrl || undefined"
                controls
                playsinline
                preload="metadata"
              />
              <div v-else class="smart-phone-placeholder">
                <img
                  v-if="selectedAvatarCoverUrl"
                  :src="selectedAvatarCoverUrl"
                  alt="数字人封面"
                />
                <div class="smart-phone-copy">
                  <strong>{{ smartClipTitleLines[0] }}</strong>
                  <b>{{ smartClipTitleLines[1] }}</b>
                  <span>点击立即剪辑后，这里展示最终成片结果</span>
                </div>
              </div>
            </div>

            <div class="smart-result-status">
              <div class="workflow-progress-track smart-result-track">
                <i :style="{ width: `${workflowProgressState.percent}%` }"></i>
              </div>
              <span>{{
                subtitleWorkflowHint || workflowProgressState.hint
              }}</span>
            </div>
          </aside>
        </div>

        <div v-if="false" class="smart-clip-stage">
          <div class="smart-clip-hero">
            <div>
              <span class="smart-clip-kicker">SMART EDIT</span>
              <h1>第三步：智能剪辑</h1>
              <p>
                字幕模板 → 标题 → 剪辑气口 → 画中画 → 背景音乐 → 文字字幕 →
                立即剪辑
              </p>
            </div>
            <div class="smart-clip-status-pill">
              <span>{{ workflowProgressState.status }}</span>
              <strong>{{ workflowProgressState.percent }}%</strong>
            </div>
          </div>

          <div class="smart-clip-grid">
            <section class="panel smart-clip-card smart-clip-card--template">
              <div class="section-title section-title--between">
                <div class="section-title__main">
                  <span class="title-icon">字</span>
                  <div>
                    <strong>字幕模板选择</strong>
                    <p>选择最终烧录到成片里的字幕样式。</p>
                  </div>
                </div>
                <n-tag size="small" :bordered="false">
                  {{ selectedSubtitleTemplateId ? "已选择" : "待选择" }}
                </n-tag>
              </div>
              <div class="smart-template-list">
                <button
                  v-for="template in subtitleTemplateItems"
                  :key="template.id"
                  type="button"
                  class="smart-template-option"
                  :class="{
                    'smart-template-option--active':
                      selectedSubtitleTemplateId === template.id,
                  }"
                  @click="selectedSubtitleTemplateId = template.id"
                >
                  <strong>{{ template.name }}</strong>
                  <span>{{
                    template.recommended ? "推荐模板" : "我的模板"
                  }}</span>
                </button>
                <div
                  v-if="!subtitleTemplateItems.length"
                  class="smart-empty-note"
                >
                  暂无字幕模板，请先在素材库确认模板。
                </div>
              </div>
            </section>

            <section class="panel smart-clip-card smart-clip-card--cut">
              <div class="section-title section-title--between">
                <div class="section-title__main">
                  <span class="title-icon">剪</span>
                  <div>
                    <strong>剪辑气口</strong>
                    <p>
                      自动识别视频中的停顿、空白和喘气间隔，并在最终成片中压缩这些片段。
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  class="smart-toggle"
                  :class="{ 'smart-toggle--active': smartClipCutBreathEnabled }"
                  @click="
                    smartClipCutBreathEnabled = !smartClipCutBreathEnabled
                  "
                >
                  {{ smartClipCutBreathEnabled ? "开启" : "关闭" }}
                </button>
              </div>

              <div class="smart-mode-grid">
                <button
                  v-for="mode in smartClipCutModeOptions"
                  :key="mode.value"
                  type="button"
                  class="smart-mode-card"
                  :class="{
                    'smart-mode-card--active': smartClipCutMode === mode.value,
                  }"
                  @click="smartClipCutMode = mode.value"
                >
                  <strong>{{ mode.label }}</strong>
                  <span>{{ mode.desc }}</span>
                </button>
              </div>

              <div class="smart-cut-summary">
                <div>
                  <span>气口数量</span>
                  <strong>{{ smartClipCutSummary.totalCount }}</strong>
                </div>
                <div>
                  <span>预计压缩</span>
                  <strong>{{
                    formatSmartClipSeconds(smartClipCutSummary.totalCutDuration)
                  }}</strong>
                </div>
                <div>
                  <span>原视频</span>
                  <strong>{{
                    formatSmartClipSeconds(smartClipCutSummary.originalDuration)
                  }}</strong>
                </div>
                <div>
                  <span>预计成片</span>
                  <strong>{{
                    formatSmartClipSeconds(
                      smartClipCutSummary.estimatedDuration,
                    )
                  }}</strong>
                </div>
              </div>

              <div class="smart-cut-actions">
                <n-button
                  secondary
                  :loading="smartClipCutDetecting"
                  :disabled="!smartClipCutBreathEnabled || !selectedAvatarId"
                  @click="() => onDetectSmartClipCutPoints()"
                >
                  重新检测气口
                </n-button>
                <n-button
                  type="primary"
                  secondary
                  :disabled="!smartClipCutPoints.length"
                  @click="onApplySmartClipCutSuggestions"
                >
                  {{ smartClipCutApplied ? "已应用建议" : "应用剪辑建议" }}
                </n-button>
              </div>
            </section>

            <section class="panel smart-clip-card smart-clip-card--config">
              <div class="section-title">
                <span class="title-icon">设</span>
                <div>
                  <strong>成片配置</strong>
                  <p>画中画、背景音乐和文字字幕会随最终成片任务一起提交。</p>
                </div>
              </div>
              <div class="smart-config-list">
                <button
                  type="button"
                  class="smart-config-item"
                  :class="{ 'smart-config-item--active': smartClipPipEnabled }"
                  @click="smartClipPipEnabled = !smartClipPipEnabled"
                >
                  <strong>画中画 / 分镜素材</strong>
                  <span>{{ smartClipPipEnabled ? "已开启" : "未开启" }}</span>
                </button>
                <button
                  type="button"
                  class="smart-config-item"
                  :class="{
                    'smart-config-item--active':
                      smartClipBackgroundMusicEnabled,
                  }"
                  @click="
                    smartClipBackgroundMusicEnabled =
                      !smartClipBackgroundMusicEnabled
                  "
                >
                  <strong>背景音乐</strong>
                  <span>{{
                    smartClipBackgroundMusicEnabled ? "轻音乐 10%" : "未开启"
                  }}</span>
                </button>
                <button
                  type="button"
                  class="smart-config-item"
                  :class="{
                    'smart-config-item--active': smartClipTextSubtitlesEnabled,
                  }"
                  @click="
                    smartClipTextSubtitlesEnabled =
                      !smartClipTextSubtitlesEnabled
                  "
                >
                  <strong>文字字幕</strong>
                  <span>{{
                    smartClipTextSubtitlesEnabled ? "最终烧录" : "不烧录"
                  }}</span>
                </button>
              </div>
            </section>

            <section class="panel smart-clip-card smart-subtitle-editor">
              <div class="section-title section-title--between">
                <div class="section-title__main">
                  <span class="title-icon">编</span>
                  <div>
                    <strong>字幕编辑</strong>
                    <p>这里只编辑最终成片的字幕时间轴，不再做实时视频预览。</p>
                  </div>
                </div>
                <n-tag size="small" :bordered="false"
                  >{{ smartClipSubtitles.length }} 段</n-tag
                >
              </div>

              <div class="smart-subtitle-table">
                <div class="smart-subtitle-row smart-subtitle-row--head">
                  <span>时间轴</span>
                  <span>字幕内容</span>
                  <span>高亮</span>
                </div>
                <div
                  v-for="subtitle in smartClipSubtitles"
                  :key="subtitle.id"
                  class="smart-subtitle-row"
                >
                  <div class="smart-time-fields">
                    <input
                      v-model.number="subtitle.startTime"
                      type="number"
                      min="0"
                      step="0.1"
                    />
                    <b>-</b>
                    <input
                      v-model.number="subtitle.endTime"
                      type="number"
                      min="0"
                      step="0.1"
                    />
                  </div>
                  <n-input
                    v-model:value="subtitle.text"
                    type="textarea"
                    :autosize="{ minRows: 1, maxRows: 3 }"
                    placeholder="输入字幕文案"
                  />
                  <button
                    type="button"
                    class="smart-highlight-btn"
                    :class="{
                      'smart-highlight-btn--active':
                        subtitle.highlightRanges?.length,
                    }"
                    @click="toggleSmartClipSubtitleHighlight(subtitle)"
                  >
                    {{
                      subtitle.highlightRanges?.length ? "已高亮" : "高亮前4字"
                    }}
                  </button>
                </div>
                <div v-if="!smartClipSubtitles.length" class="smart-empty-note">
                  暂无字幕，请先回到第一步补全文案。
                </div>
              </div>
            </section>
          </div>

          <footer class="smart-clip-footer">
            <n-button secondary @click="jumpToStep(2)">上一步</n-button>
            <div class="smart-render-progress">
              <div class="workflow-progress-track smart-render-progress__track">
                <i :style="{ width: `${workflowProgressState.percent}%` }"></i>
              </div>
              <span>{{
                subtitleWorkflowHint || workflowProgressState.hint
              }}</span>
            </div>
            <n-button
              type="primary"
              class="gradient-btn smart-render-btn"
              :loading="smartClipRendering"
              :disabled="smartClipRendering"
              @click="onRenderSmartClipFinal"
            >
              {{
                subtitleWorkflowFinalUrl
                  ? "重新剪辑"
                  : smartClipRendering
                    ? `正在生成成片... ${workflowProgressState.percent}%`
                    : "立即剪辑"
              }}
            </n-button>
            <a
              v-if="subtitleWorkflowFinalUrl"
              class="smart-download-btn"
              :href="subtitleWorkflowFinalUrl ?? undefined"
              download="final-video.mp4"
            >
              下载成片
            </a>
          </footer>
        </div>

        <div v-if="false" class="edit-main">
          <h1>第三步：一键成片</h1>

          <section class="panel asset-card">
            <div class="section-title">
              <span class="title-icon">设</span>
              <div>
                <strong>生成参数</strong>
                <p>确认完整文案和素材来源</p>
              </div>
            </div>

            <div class="summary-stack step-three-summary">
              <div class="summary-pill">
                <span>数字人</span>
                <strong class="compact-label" :title="selectedAvatarLabel">{{
                  selectedAvatarLabel
                }}</strong>
              </div>
              <div class="summary-pill">
                <span>音色</span>
                <strong class="compact-label" :title="selectedVoiceLabel">{{
                  selectedVoiceLabel
                }}</strong>
              </div>
            </div>

            <div class="workflow-action-card">
              <div class="input-actions input-actions--triple">
                <n-button block secondary @click="jumpToStep(2)"
                  >返回检查素材</n-button
                >
                <n-button
                  block
                  type="primary"
                  class="gradient-btn"
                  :disabled="
                    !currentWorkflowScript ||
                    !selectedAvatarId ||
                    !selectedVoiceId ||
                    subtitleWorkflowPreviewLoading
                  "
                  :loading="subtitleWorkflowPreviewLoading"
                  @click="onGenerateSubtitlePreview"
                >
                  生成 5 秒预览
                </n-button>
                <n-button
                  block
                  secondary
                  type="primary"
                  :disabled="
                    !subtitleWorkflowDraftId || subtitleWorkflowFinalizeLoading
                  "
                  :loading="subtitleWorkflowFinalizeLoading"
                  @click="onFinalizeSubtitleWorkflow"
                >
                  确认并输出最终视频
                </n-button>
              </div>
              <div
                class="workflow-progress-card"
                :style="{
                  '--workflow-percent': `${workflowProgressState.percent}%`,
                }"
                :class="{
                  'workflow-progress-card--running':
                    subtitleWorkflowPreviewLoading ||
                    subtitleWorkflowFinalizeLoading,
                  'workflow-progress-card--done': Boolean(
                    subtitleWorkflowFinalUrl,
                  ),
                }"
              >
                <div class="workflow-progress-card__head">
                  <div>
                    <span>成片进度</span>
                    <strong>{{ workflowProgressState.status }}</strong>
                    <p>{{ workflowProgressState.hint }}</p>
                  </div>
                  <b>{{ workflowProgressState.percent }}%</b>
                </div>
                <div class="workflow-progress-track">
                  <i
                    :style="{ width: `${workflowProgressState.percent}%` }"
                  ></i>
                </div>
                <ol class="workflow-progress-steps">
                  <li
                    v-for="(step, index) in workflowSimpleSteps"
                    :key="step.label"
                    :class="`is-${step.status}`"
                  >
                    <b>{{ step.status === "done" ? "✓" : index + 1 }}</b>
                    <div>
                      <strong>{{ step.label }}</strong>
                    </div>
                  </li>
                </ol>
              </div>
              <div class="segment-count-bar">
                <n-text depth="3"
                  >当前链路：生成音轨 → 5 秒预览 → 对齐口型 → 输出成片</n-text
                >
                <n-tag size="small" :bordered="false" type="info">
                  无字幕模式
                </n-tag>
              </div>
              <n-text depth="3" class="helper-text workflow-helper-note">
                这条流程会先生成音轨，再合成 5
                秒无字幕预览；确认无误后输出完整成片。
              </n-text>
            </div>
          </section>

          <section class="edit-options step-three-checks">
            <div
              class="switch-row switch-row--card status-check"
              :class="
                currentWorkflowScript
                  ? 'status-check--ok'
                  : 'status-check--fail'
              "
            >
              <span>文案</span>
              <b aria-label="文案就绪状态">{{
                currentWorkflowScript ? "✓" : "×"
              }}</b>
            </div>
            <div class="switch-row switch-row--card status-check">
              <span>数字人视频</span>
              <b class="compact-label" :title="selectedAvatarLabel">{{
                selectedAvatarLabel
              }}</b>
            </div>
            <div class="switch-row switch-row--card status-check">
              <span>音色驱动</span>
              <b class="compact-label" :title="selectedVoiceLabel">{{
                selectedVoiceLabel
              }}</b>
            </div>
          </section>
        </div>

        <section v-if="false" class="panel output-panel">
          <div class="section-title section-title--between">
            <div class="section-title__main">
              <span class="title-icon">文</span>
              <div>
                <strong>整段文案</strong>
                <p>直接使用第一步确认的完整口播稿，不叠加字幕</p>
              </div>
            </div>
            <n-tag size="small" :bordered="false"
              >{{ currentWorkflowScript.length }} 字</n-tag
            >
          </div>

          <div
            class="full-script-preview"
            :class="{ 'full-script-preview--empty': !currentWorkflowScript }"
          >
            <span>{{
              currentWorkflowScript ? "当前整段口播" : "等待文案"
            }}</span>
            <p>
              {{
                currentWorkflowScript ||
                "请先在第一步抓取、转写或手动整理一份口播文案，这里会直接使用整段文案进入音轨生成和对口型流程。"
              }}
            </p>
          </div>

          <div
            v-if="
              subtitleWorkflowPreviewUrl ||
              subtitleWorkflowFinalUrl ||
              subtitleWorkflowHint
            "
            class="workflow-preview-stack"
          >
            <div class="summary-card">
              <div>
                <strong>{{
                  subtitleWorkflowFinalUrl ? "完整视频已输出" : "5 秒预览已生成"
                }}</strong>
                <p>当前为无字幕模式，只检查声音和口型同步。</p>
              </div>
              <n-tag size="small" :bordered="false" type="success">
                无字幕
              </n-tag>
            </div>

            <n-alert v-if="subtitleWorkflowHint" type="info" :show-icon="false">
              {{ subtitleWorkflowHint }}
            </n-alert>

            <div v-if="subtitleWorkflowPreviewUrl" class="video-preview-wrap">
              <video
                class="video-preview"
                controls
                playsinline
                preload="metadata"
                :src="subtitleWorkflowPreviewUrl ?? undefined"
              />
            </div>

            <div v-if="subtitleWorkflowFinalUrl" class="video-preview-wrap">
              <video
                class="video-preview"
                controls
                playsinline
                preload="metadata"
                :src="subtitleWorkflowFinalUrl ?? undefined"
              />
            </div>
          </div>
          <div v-else class="empty-block">
            <strong>先生成 5 秒无字幕预览</strong>
            <p>
              这里会展示无字幕预览视频，确认口型和声音同步后再输出最终成片。
            </p>
          </div>
        </section>

        <aside v-if="false" class="preview-side">
          <div class="preview-head">
            <n-text strong>生成预览</n-text>
            <n-tag size="small" :bordered="false" type="info">
              {{ generatedVideoCount ? "已生成" : "待生成" }}
            </n-tag>
          </div>
          <div class="phone-preview">
            <div v-if="firstReadyVideoUrl" class="phone-face phone-face--video">
              <video
                :src="firstReadyVideoUrl ?? undefined"
                controls
                playsinline
                preload="metadata"
              />
            </div>
            <div v-else class="phone-face">
              <span>生成后会在这里显示整段预览视频</span>
            </div>
          </div>
        </aside>
      </section>

      <section v-else key="step-4" class="publish-layout">
        <div class="publish-left">
          <section class="publish-hero">
            <h1>第四步：自动发布</h1>
            <p>
              先把四步流程排完整，发布账号与计划沿用对标页结构，便于后续继续接入。
            </p>
            <div class="publish-stats">
              <div>
                <strong>{{ generatedVideoCount }}</strong
                ><span>已生成成片</span>
              </div>
              <div>
                <strong>{{ publishPlatforms.length }}</strong
                ><span>预设平台</span>
              </div>
              <div><strong>0</strong><span>已连接账号</span></div>
            </div>
          </section>

          <section class="panel copy-card">
            <div class="section-title section-title--between">
              <div class="section-title__main">
                <span class="title-icon">文</span>
                <div>
                  <strong>发布文案</strong>
                  <p>可直接沿用第三步成片结果</p>
                </div>
              </div>
              <n-space size="small">
                <n-button
                  text
                  size="small"
                  @click="syncPublishCopyFromScript(true)"
                  >同步文案</n-button
                >
                <n-button text size="small" @click="jumpToStep(3)"
                  >返回成片</n-button
                >
              </n-space>
            </div>
            <n-input
              v-model:value="publishCopy"
              type="textarea"
              :autosize="{ minRows: 5 }"
              class="publish-copy"
              @update:value="publishCopyTouched = true"
            />
            <div class="cover-row">
              <div class="cover-thumb">封面</div>
              <div>
                <strong>当前视频摘要</strong>
                <p>
                  数字人：{{ selectedAvatarLabel }} · 音色：{{
                    selectedVoiceLabel
                  }}
                </p>
              </div>
            </div>
            <div class="publish-result-list">
              <div
                v-for="item in publishReadyItems"
                :key="item.index"
                class="publish-result-item"
              >
                <strong>整段成片</strong>
                <p>{{ item.text || "已生成可发布视频" }}</p>
              </div>
              <div v-if="!publishReadyItems.length" class="plan-empty">
                先回到第三步生成整段对口型视频。
              </div>
            </div>
          </section>
        </div>

        <div class="publish-center">
          <section class="panel platform-card">
            <div class="section-title section-title--between">
              <strong>发布平台</strong>
              <n-button text type="primary" size="small" disabled
                >+ 绑定账号</n-button
              >
            </div>
            <div class="platform-list">
              <div
                v-for="platform in publishPlatforms"
                :key="platform.name"
                class="platform-item"
              >
                <span>{{ platform.icon }}</span>
                <div>
                  <strong>{{ platform.name }}</strong>
                  <p>{{ platform.account }} · 待接入发布账号</p>
                </div>
                <n-button size="tiny" disabled>待接入</n-button>
              </div>
            </div>
          </section>

          <section class="panel schedule-card">
            <div class="section-title">
              <span class="title-icon">时</span>
              <div>
                <strong>发布计划</strong>
                <p>这一层先保留对标页节奏，后续再接真正的账号发布能力</p>
              </div>
            </div>
            <div class="schedule-options">
              <button class="active" type="button">立即发布</button>
              <button type="button">定时发布</button>
            </div>
            <n-button block disabled class="publish-btn">
              立即发布至 0 个平台 / 0 个账号
            </n-button>
            <div class="plan-empty">发布账号模块待接入</div>
          </section>
        </div>

        <aside class="preview-side preview-side--publish">
          <div class="preview-head">
            <n-text strong>发布预览</n-text>
            <n-tag
              size="small"
              :bordered="false"
              type="success"
              v-if="firstReadyVideoUrl"
            >
              可预览
            </n-tag>
          </div>
          <div class="phone-preview phone-preview--final">
            <div v-if="firstReadyVideoUrl" class="phone-face phone-face--video">
              <video
                :src="firstReadyVideoUrl ?? undefined"
                controls
                playsinline
                preload="metadata"
              />
            </div>
            <div v-else class="phone-face phone-face--poster">
              <strong>自动发布</strong>
              <span>等第三步先出片，这里就会承接最终结果。</span>
            </div>
          </div>
        </aside>
      </section>
    </Transition>

    <NewAvatarModal
      v-if="createAvatarOpen"
      v-model:show="createAvatarOpen"
      :loading="creatingAvatar"
      @submit="createAvatarFromStudio"
    />
    <VoiceCloneModal
      v-if="cloneVoiceOpen"
      v-model:show="cloneVoiceOpen"
      :loading="cloningVoice"
      @submit="cloneVoiceFromStudio"
    />

    <footer v-if="activeStep !== 3" class="create-footer">
      <div class="footer-progress">
        <n-text depth="3">创作进度</n-text>
        <strong>{{ progressText }}</strong>
        <n-progress
          type="line"
          :percentage="progressPercent"
          :show-indicator="false"
        />
      </div>
      <n-space>
        <n-button v-if="activeStep > 1" size="large" quaternary @click="goPrev"
          >上一步</n-button
        >
        <n-button
          class="next-btn"
          size="large"
          :disabled="activeStep >= 4"
          @click="goNext"
        >
          {{ footerNextLabel }}
        </n-button>
      </n-space>
    </footer>
  </main>
</template>

<style scoped>
.video-create {
  /* 创作流统一缩放：随视口变窄自动收紧，避免撑出右侧工作区 */
  --vc-pad-y: clamp(8px, 1.2vw, 14px);
  --vc-pad-x: clamp(12px, 1.6vw, 20px);
  --vc-gap: clamp(10px, 1.2vw, 15px);
  --vc-gap-lg: clamp(12px, 1.05vw, 18px);
  --vc-panel-pad: clamp(10px, 1.05vw, 14px);
  --vc-radius: clamp(12px, 0.95vw, 16px);
  --vc-h1: clamp(17px, 0.75vw + 14px, 20px);
  --vc-aside-w: min(100%, clamp(200px, 24vw, 252px));
  --vc-scrollbar-size: 8px;
  --vc-scrollbar-thumb: rgba(75, 107, 255, 0.28);
  --vc-scrollbar-thumb-hover: rgba(75, 107, 255, 0.48);
  --vc-scrollbar-track: rgba(226, 233, 248, 0.45);

  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  min-height: 100vh;
  min-height: 100dvh;
  padding-bottom: calc(120px + var(--app-safe-bottom));
  color: var(--text-main);
  overflow: hidden;
  overflow-x: clip;
  container-type: inline-size;
  background:
    radial-gradient(
      circle at 84% 20%,
      rgba(75, 107, 255, 0.12),
      transparent 26%
    ),
    radial-gradient(
      circle at 34% 62%,
      rgba(75, 199, 187, 0.08),
      transparent 28%
    ),
    linear-gradient(180deg, transparent, rgba(255, 255, 255, 0.18));
}

.script-side,
.preview-side,
.step-two-script-scroll,
.avatar-strip--filled,
.workspace > .panel,
.step-two-workbench > .panel,
.edit-main > .panel,
.edit-layout > .panel,
.publish-left > .panel,
.publish-center > .panel {
  scrollbar-width: thin;
  scrollbar-color: var(--vc-scrollbar-thumb) transparent;
}

.script-side::-webkit-scrollbar,
.preview-side::-webkit-scrollbar,
.step-two-script-scroll::-webkit-scrollbar,
.avatar-strip--filled::-webkit-scrollbar,
.workspace > .panel::-webkit-scrollbar,
.step-two-workbench > .panel::-webkit-scrollbar,
.edit-main > .panel::-webkit-scrollbar,
.edit-layout > .panel::-webkit-scrollbar,
.publish-left > .panel::-webkit-scrollbar,
.publish-center > .panel::-webkit-scrollbar {
  width: var(--vc-scrollbar-size);
  height: var(--vc-scrollbar-size);
}

.script-side::-webkit-scrollbar-track,
.preview-side::-webkit-scrollbar-track,
.step-two-script-scroll::-webkit-scrollbar-track,
.avatar-strip--filled::-webkit-scrollbar-track,
.workspace > .panel::-webkit-scrollbar-track,
.step-two-workbench > .panel::-webkit-scrollbar-track,
.edit-main > .panel::-webkit-scrollbar-track,
.edit-layout > .panel::-webkit-scrollbar-track,
.publish-left > .panel::-webkit-scrollbar-track,
.publish-center > .panel::-webkit-scrollbar-track {
  margin: 10px 2px;
  border-radius: 999px;
  background: transparent;
}

.avatar-strip--filled::-webkit-scrollbar-track {
  margin: 2px 10px;
}

.script-side::-webkit-scrollbar-thumb,
.preview-side::-webkit-scrollbar-thumb,
.step-two-script-scroll::-webkit-scrollbar-thumb,
.avatar-strip--filled::-webkit-scrollbar-thumb,
.workspace > .panel::-webkit-scrollbar-thumb,
.step-two-workbench > .panel::-webkit-scrollbar-thumb,
.edit-main > .panel::-webkit-scrollbar-thumb,
.edit-layout > .panel::-webkit-scrollbar-thumb,
.publish-left > .panel::-webkit-scrollbar-thumb,
.publish-center > .panel::-webkit-scrollbar-thumb {
  min-height: 42px;
  border: 2px solid rgba(255, 255, 255, 0.72);
  border-radius: 999px;
  background: linear-gradient(
      180deg,
      var(--vc-scrollbar-thumb),
      rgba(75, 199, 187, 0.36)
    )
    padding-box;
}

.script-side:hover,
.preview-side:hover,
.step-two-script-scroll:hover,
.avatar-strip--filled:hover,
.workspace > .panel:hover,
.step-two-workbench > .panel:hover,
.edit-main > .panel:hover,
.edit-layout > .panel:hover,
.publish-left > .panel:hover,
.publish-center > .panel:hover {
  scrollbar-color: var(--vc-scrollbar-thumb-hover) transparent;
}

.script-side:hover::-webkit-scrollbar-thumb,
.preview-side:hover::-webkit-scrollbar-thumb,
.step-two-script-scroll:hover::-webkit-scrollbar-thumb,
.avatar-strip--filled:hover::-webkit-scrollbar-thumb,
.workspace > .panel:hover::-webkit-scrollbar-thumb,
.step-two-workbench > .panel:hover::-webkit-scrollbar-thumb,
.edit-main > .panel:hover::-webkit-scrollbar-thumb,
.edit-layout > .panel:hover::-webkit-scrollbar-thumb,
.publish-left > .panel:hover::-webkit-scrollbar-thumb,
.publish-center > .panel:hover::-webkit-scrollbar-thumb {
  background: linear-gradient(
      180deg,
      var(--vc-scrollbar-thumb-hover),
      rgba(75, 199, 187, 0.52)
    )
    padding-box;
}

.create-topbar {
  display: grid;
  grid-template-columns: minmax(120px, 180px) minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--vc-gap-lg);
  min-height: clamp(52px, 6vw, 58px);
  padding: var(--vc-pad-y) var(--vc-pad-x);
  border-bottom: 1px solid var(--border-soft);
  background: rgba(255, 255, 255, 0.76);
  box-shadow: 0 14px 32px rgba(64, 86, 122, 0.08);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
}

.back-link {
  color: var(--text-sub);
  font-size: 13px;
  text-decoration: none;
}

.back-link:hover {
  color: var(--primary);
  text-shadow: 0 0 18px rgba(75, 107, 255, 0.16);
}

.topbar-progress {
  justify-self: end;
  text-align: right;
}

.stepper {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: clamp(14px, 1.6vw, 22px);
  padding: 0;
  margin: 0;
  list-style: none;
}

.stepper__item {
  display: inline-flex;
  align-items: center;
  flex: 0 0 auto;
  gap: 8px;
  color: var(--text-light);
  font-size: 12px;
  white-space: nowrap;
  cursor: pointer;
  transition:
    color var(--transition-fast),
    transform var(--transition-smooth);
}

.stepper__item span {
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  color: var(--text-sub);
  border-radius: 999px;
  border: 1px solid rgba(75, 107, 255, 0.18);
  background: rgba(75, 107, 255, 0.08);
  transition:
    color var(--transition-fast),
    border-color var(--transition-fast),
    background var(--transition-fast),
    box-shadow var(--transition-fast);
}

.stepper__item--active {
  color: var(--primary);
  transform: translateY(-1px);
}

.stepper__item--active span {
  color: #ffffff;
  border-color: rgba(75, 107, 255, 0.3);
  background: linear-gradient(135deg, var(--primary), var(--accent-teal));
  box-shadow: var(--shadow-glow);
}

.create-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(216px, var(--vc-aside-w));
  gap: clamp(12px, 1.05vw, 18px);
  min-height: 0;
  padding: clamp(8px, 1vw, 14px) clamp(10px, 1.45vw, 18px) 0;
  align-items: stretch;
}

.main-board {
  min-width: 0;
  min-height: 0;
}

.main-board h1,
.step-two-head h1,
.edit-main h1 {
  margin: 0 0 clamp(12px, 1.35vw, 18px);
  font-size: var(--vc-h1);
  line-height: 1.22;
}

.workspace {
  display: grid;
  grid-template-columns: minmax(300px, 0.9fr) minmax(420px, 1.1fr);
  gap: clamp(12px, 1.1vw, 18px);
  min-height: 0;
  align-items: stretch;
}

.panel {
  min-height: 0;
  min-width: 0;
  padding: var(--vc-panel-pad);
  border: 1px solid rgba(255, 255, 255, 0.56);
  border-radius: var(--vc-radius);
  background: linear-gradient(
    180deg,
    rgba(255, 255, 255, 0.88),
    rgba(246, 249, 255, 0.82)
  );
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.94),
    var(--shadow-soft);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
  transition:
    border-color var(--transition-fast),
    box-shadow var(--transition-fast),
    transform var(--transition-smooth);
}

.panel:hover {
  border-color: var(--border-strong);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.96),
    var(--shadow-panel);
  transform: translateY(-3px);
}

.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
  color: var(--primary);
  font-weight: 700;
}

.panel-head--between {
  align-items: flex-start;
}

.panel-head--subtle {
  margin-bottom: 16px;
}

.panel-head--subtle span {
  color: var(--text-main);
}

.panel--source {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: clamp(12px, 1vw, 16px);
}

.panel--outline {
  display: grid;
  grid-template-rows: auto auto auto minmax(0, 1fr) auto;
}

.script-extract-panel {
  grid-template-rows: auto auto auto minmax(0, 1fr) auto auto;
  gap: 0;
  padding: clamp(22px, 2vw, 30px);
  overflow: hidden;
  border-color: rgba(209, 213, 219, 0.78);
  border-radius: 28px;
  background: rgba(255, 255, 255, 0.96);
  box-shadow:
    0 22px 54px rgba(80, 64, 122, 0.08),
    inset 0 1px 0 rgba(255, 255, 255, 0.96);
}

.script-extract-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: clamp(12px, 1.2vw, 18px);
}

.script-extract-title {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  color: var(--text-main);
}

.script-extract-title__icon {
  display: grid;
  width: 22px;
  height: 22px;
  place-items: center;
  color: var(--primary);
  font-size: 17px;
  line-height: 1;
}

.script-extract-title strong {
  font-size: clamp(22px, 2vw, 28px);
  font-weight: 900;
  letter-spacing: -0.04em;
}

.script-extract-count {
  color: var(--text-light);
  font-size: 14px;
  font-weight: 700;
}

.script-extract-tip {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin-bottom: clamp(12px, 1.2vw, 18px);
  color: var(--text-sub);
}

.script-extract-tip span {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  flex: 0 0 auto;
  color: var(--primary);
  font-size: 12px;
  font-weight: 900;
  border: 1px solid rgba(124, 58, 237, 0.38);
  border-radius: 999px;
  background: rgba(124, 58, 237, 0.06);
}

.script-extract-tip p {
  margin: 0;
  font-size: 14px;
  line-height: 1.65;
}

.source-switch {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
  padding: 6px;
  border: 1px solid rgba(121, 144, 184, 0.16);
  border-radius: 22px;
  background: linear-gradient(
    180deg,
    rgba(246, 249, 255, 0.92),
    rgba(236, 242, 254, 0.72)
  );
  box-shadow: inset 0 1px 2px rgba(65, 83, 122, 0.06);
}

.source-switch__item {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: clamp(40px, 4vw, 46px);
  padding: 0 clamp(10px, 1vw, 14px);
  color: var(--text-sub);
  cursor: pointer;
  border: 1px solid transparent;
  border-radius: 17px;
  background: transparent;
  box-shadow: none;
  transition:
    background var(--transition-fast),
    border-color var(--transition-fast),
    color var(--transition-fast),
    box-shadow var(--transition-fast),
    transform var(--transition-smooth);
}

.source-switch__item:hover,
.source-switch__item--active {
  color: var(--text-main);
  border-color: rgba(75, 107, 255, 0.18);
  background: rgba(255, 255, 255, 0.94);
  box-shadow:
    0 10px 20px rgba(75, 107, 255, 0.1),
    inset 0 1px 0 rgba(255, 255, 255, 0.96);
  transform: translateY(-1px);
}

.source-switch__icon {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  color: var(--primary);
  border-radius: 999px;
  background: rgba(75, 107, 255, 0.08);
  font-size: 12px;
  font-weight: 700;
}

.benchmark-pane,
.hotlink-pane {
  display: grid;
  align-content: start;
  gap: clamp(10px, 0.9vw, 14px);
  min-height: 0;
}

.benchmark-input-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(118px, 0.24fr);
  gap: 10px;
  align-items: center;
}

.benchmark-submit {
  min-width: 0;
}

.benchmark-note-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.helper-text--inline {
  margin-top: 0;
}

.recent-extract {
  display: grid;
  gap: 12px;
  margin-top: 4px;
}

.recent-extract__head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
}

.recent-extract__head span {
  display: block;
  color: var(--text-main);
  font-size: 14px;
  font-weight: 800;
}

.recent-extract__head strong {
  display: block;
  margin-top: 3px;
  color: var(--text-sub);
  font-size: 12px;
  font-weight: 600;
}

.recent-extract__list {
  display: grid;
  gap: 10px;
  max-height: clamp(208px, 27vh, 330px);
  overflow-y: auto;
  padding-right: 4px;
  scrollbar-width: thin;
  scrollbar-color: var(--vc-scrollbar-thumb) transparent;
}

.recent-extract__list::-webkit-scrollbar {
  width: var(--vc-scrollbar-size);
}

.recent-extract__list::-webkit-scrollbar-track {
  background: transparent;
}

.recent-extract__list::-webkit-scrollbar-thumb {
  border: 2px solid rgba(255, 255, 255, 0.72);
  border-radius: 999px;
  background: linear-gradient(
      180deg,
      var(--vc-scrollbar-thumb),
      rgba(75, 199, 187, 0.34)
    )
    padding-box;
}

.recent-extract-card {
  display: grid;
  grid-template-columns: 58px minmax(0, 1fr);
  gap: 12px;
  align-items: center;
  padding: 12px;
  border: 1px solid rgba(121, 144, 184, 0.16);
  border-radius: 18px;
  background:
    radial-gradient(circle at 0% 0%, rgba(75, 107, 255, 0.07), transparent 34%),
    rgba(255, 255, 255, 0.88);
  box-shadow: 0 14px 30px rgba(64, 86, 122, 0.08);
  transition:
    transform var(--transition-fast),
    border-color var(--transition-fast),
    box-shadow var(--transition-fast);
}

.recent-extract-card:hover {
  transform: translateY(-2px);
  border-color: rgba(75, 107, 255, 0.24);
  box-shadow: 0 18px 38px rgba(75, 107, 255, 0.12);
}

.recent-extract-card__preview {
  position: relative;
  display: grid;
  place-items: center;
  width: 58px;
  height: 78px;
  padding: 0;
  overflow: hidden;
  color: #ffffff;
  cursor: pointer;
  border: 0;
  border-radius: 13px;
  background: linear-gradient(
    135deg,
    rgba(75, 107, 255, 0.86),
    rgba(69, 200, 194, 0.74)
  );
  box-shadow: 0 12px 22px rgba(75, 107, 255, 0.16);
}

.recent-extract-card__preview img,
.recent-extract-card__preview video {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.recent-extract-card__preview::before {
  position: absolute;
  inset: 0;
  content: "";
  background: linear-gradient(180deg, transparent 40%, rgba(8, 16, 35, 0.56));
  opacity: 0.85;
}

.recent-extract-card__preview i {
  position: absolute;
  left: 50%;
  bottom: 7px;
  z-index: 1;
  padding: 3px 7px;
  color: #ffffff;
  border-radius: 999px;
  background: rgba(12, 18, 34, 0.58);
  font-size: 10px;
  font-style: normal;
  font-weight: 800;
  transform: translateX(-50%);
}

.recent-extract-card__fallback {
  position: relative;
  z-index: 1;
  font-size: 12px;
  font-weight: 800;
}

.recent-extract-card__body {
  min-width: 0;
}

.recent-extract-card__title {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.recent-extract-card__title strong {
  overflow: hidden;
  color: var(--text-main);
  font-size: 14px;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.recent-extract-card__body p {
  display: -webkit-box;
  margin: 5px 0 7px;
  overflow: hidden;
  color: var(--text-sub);
  font-size: 12px;
  line-height: 1.55;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.recent-extract-card__body small {
  color: var(--text-light);
  font-size: 11px;
}

.recent-extract__empty {
  padding: 14px;
  color: var(--text-sub);
  text-align: center;
  border: 1px dashed rgba(121, 144, 184, 0.22);
  border-radius: 16px;
  background: rgba(250, 252, 255, 0.74);
  font-size: 12px;
}

.benchmark-result {
  display: grid;
  gap: clamp(10px, 0.9vw, 14px);
}

.benchmark-result__label {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  color: var(--text-sub);
  font-size: 13px;
}

.benchmark-result__dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: linear-gradient(135deg, var(--primary), var(--accent-teal));
}

.benchmark-card {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 13px;
  width: 100%;
  padding: clamp(13px, 1.1vw, 16px);
  color: inherit;
  text-align: left;
  cursor: pointer;
  border: 1.5px solid rgba(75, 107, 255, 0.4);
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.9);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.96),
    0 18px 34px rgba(75, 107, 255, 0.09);
  transition:
    transform var(--transition-smooth),
    box-shadow var(--transition-fast),
    border-color var(--transition-fast);
}

.benchmark-card:hover {
  transform: translateY(-2px);
  border-color: rgba(75, 107, 255, 0.56);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.98),
    0 22px 40px rgba(75, 107, 255, 0.13);
}

.benchmark-card__avatar {
  width: clamp(46px, 4vw, 54px);
  height: clamp(46px, 4vw, 54px);
  object-fit: cover;
  border-radius: 999px;
  background: rgba(75, 107, 255, 0.08);
}

.benchmark-card__avatar--fallback {
  display: grid;
  place-items: center;
  color: var(--primary);
  font-size: 22px;
  font-weight: 700;
}

.benchmark-card__body {
  min-width: 0;
}

.benchmark-card__title,
.benchmark-card__stats {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.benchmark-card__title strong {
  font-size: clamp(16px, 1.2vw, 18px);
}

.benchmark-card__stats {
  margin-top: 6px;
  color: var(--text-main);
  font-size: 13px;
  font-weight: 600;
}

.benchmark-card__body p {
  display: -webkit-box;
  margin: 6px 0 0;
  overflow: hidden;
  color: var(--text-sub);
  font-size: 13px;
  line-height: 1.6;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.benchmark-card__check {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  color: #ffffff;
  border-radius: 999px;
  background: linear-gradient(135deg, var(--primary), var(--accent-teal));
  box-shadow: 0 12px 22px rgba(75, 107, 255, 0.22);
  font-size: 16px;
  font-weight: 700;
}

.benchmark-post-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.benchmark-post {
  display: grid;
  gap: 8px;
  min-height: clamp(84px, 9vw, 104px);
  padding: 12px;
  border: 1px solid rgba(121, 144, 184, 0.16);
  border-radius: 16px;
  background: rgba(248, 250, 255, 0.86);
}

.benchmark-post__meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  color: var(--text-sub);
  font-size: 11px;
}

.benchmark-post p {
  margin: 0;
  color: var(--text-main);
  font-size: 13px;
  line-height: 1.65;
}

.benchmark-action-row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.idea-action {
  min-height: clamp(46px, 4.2vw, 50px);
  padding: 0 16px;
  color: var(--text-main);
  font-size: 16px;
  font-weight: 700;
  cursor: pointer;
  border: 1px solid rgba(121, 144, 184, 0.18);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.92);
  box-shadow: 0 12px 26px rgba(65, 83, 122, 0.08);
  transition:
    transform var(--transition-smooth),
    box-shadow var(--transition-fast),
    border-color var(--transition-fast);
}

.idea-action:hover {
  transform: translateY(-2px);
  border-color: rgba(75, 107, 255, 0.24);
  box-shadow: 0 16px 30px rgba(75, 107, 255, 0.12);
}

.idea-action--primary {
  color: #ffffff;
  border-color: transparent;
  background: linear-gradient(135deg, var(--primary), var(--primary-deep));
  box-shadow: 0 16px 30px rgba(75, 107, 255, 0.24);
}

.benchmark-empty {
  display: grid;
  place-items: center;
  min-height: clamp(178px, 23vh, 228px);
  padding: 18px;
  text-align: center;
  border: 1px dashed rgba(121, 144, 184, 0.22);
  border-radius: 20px;
  background: rgba(250, 252, 255, 0.72);
}

.benchmark-empty p {
  margin: 8px 0 0;
  color: var(--text-sub);
  font-size: 13px;
}

.helper-text {
  display: block;
  margin-top: 10px;
  color: var(--text-sub);
  font-size: 12px;
  line-height: 1.65;
}

.helper-text--top {
  margin-top: 0;
  margin-bottom: 10px;
}

.helper-text--accent {
  color: var(--primary);
}

.input-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-top: 12px;
}

.input-actions--triple {
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
}

.meta-board {
  display: grid;
  gap: 12px;
  margin-top: 14px;
  padding: clamp(12px, 1vw, 14px);
  border: 1px solid rgba(75, 107, 255, 0.14);
  border-radius: 20px;
  background:
    radial-gradient(circle at 12% 0%, rgba(75, 107, 255, 0.1), transparent 32%),
    linear-gradient(
      180deg,
      rgba(255, 255, 255, 0.94),
      rgba(248, 251, 255, 0.88)
    );
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.98),
    0 16px 34px rgba(86, 104, 140, 0.1);
}

.meta-board__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.meta-board__header > div {
  display: grid;
  gap: 4px;
}

.meta-board__header strong {
  color: var(--text-main);
  font-size: 15px;
  line-height: 1.35;
}

.meta-board__eyebrow,
.meta-chip span,
.meta-section > span {
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.04em;
}

.meta-board__summary {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(92px, 0.24fr);
  gap: 10px;
}

.meta-chip,
.meta-section {
  border: 1px solid rgba(121, 144, 184, 0.16);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.74);
}

.meta-chip {
  display: grid;
  gap: 6px;
  min-height: 66px;
  padding: 11px 12px;
}

.meta-chip strong {
  color: var(--text-main);
  font-size: 16px;
  line-height: 1.35;
}

.meta-chip--title strong {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  font-size: 15px;
}

.meta-section {
  display: grid;
  gap: 8px;
  padding: 12px;
}

.meta-section p {
  margin: 0;
  color: var(--text-sub);
  font-size: 13px;
  line-height: 1.75;
  white-space: pre-wrap;
}

.meta-tag-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.meta-tag-list :deep(.n-tag) {
  color: var(--primary);
  background: rgba(75, 107, 255, 0.09);
}

.meta-empty {
  color: var(--text-muted);
}

.outline-editor :deep(.n-input),
.outline-editor :deep(.n-input-wrapper) {
  min-height: 100%;
  background: rgba(248, 250, 255, 0.94);
}

.outline-editor {
  min-height: 0;
}

.panel--outline .outline-editor {
  min-height: clamp(300px, 46vh, 520px);
}

.script-extract-panel .outline-editor {
  height: 100%;
  min-height: 0;
}

.script-extract-panel .outline-editor :deep(.n-input),
.script-extract-panel .outline-editor :deep(.n-input-wrapper) {
  height: 100%;
  min-height: 0;
  border: 0;
  border-radius: 22px;
  background: #f8fafc;
  box-shadow:
    inset 0 1px 2px rgba(80, 64, 122, 0.04),
    0 12px 30px rgba(80, 64, 122, 0.08);
}

.script-extract-panel .outline-editor :deep(.n-input-wrapper) {
  padding: clamp(14px, 1.4vw, 20px) clamp(16px, 1.6vw, 22px);
}

.outline-editor :deep(textarea) {
  max-height: 100%;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--vc-scrollbar-thumb) transparent;
}

.outline-editor :deep(textarea::-webkit-scrollbar) {
  width: var(--vc-scrollbar-size);
}

.outline-editor :deep(textarea::-webkit-scrollbar-track) {
  border-radius: 999px;
  background: transparent;
}

.outline-editor :deep(textarea::-webkit-scrollbar-thumb) {
  border: 2px solid rgba(255, 255, 255, 0.72);
  border-radius: 999px;
  background: linear-gradient(
      180deg,
      var(--vc-scrollbar-thumb),
      rgba(75, 199, 187, 0.36)
    )
    padding-box;
}

.script-extract-panel .outline-editor :deep(textarea) {
  height: 100% !important;
  color: #273244;
  font-size: clamp(16px, 1.1vw, 19px);
  font-weight: 500;
  line-height: 1.55;
}

.hook-preview {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin: 14px 0 2px;
}

.hook-preview__item,
.hook-side-card__block {
  padding: 14px 16px;
  border: 1px solid rgba(75, 107, 255, 0.14);
  border-radius: 16px;
  background: linear-gradient(
    180deg,
    rgba(244, 248, 255, 0.94),
    rgba(237, 245, 255, 0.82)
  );
  box-shadow: 0 16px 34px rgba(64, 86, 122, 0.08);
  transition:
    transform var(--transition-fast),
    border-color var(--transition-fast),
    box-shadow var(--transition-fast);
}

.hook-preview__item:hover,
.hook-side-card__block:hover {
  transform: translateY(-2px);
  border-color: rgba(75, 107, 255, 0.24);
  box-shadow: 0 18px 40px rgba(75, 107, 255, 0.12);
}

.hook-preview__item span,
.hook-side-card__block span {
  display: inline-flex;
  margin-bottom: 8px;
  color: var(--primary);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.02em;
}

.hook-preview__item strong,
.hook-side-card__block p {
  margin: 0;
  color: var(--text-main);
  line-height: 1.6;
  word-break: break-word;
}

.outline-footer {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  margin-top: 18px;
}

.script-extract-footer {
  align-items: center;
  margin-top: clamp(12px, 1.2vw, 16px);
  padding-top: clamp(12px, 1.2vw, 16px);
  border-top: 1px solid rgba(209, 213, 219, 0.72);
}

.script-extract-ready {
  display: inline-flex;
  align-items: center;
  gap: 10px;
}

.script-extract-ready > span {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: rgba(124, 58, 237, 0.42);
}

.script-extract-ready :deep(.n-text) {
  color: var(--text-light);
  font-size: 14px;
  font-weight: 900;
  letter-spacing: 0.04em;
}

.script-extract-actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: clamp(12px, 1.2vw, 16px);
  margin-top: clamp(12px, 1.2vw, 16px);
}

.script-extract-action {
  min-height: clamp(74px, 8vh, 90px);
  border: 0 !important;
  border-radius: 18px !important;
  box-shadow:
    0 18px 38px rgba(124, 58, 237, 0.22),
    inset 0 1px 0 rgba(255, 255, 255, 0.18);
}

.script-extract-action :deep(.n-button__content) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 14px;
  width: 100%;
  color: #ffffff;
}

.script-extract-action__icon {
  color: #ffffff;
  font-size: 26px;
  line-height: 1;
}

.script-extract-action strong,
.script-extract-action small {
  display: block;
  color: #ffffff;
  text-align: left;
}

.script-extract-action strong {
  font-size: clamp(18px, 1.55vw, 23px);
  font-weight: 900;
  line-height: 1.1;
}

.script-extract-action small {
  margin-top: 5px;
  font-size: 13px;
  font-weight: 700;
  opacity: 0.92;
}

.script-extract-action--primary {
  background: linear-gradient(135deg, #9b63dc 0%, #7c3aed 100%) !important;
}

.script-extract-action--secondary {
  background: linear-gradient(135deg, #6f6df8 0%, #4a43d6 100%) !important;
}

.gradient-btn,
.blue-btn,
.voice-generate,
.next-btn {
  color: #ffffff;
  background: linear-gradient(135deg, var(--primary), var(--accent-teal));
  box-shadow: var(--shadow-glow);
}

.script-side,
.preview-side {
  min-height: calc(100vh - 188px);
  min-width: 0;
  overflow-y: auto;
  padding: var(--vc-pad-y) var(--vc-gap-lg);
  border-left: 1px solid var(--border-soft);
  background: rgba(255, 255, 255, 0.44);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
}

.script-side__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
}

.script-side__head p {
  margin: 6px 0 0;
  color: var(--text-sub);
  font-size: 12px;
}

.hook-side-card {
  display: grid;
  gap: 10px;
  margin-top: 18px;
  padding: 14px;
  border: 1px solid rgba(75, 107, 255, 0.16);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.7);
  box-shadow: 0 18px 40px rgba(64, 86, 122, 0.08);
}

.hook-side-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.script-list,
.script-lines,
.subtitle-list {
  display: grid;
  gap: 13px;
  padding: 0;
  margin: 0;
  list-style: none;
}

.script-list li,
.script-lines li,
.subtitle-list li {
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr);
  gap: 8px;
  font-size: 12px;
  line-height: 1.55;
}

.script-list span,
.script-lines span,
.subtitle-list span {
  color: var(--text-light);
}

.script-list p,
.script-lines p,
.subtitle-list p {
  margin: 0;
  word-break: break-word;
}

.subtitle-table-head,
.subtitle-table li {
  display: grid;
  grid-template-columns: minmax(116px, 0.34fr) minmax(0, 1fr);
  gap: 14px;
  align-items: start;
}

.subtitle-table-head {
  padding: 10px 14px;
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.04em;
  border: 1px solid rgba(121, 144, 184, 0.14);
  border-radius: 14px;
  background: rgba(245, 248, 255, 0.82);
}

.subtitle-table li {
  padding: 12px 14px;
  border: 1px solid rgba(121, 144, 184, 0.14);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.76);
  box-shadow: 0 10px 24px rgba(64, 86, 122, 0.06);
}

.subtitle-table span {
  display: inline-flex;
  align-items: center;
  width: max-content;
  max-width: 100%;
  padding: 6px 9px;
  color: var(--primary);
  font-family: var(--font-display);
  font-size: 11px;
  font-weight: 800;
  line-height: 1.2;
  white-space: nowrap;
  border-radius: 999px;
  background: rgba(75, 107, 255, 0.09);
}

.subtitle-table p {
  color: var(--text-main);
  font-size: 13px;
  line-height: 1.7;
  word-break: break-word;
}

.empty-side,
.empty-block {
  display: grid;
  place-items: center;
  min-height: 180px;
  padding: 18px;
  text-align: center;
  border: 1px dashed rgba(121, 144, 184, 0.24);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.56);
}

.empty-side p,
.empty-block p {
  margin: 8px 0 0;
  color: var(--text-sub);
  font-size: 12px;
}

.step-two-layout,
.edit-layout,
.publish-layout {
  display: grid;
  gap: var(--vc-gap-lg);
  min-height: 0;
  padding: var(--vc-pad-y) var(--vc-pad-x) 0;
}

.step-two-layout {
  --step-two-gap: clamp(10px, 0.9vw, 15px);
  --step-two-panel-pad: clamp(12px, 1vw, 16px);

  gap: var(--step-two-gap);
  padding: clamp(8px, 1vw, 14px) clamp(10px, 1.45vw, 18px) 0;
}

.step-two-head {
  display: grid;
  gap: 4px;
  padding: 0 4px;
}

.step-two-head p {
  margin: 0;
  color: var(--text-sub);
  font-size: 13px;
}

.step-two-workbench {
  display: grid;
  grid-template-columns: minmax(280px, 0.86fr) minmax(340px, 1fr) minmax(
      320px,
      0.9fr
    );
  gap: var(--step-two-gap);
  min-height: 0;
  align-items: stretch;
}

.step-two-workbench > .panel {
  display: grid;
  align-content: start;
  gap: clamp(10px, 0.85vw, 13px);
  min-height: 0;
  overflow: hidden;
  padding: var(--step-two-panel-pad);
}

.step-two-script-panel {
  grid-template-rows: auto auto minmax(0, 1fr) auto auto;
}

.step-two-voice-panel,
.step-two-avatar-panel {
  grid-template-rows: auto auto minmax(0, 1fr);
}

.step-two-block-head,
.step-two-block-head__main,
.step-two-script-meta,
.step-two-footnote,
.step-two-slider-card__head,
.voice-preview-card__head,
.voice-preview-card__player,
.lip-sync-setup-card__resolution,
.lip-sync-setup-card__tabs {
  display: flex;
  align-items: center;
  gap: 12px;
}

.step-two-block-head,
.step-two-script-meta,
.step-two-footnote,
.voice-preview-card__head,
.lip-sync-setup-card__resolution {
  justify-content: space-between;
}

.step-two-block-head {
  flex-wrap: wrap;
  row-gap: 8px;
  column-gap: 10px;
}

.step-two-block-head__main {
  min-width: min(100%, 176px);
  flex: 1 1 auto;
}

.step-two-block-head strong {
  display: block;
  font-size: clamp(14px, 0.35vw + 13px, 16px);
  line-height: 1.2;
}

.step-two-block-head p,
.step-two-script-meta span,
.step-two-footnote span,
.step-two-control-card small,
.voice-preview-card__head p,
.lip-sync-setup-card__tab span {
  color: var(--text-sub);
  font-size: 12px;
  line-height: 1.6;
}

.step-two-block-icon {
  display: grid;
  place-items: center;
  width: clamp(34px, 2.4vw + 26px, 40px);
  height: clamp(34px, 2.4vw + 26px, 40px);
  color: #fff;
  border-radius: clamp(12px, 1vw, 15px);
  background: linear-gradient(135deg, #7c4dff, #5a6dff);
  box-shadow: 0 20px 46px rgba(94, 86, 255, 0.22);
  font-size: clamp(16px, 1vw + 13px, 19px);
  font-weight: 800;
}

.step-two-block-icon--voice {
  background: linear-gradient(135deg, #6c44ff, #8f53ff);
}

.step-two-block-icon--avatar {
  background: linear-gradient(135deg, #5e56ff, #7a78ff);
}

.step-two-script-meta {
  padding: 0 2px;
  font-weight: 600;
}

.step-two-script-meta strong {
  color: var(--text-light);
  font-size: 12px;
}

.step-two-footnote__action {
  min-height: 34px;
  padding: 6px 14px !important;
  border-radius: 999px !important;
  line-height: 1.2;
}

.step-two-footnote__action :deep(.n-button__content) {
  line-height: 1.2;
}

.step-two-script-scroll {
  min-height: 0;
  overflow-y: auto;
  padding-right: 6px;
}

.step-two-script-list {
  display: grid;
  gap: 12px;
  padding: 0;
  margin: 0;
  list-style: none;
}

.step-two-script-line {
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr);
  gap: 10px;
  align-items: start;
  padding: 14px 16px;
  border: 1px solid rgba(121, 144, 184, 0.16);
  border-radius: 18px;
  background: linear-gradient(
    180deg,
    rgba(255, 255, 255, 0.92),
    rgba(244, 248, 255, 0.84)
  );
}

.step-two-script-line span {
  color: rgba(140, 151, 176, 0.88);
  font-size: 12px;
  font-weight: 700;
}

.step-two-script-line p,
.step-two-hook-card strong,
.voice-preview-card__empty p {
  margin: 0;
  line-height: 1.68;
  word-break: break-word;
}

.step-two-hook-row,
.step-two-control-grid,
.step-two-slider-grid,
.lip-sync-setup-card__summary {
  display: grid;
  gap: 12px;
}

.step-two-hook-row,
.step-two-slider-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.step-two-control-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.step-two-hook-card,
.step-two-control-card,
.step-two-slider-card,
.voice-preview-card,
.lip-sync-setup-card {
  border: 1px solid rgba(121, 144, 184, 0.16);
  border-radius: 22px;
  background: linear-gradient(
    180deg,
    rgba(255, 255, 255, 0.92),
    rgba(245, 248, 255, 0.84)
  );
  box-shadow: 0 22px 46px rgba(64, 86, 122, 0.08);
}

.step-two-hook-card,
.step-two-control-card,
.step-two-slider-card {
  padding: 14px 16px;
}

.step-two-hook-card span,
.step-two-control-card > span,
.step-two-slider-card__head span {
  color: var(--text-light);
  font-size: 12px;
  font-weight: 700;
}

.step-two-control-card {
  display: grid;
  gap: 10px;
}

.step-two-control-card__main {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 10px;
  align-items: center;
}

.step-two-control-card__main:has(.voice-sample-play) {
  grid-template-columns: auto minmax(0, 1fr);
}

.step-two-control-card__main :deep(.n-select) {
  min-width: 0;
  width: 100%;
}

.voice-sample-play,
.voice-preview-card__play {
  display: grid;
  place-items: center;
  width: 46px;
  height: 46px;
  color: #6d42ff;
  border: 0;
  border-radius: 50%;
  background: rgba(118, 83, 255, 0.14);
  box-shadow: inset 0 0 0 1px rgba(118, 83, 255, 0.12);
  cursor: pointer;
  transition:
    transform var(--transition-fast),
    background var(--transition-fast),
    box-shadow var(--transition-fast);
}

.voice-sample-play:hover,
.voice-preview-card__play:hover {
  transform: translateY(-1px) scale(1.02);
  background: rgba(118, 83, 255, 0.2);
  box-shadow: 0 18px 34px rgba(118, 83, 255, 0.18);
}

.voice-power-stepper {
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr) 44px;
  align-items: center;
  overflow: hidden;
  border: 1px solid rgba(121, 144, 184, 0.16);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.78);
}

.voice-power-stepper button {
  min-height: 46px;
  color: var(--text-main);
  border: 0;
  background: transparent;
  cursor: pointer;
}

.voice-power-stepper strong {
  text-align: center;
  font-size: 18px;
}

.step-two-slider-card {
  display: grid;
  gap: 12px;
}

.step-two-inline-alert {
  border-radius: 18px;
}

.step-two-primary-btn,
.step-two-ghost-btn,
.voice-source-switch__item,
.avatar-add-card,
.avatar-select-card,
.lip-sync-setup-card__tab,
.resolution-chip {
  transition:
    transform var(--transition-fast),
    box-shadow var(--transition-fast),
    border-color var(--transition-fast),
    background var(--transition-fast);
}

.step-two-primary-btn {
  width: 100%;
  min-height: 56px;
  color: #fff;
  font-size: 16px;
  font-weight: 700;
  border: 0;
  border-radius: 20px;
  background: linear-gradient(135deg, #6d42ff, #7f52ff 52%, #4ca5ff);
  box-shadow: 0 24px 44px rgba(90, 88, 255, 0.28);
  cursor: pointer;
}

.step-two-primary-btn:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 28px 48px rgba(90, 88, 255, 0.32);
}

.step-two-primary-btn:disabled,
.step-two-ghost-btn:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.step-two-primary-btn--video {
  margin-top: 6px;
}

.voice-generate-progress {
  display: grid;
  gap: 10px;
  padding: 14px 16px;
  overflow: hidden;
  border: 1px solid rgba(75, 107, 255, 0.16);
  border-radius: 18px;
  background:
    radial-gradient(circle at 0% 0%, rgba(75, 107, 255, 0.12), transparent 36%),
    linear-gradient(
      180deg,
      rgba(255, 255, 255, 0.94),
      rgba(245, 249, 255, 0.88)
    );
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.94);
}

.voice-generate-progress__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.voice-generate-progress__head span {
  color: var(--primary);
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.04em;
}

.voice-generate-progress__head strong {
  color: var(--text-main);
  font-family: var(--font-display);
  font-size: 17px;
}

.voice-generate-progress__bar {
  position: relative;
  height: 8px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(121, 144, 184, 0.18);
}

.voice-generate-progress__bar i {
  position: relative;
  display: block;
  width: 0;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #4b6bff, #45c8c2);
  box-shadow: 0 0 18px rgba(75, 107, 255, 0.2);
  transition: width 0.38s ease;
}

.voice-generate-progress__bar i::after {
  position: absolute;
  inset: 0;
  content: "";
  background: linear-gradient(
    90deg,
    transparent,
    rgba(255, 255, 255, 0.55),
    transparent
  );
  animation: voice-progress-flow 1.15s linear infinite;
}

.voice-generate-progress--done {
  border-color: rgba(31, 184, 133, 0.22);
  background:
    radial-gradient(circle at 0% 0%, rgba(31, 184, 133, 0.13), transparent 36%),
    linear-gradient(180deg, rgba(250, 255, 253, 0.96), rgba(240, 253, 249, 0.9));
}

.voice-generate-progress--done .voice-generate-progress__bar i::after {
  animation: none;
}

.voice-generate-progress p {
  margin: 0;
  color: var(--text-sub);
  font-size: 12px;
  line-height: 1.55;
}

.voice-progress-enter-active,
.voice-progress-leave-active {
  transition:
    opacity 0.22s ease,
    transform 0.22s ease;
}

.voice-progress-enter-from,
.voice-progress-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

@keyframes voice-progress-flow {
  from {
    transform: translateX(-100%);
  }

  to {
    transform: translateX(100%);
  }
}

.step-two-ghost-btn {
  width: 100%;
  min-height: 52px;
  color: #7a4eff;
  font-size: 15px;
  font-weight: 700;
  border: 1px solid rgba(122, 78, 255, 0.18);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.82);
  cursor: pointer;
}

.step-two-ghost-btn:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: var(--shadow-soft);
}

.voice-preview-card {
  display: grid;
  gap: 14px;
  padding: 18px;
}

.voice-preview-card--ready {
  border-color: rgba(108, 93, 255, 0.24);
  box-shadow: 0 24px 52px rgba(84, 105, 255, 0.14);
}

.voice-preview-card__head strong,
.voice-preview-card__player strong,
.voice-preview-card__empty strong {
  display: block;
}

.voice-preview-card__head p,
.voice-preview-card__player p {
  margin: 4px 0 0;
}

.voice-preview-card__player {
  justify-content: flex-start;
  padding: 14px;
  border: 1px solid rgba(121, 144, 184, 0.14);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.72);
}

.voice-preview-card__player > div {
  flex: 1;
}

.voice-preview-card__empty {
  display: grid;
  gap: 6px;
}

.voice-local-pane {
  display: grid;
  gap: 14px;
}

.voice-source-switch {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  padding: 4px;
  border-radius: 18px;
  background: rgba(232, 237, 247, 0.9);
}

.voice-source-switch__item {
  min-height: 46px;
  color: var(--text-sub);
  font-weight: 700;
  border: 0;
  border-radius: 14px;
  background: transparent;
  cursor: pointer;
}

.voice-source-switch__item--active {
  color: #6d42ff;
  background: rgba(255, 255, 255, 0.9);
  box-shadow: 0 14px 28px rgba(81, 100, 143, 0.1);
}

.avatar-strip {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
}

.avatar-add-card,
.avatar-select-card {
  position: relative;
  display: grid;
  gap: 10px;
  justify-items: center;
  align-content: start;
  min-height: clamp(168px, 22vw, 188px);
  padding: 14px;
  color: var(--text-main);
  border: 1px solid rgba(121, 144, 184, 0.16);
  border-radius: 28px;
  background: rgba(255, 255, 255, 0.8);
  cursor: pointer;
}

.avatar-add-card {
  place-items: center;
  border-style: dashed;
  color: var(--text-sub);
}

.avatar-add-card strong {
  display: grid;
  place-items: center;
  width: clamp(58px, 4.5vw, 64px);
  height: clamp(58px, 4.5vw, 64px);
  color: #91a0bc;
  border-radius: clamp(18px, 1.5vw, 22px);
  background: rgba(246, 248, 255, 0.92);
  font-size: clamp(28px, 2vw + 22px, 32px);
}

.avatar-select-card:hover,
.avatar-add-card:hover,
.lip-sync-setup-card__tab:hover,
.resolution-chip:hover {
  transform: translateY(-2px);
  box-shadow: 0 22px 40px rgba(77, 101, 152, 0.14);
}

.avatar-select-card--active {
  border-color: rgba(127, 82, 255, 0.42);
  box-shadow: 0 22px 42px rgba(115, 92, 255, 0.18);
}

.avatar-select-card:focus-visible {
  outline: 3px solid rgba(86, 110, 255, 0.28);
  outline-offset: 3px;
}

.avatar-select-card__remove {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 2;
  display: grid;
  width: 28px;
  height: 28px;
  place-items: center;
  color: #ffffff;
  border: 0;
  border-radius: 999px;
  background: linear-gradient(135deg, #ff6a6a, #ef4444);
  box-shadow: 0 12px 26px rgba(239, 68, 68, 0.24);
  cursor: pointer;
  opacity: 0.92;
  transform: translateY(0);
  transition:
    opacity 0.18s ease,
    transform 0.18s ease,
    box-shadow 0.18s ease;
}

.avatar-select-card:hover .avatar-select-card__remove,
.avatar-select-card:focus-within .avatar-select-card__remove {
  opacity: 1;
  transform: scale(1.04);
}

.avatar-select-card__remove:hover {
  box-shadow: 0 16px 34px rgba(239, 68, 68, 0.32);
}

.avatar-select-card__image,
.avatar-select-card__video,
.avatar-select-card__placeholder {
  width: 100%;
  aspect-ratio: 0.73;
  border-radius: 22px;
}

.avatar-select-card__image,
.avatar-select-card__video {
  object-fit: cover;
  background: rgba(235, 240, 247, 0.84);
}

.avatar-select-card__video {
  pointer-events: none;
}

.avatar-select-card__placeholder {
  display: grid;
  place-items: center;
  color: #7787a8;
  background: linear-gradient(
    180deg,
    rgba(244, 247, 255, 0.94),
    rgba(232, 239, 252, 0.94)
  );
  font-size: 34px;
  font-weight: 800;
}

.avatar-select-card__name {
  display: block;
  width: 100%;
  overflow: hidden;
  font-size: 13px;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lip-sync-setup-card {
  display: grid;
  gap: 16px;
  padding: 18px;
}

.lip-sync-setup-card__tabs {
  align-items: stretch;
}

.lip-sync-setup-card__tab {
  flex: 1;
  display: grid;
  gap: 4px;
  padding: 16px 18px;
  text-align: left;
  border: 1px solid rgba(121, 144, 184, 0.14);
  border-radius: 18px;
  background: rgba(250, 252, 255, 0.76);
  cursor: pointer;
}

.lip-sync-setup-card__tab strong {
  font-size: 16px;
}

.lip-sync-setup-card__tab--active {
  border-color: rgba(122, 78, 255, 0.28);
  background: linear-gradient(
    180deg,
    rgba(255, 255, 255, 0.94),
    rgba(244, 242, 255, 0.94)
  );
  box-shadow: 0 18px 34px rgba(116, 92, 255, 0.12);
}

.lip-sync-setup-card__resolution {
  flex-wrap: wrap;
}

.lip-sync-setup-card__resolution > span {
  color: var(--text-sub);
  font-size: 12px;
  font-weight: 700;
}

.lip-sync-setup-card__resolution > div {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.resolution-chip {
  min-height: 38px;
  padding: 0 14px;
  color: #6f7a92;
  font-size: 12px;
  font-weight: 700;
  border: 1px solid rgba(121, 144, 184, 0.16);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.82);
  cursor: pointer;
}

.resolution-chip--active {
  color: #6d42ff;
  border-color: rgba(122, 78, 255, 0.26);
  background: rgba(244, 240, 255, 0.92);
}

.smart-clip-layout {
  grid-template-columns: minmax(0, 1fr);
  align-items: stretch;
}

.smart-clip-stage {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  gap: 16px;
  width: 100%;
  min-height: 0;
}

.smart-clip-hero {
  display: flex;
  justify-content: space-between;
  gap: 18px;
  align-items: flex-end;
}

.smart-clip-kicker {
  display: inline-flex;
  width: fit-content;
  padding: 5px 10px;
  margin-bottom: 8px;
  color: #ffffff;
  border-radius: 999px;
  background: linear-gradient(135deg, var(--primary), var(--accent-teal));
  font-size: 11px;
  font-weight: 900;
  letter-spacing: 0.08em;
}

.smart-clip-hero h1 {
  margin: 0;
  color: var(--text-main);
  font-size: clamp(26px, 2vw, 36px);
  line-height: 1.08;
}

.smart-clip-hero p {
  margin: 8px 0 0;
  color: var(--text-sub);
  font-size: 14px;
}

.smart-clip-status-pill {
  display: grid;
  gap: 3px;
  min-width: 132px;
  padding: 12px 16px;
  text-align: right;
  border: 1px solid rgba(121, 144, 184, 0.18);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.82);
  box-shadow: var(--shadow-soft);
}

.smart-clip-status-pill span {
  color: var(--text-sub);
  font-size: 12px;
  font-weight: 800;
}

.smart-clip-status-pill strong {
  color: var(--primary);
  font-family: var(--font-display);
  font-size: 24px;
  line-height: 1;
}

.smart-clip-grid {
  display: grid;
  grid-template-columns: minmax(240px, 0.88fr) minmax(360px, 1.25fr) minmax(
      240px,
      0.9fr
    );
  gap: 14px;
  min-height: 0;
}

.smart-clip-card {
  min-width: 0;
  padding: 18px;
  border-color: rgba(121, 144, 184, 0.18);
  transition:
    border-color var(--transition-fast),
    transform var(--transition-fast),
    box-shadow var(--transition-fast);
}

.smart-clip-card:hover {
  border-color: rgba(121, 144, 184, 0.42);
  box-shadow: 0 22px 52px rgba(75, 107, 255, 0.11);
  transform: translateY(-2px);
}

.smart-template-list,
.smart-mode-grid,
.smart-config-list {
  display: grid;
  gap: 10px;
}

.smart-template-list {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.smart-template-option,
.smart-mode-card,
.smart-config-item {
  display: grid;
  gap: 4px;
  min-height: 74px;
  padding: 14px;
  color: var(--text-main);
  text-align: left;
  border: 1px solid rgba(121, 144, 184, 0.18);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.76);
  cursor: pointer;
  transition:
    border-color var(--transition-fast),
    background var(--transition-fast),
    transform var(--transition-fast),
    box-shadow var(--transition-fast);
}

.smart-template-option span,
.smart-mode-card span,
.smart-config-item span {
  color: var(--text-sub);
  font-size: 12px;
  line-height: 1.5;
}

.smart-template-option:hover,
.smart-mode-card:hover,
.smart-config-item:hover,
.smart-template-option--active,
.smart-mode-card--active,
.smart-config-item--active {
  border-color: rgba(123, 79, 255, 0.34);
  background: linear-gradient(
    180deg,
    rgba(255, 255, 255, 0.96),
    rgba(247, 243, 255, 0.92)
  );
  box-shadow: 0 18px 36px rgba(123, 79, 255, 0.12);
  transform: translateY(-1px);
}

.smart-toggle {
  min-width: 72px;
  height: 34px;
  color: #8190ad;
  border: 1px solid rgba(121, 144, 184, 0.22);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.78);
  cursor: pointer;
  font-weight: 900;
}

.smart-toggle--active {
  color: #ffffff;
  border-color: transparent;
  background: linear-gradient(135deg, var(--primary), var(--primary-deep));
}

.smart-mode-grid {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.smart-cut-summary {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  margin-top: 12px;
}

.smart-cut-summary div {
  display: grid;
  gap: 4px;
  padding: 12px;
  border: 1px solid rgba(121, 144, 184, 0.16);
  border-radius: 16px;
  background: rgba(248, 250, 255, 0.86);
}

.smart-cut-summary span {
  color: var(--text-sub);
  font-size: 11px;
  font-weight: 800;
}

.smart-cut-summary strong {
  color: var(--text-main);
  font-size: 17px;
}

.smart-cut-actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin-top: 12px;
}

.smart-subtitle-editor {
  grid-column: 1 / -1;
  min-height: 0;
}

.smart-subtitle-table {
  display: grid;
  gap: 8px;
  max-height: min(32vh, 340px);
  overflow: auto;
  padding-right: 5px;
}

.smart-subtitle-table::-webkit-scrollbar {
  width: 8px;
}

.smart-subtitle-table::-webkit-scrollbar-thumb {
  border: 2px solid rgba(255, 255, 255, 0.85);
  border-radius: 999px;
  background: rgba(123, 79, 255, 0.34);
}

.smart-subtitle-row {
  display: grid;
  grid-template-columns: minmax(170px, 0.32fr) minmax(0, 1fr) minmax(
      96px,
      0.16fr
    );
  gap: 10px;
  align-items: center;
  padding: 10px;
  border: 1px solid rgba(121, 144, 184, 0.14);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.78);
}

.smart-subtitle-row--head {
  position: sticky;
  top: 0;
  z-index: 1;
  color: var(--text-sub);
  font-size: 12px;
  font-weight: 900;
  background: rgba(247, 249, 255, 0.96);
}

.smart-time-fields {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  gap: 6px;
  align-items: center;
}

.smart-time-fields input {
  width: 100%;
  height: 34px;
  padding: 0 8px;
  color: var(--text-main);
  border: 1px solid rgba(121, 144, 184, 0.18);
  border-radius: 10px;
  background: rgba(248, 250, 255, 0.86);
  outline: none;
}

.smart-highlight-btn {
  min-height: 34px;
  color: var(--primary);
  border: 1px solid rgba(123, 79, 255, 0.22);
  border-radius: 12px;
  background: rgba(246, 242, 255, 0.82);
  cursor: pointer;
  font-weight: 900;
}

.smart-highlight-btn--active {
  color: #ffffff;
  border-color: transparent;
  background: linear-gradient(135deg, var(--primary), var(--primary-deep));
}

.smart-empty-note {
  padding: 18px;
  color: var(--text-sub);
  text-align: center;
  border: 1px dashed rgba(121, 144, 184, 0.28);
  border-radius: 18px;
  background: rgba(248, 250, 255, 0.72);
}

.smart-clip-footer {
  position: sticky;
  bottom: 0;
  z-index: 3;
  display: grid;
  grid-template-columns: minmax(130px, 0.24fr) minmax(0, 1fr) minmax(
      190px,
      0.34fr
    ) minmax(130px, 0.22fr);
  gap: 12px;
  align-items: center;
  padding: 14px;
  border: 1px solid rgba(121, 144, 184, 0.16);
  border-radius: 24px;
  background: rgba(255, 255, 255, 0.9);
  box-shadow: 0 -16px 38px rgba(61, 83, 128, 0.08);
  backdrop-filter: blur(18px);
}

.smart-render-progress {
  display: grid;
  gap: 6px;
  min-width: 0;
}

.smart-render-progress .smart-render-progress__track {
  display: block;
  height: 8px;
}

.smart-render-progress span {
  min-width: 0;
  overflow: hidden;
  color: var(--text-sub);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.smart-render-btn {
  min-height: 42px;
}

.smart-download-btn {
  display: grid;
  place-items: center;
  min-height: 42px;
  color: #ffffff;
  text-decoration: none;
  border-radius: 14px;
  background: linear-gradient(135deg, #16b89f, #45c8c2);
  box-shadow: 0 16px 32px rgba(22, 184, 159, 0.2);
  font-weight: 900;
}

.subtitle-template-panel,
.workflow-action-card,
.workflow-preview-stack {
  display: grid;
  gap: 12px;
}

.edit-main > .asset-card {
  padding: clamp(14px, 1vw, 18px);
}

.workflow-action-card > .segment-count-bar {
  display: none;
}

.workflow-action-card .input-actions--triple {
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: clamp(8px, 1vw, 14px);
  align-items: center;
  margin-top: 8px;
}

.workflow-action-card .input-actions--triple :deep(.n-button) {
  min-height: 40px;
  border-radius: 14px;
  font-size: 12px;
  font-weight: 800;
  transition:
    transform var(--transition-fast),
    box-shadow var(--transition-fast),
    border-color var(--transition-fast);
}

.workflow-action-card
  .input-actions--triple
  :deep(.n-button:not(.n-button--disabled):hover) {
  transform: translateY(-2px);
  box-shadow: 0 18px 34px rgba(75, 107, 255, 0.14);
}

.workflow-action-card .input-actions--triple .gradient-btn {
  min-height: 42px;
  font-size: 14px;
  box-shadow: 0 16px 32px rgba(75, 107, 255, 0.2);
}

.workflow-progress-card {
  display: grid;
  position: relative;
  grid-template-columns: minmax(132px, 0.58fr) minmax(0, 1.42fr) auto;
  gap: 12px;
  align-items: center;
  padding: 12px 14px 14px;
  overflow: hidden;
  border: 1px solid rgba(75, 107, 255, 0.16);
  border-radius: 26px;
  background:
    radial-gradient(
      circle at 92% 6%,
      rgba(75, 107, 255, 0.12),
      transparent 28%
    ),
    radial-gradient(
      circle at 0% 100%,
      rgba(69, 200, 194, 0.1),
      transparent 30%
    ),
    linear-gradient(180deg, rgba(255, 255, 255, 0.97), rgba(246, 250, 255, 0.9));
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.96),
    0 24px 58px rgba(61, 83, 128, 0.1);
}

.workflow-progress-card--done {
  border-color: rgba(31, 184, 133, 0.24);
  background:
    radial-gradient(
      circle at 12% 0%,
      rgba(31, 184, 133, 0.14),
      transparent 34%
    ),
    linear-gradient(
      180deg,
      rgba(250, 255, 253, 0.98),
      rgba(241, 253, 249, 0.92)
    );
}

.workflow-progress-card__head {
  display: contents;
}

.workflow-progress-card__head > div {
  grid-column: 1;
  grid-row: 1;
  min-width: 0;
}

.workflow-progress-card__head span {
  display: block;
  color: var(--primary);
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.06em;
}

.workflow-progress-card__head strong {
  display: block;
  margin-top: 2px;
  color: var(--text-main);
  font-size: clamp(18px, 0.72vw + 16px, 22px);
  line-height: 1.18;
}

.workflow-progress-card__head p {
  display: none;
}

.workflow-progress-card__head > b {
  position: relative;
  grid-column: 3;
  grid-row: 1;
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  width: 46px;
  height: 46px;
  padding: 0;
  color: #3557ff;
  text-align: center;
  border: 5px solid rgba(230, 236, 248, 0.92);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.78);
  box-shadow:
    inset 0 0 0 1px rgba(75, 107, 255, 0.08),
    0 14px 28px rgba(75, 107, 255, 0.12);
  font-family: var(--font-display);
  font-size: 15px;
  font-weight: 800;
}

.workflow-progress-card__head > b::after {
  position: absolute;
  inset: -5px;
  content: "";
  border-radius: inherit;
  background: conic-gradient(
    from 0deg,
    var(--primary) 0 var(--workflow-percent, 0%),
    var(--accent-teal) var(--workflow-percent, 0%)
      calc(var(--workflow-percent, 0%) + 6%),
    transparent calc(var(--workflow-percent, 0%) + 6%) 100%
  );
  mask: radial-gradient(
    farthest-side,
    transparent calc(100% - 5px),
    #000 calc(100% - 4px)
  );
  pointer-events: none;
}

.workflow-progress-track {
  display: none;
}

.workflow-progress-track i {
  position: relative;
  display: block;
  height: 100%;
  overflow: hidden;
  border-radius: inherit;
  background: linear-gradient(90deg, var(--primary), var(--accent-teal));
  box-shadow: 0 0 22px rgba(75, 107, 255, 0.22);
  transition: width 0.35s ease;
}

.workflow-progress-card--running .workflow-progress-track i::after {
  position: absolute;
  inset: 0;
  content: "";
  background: linear-gradient(
    90deg,
    transparent,
    rgba(255, 255, 255, 0.56),
    transparent
  );
  animation: workflow-progress-flow 1.2s linear infinite;
}

.workflow-progress-steps {
  position: relative;
  z-index: 1;
  display: grid;
  grid-column: 2;
  grid-row: 1;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: clamp(6px, 0.65vw, 10px);
  align-items: center;
  counter-reset: workflow-step;
  padding: 0;
  margin: 0;
  list-style: none;
}

.workflow-progress-steps li {
  counter-increment: workflow-step;
  display: grid;
  grid-template-columns: auto auto;
  gap: 10px;
  align-items: center;
  justify-self: stretch;
  min-width: 0;
  min-height: 36px;
  padding: 5px 7px;
  border: 1px solid rgba(121, 144, 184, 0.18);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.92);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.98),
    0 14px 26px rgba(61, 83, 128, 0.08);
  transition:
    transform var(--transition-fast),
    border-color var(--transition-fast),
    background var(--transition-fast),
    box-shadow var(--transition-fast);
}

.workflow-progress-steps li > b {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  color: #8190ad;
  font-size: 0;
  font-weight: 800;
  border-radius: 999px;
  background: linear-gradient(180deg, #f5f8ff, #e9eef8);
}

.workflow-progress-steps li > b::before {
  content: counter(workflow-step);
  font-size: 13px;
}

.workflow-progress-steps strong {
  display: block;
  color: var(--text-main);
  min-width: 0;
  overflow: hidden;
  font-size: clamp(11px, 0.22vw + 10px, 13px);
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.workflow-progress-steps span {
  display: none;
}

.workflow-progress-steps li.is-active {
  border-color: rgba(75, 107, 255, 0.32);
  background: linear-gradient(135deg, var(--primary), var(--accent-teal));
  box-shadow: 0 16px 34px rgba(75, 107, 255, 0.2);
  transform: translateY(-2px);
}

.workflow-progress-steps li.is-active strong {
  color: #ffffff;
}

.workflow-progress-steps li.is-active > b {
  color: var(--primary);
  background: rgba(255, 255, 255, 0.92);
  box-shadow: 0 0 18px rgba(255, 255, 255, 0.24);
}

.workflow-progress-steps li.is-done {
  border-color: rgba(69, 200, 194, 0.24);
  background: rgba(239, 253, 248, 0.94);
}

.workflow-progress-steps li.is-done > b {
  color: #138f85;
  background: rgba(69, 200, 194, 0.14);
}

@keyframes workflow-progress-flow {
  from {
    transform: translateX(-100%);
  }

  to {
    transform: translateX(100%);
  }
}

.template-chip-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}

.template-chip {
  display: grid;
  gap: 4px;
  padding: 12px 14px;
  color: var(--text-main);
  text-align: left;
  cursor: pointer;
  border: 1px solid rgba(121, 144, 184, 0.18);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.72);
  transition:
    border-color var(--transition-fast),
    box-shadow var(--transition-fast),
    transform var(--transition-smooth);
}

.template-chip span {
  color: var(--text-sub);
  font-size: 11px;
}

.template-chip:hover,
.template-chip--active {
  border-color: var(--border-strong);
  box-shadow: var(--shadow-soft);
  transform: translateY(-2px);
}

.section-title,
.section-title__main {
  display: flex;
  align-items: center;
  gap: 10px;
}

.section-title {
  margin-bottom: 18px;
}

.section-title--between {
  justify-content: space-between;
}

.section-title strong {
  display: block;
  font-size: 15px;
}

.section-title p {
  margin: 3px 0 0;
  color: var(--text-sub);
  font-size: 11px;
}

.title-icon {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  color: #ffffff;
  border-radius: 9px;
  background: linear-gradient(135deg, var(--primary), var(--accent-teal));
  box-shadow: 0 0 20px rgba(75, 107, 255, 0.18);
  font-size: 12px;
  font-weight: 800;
}

.title-icon--sound {
  background: linear-gradient(135deg, var(--primary), var(--primary-deep));
}

.summary-card,
.summary-pill,
.switch-row--card {
  display: grid;
  gap: 4px;
  padding: 12px 14px;
  border: 1px solid rgba(121, 144, 184, 0.18);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.72);
}

.summary-card {
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  margin-top: 14px;
}

.summary-card strong,
.summary-pill strong,
.publish-result-item strong,
.platform-item strong {
  word-break: break-word;
}

.summary-card p,
.summary-pill span,
.switch-row--card span {
  color: var(--text-sub);
  font-size: 11px;
}

.summary-card p {
  margin: 2px 0 0;
}

.full-script-preview {
  display: grid;
  gap: 10px;
  margin-bottom: 14px;
  padding: 16px;
  border: 1px solid rgba(75, 107, 255, 0.16);
  border-radius: 18px;
  background:
    radial-gradient(
      circle at 100% 0%,
      rgba(75, 107, 255, 0.12),
      transparent 28%
    ),
    rgba(255, 255, 255, 0.74);
}

.full-script-preview span {
  color: var(--primary);
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.04em;
}

.full-script-preview p {
  display: -webkit-box;
  max-height: 7.2em;
  margin: 0;
  overflow: hidden;
  color: var(--text-main);
  font-size: 13px;
  line-height: 1.8;
  white-space: pre-wrap;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 4;
}

.full-script-preview--empty {
  border-style: dashed;
  background: rgba(248, 250, 255, 0.72);
}

.full-script-preview--empty p {
  color: var(--text-sub);
}

.step-three-summary {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.step-three-summary .summary-pill {
  position: relative;
  grid-template-columns: auto minmax(0, 1fr);
  column-gap: 14px;
  align-items: center;
  min-width: 0;
  min-height: 48px;
  padding: 8px 12px;
  border-color: rgba(121, 144, 184, 0.2);
  border-radius: 18px;
  background:
    radial-gradient(circle at 0% 0%, rgba(75, 107, 255, 0.08), transparent 38%),
    rgba(255, 255, 255, 0.84);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.95),
    0 14px 30px rgba(61, 83, 128, 0.08);
}

.step-three-summary .summary-pill::before {
  display: grid;
  place-items: center;
  grid-row: 1 / span 2;
  width: 32px;
  height: 32px;
  color: var(--primary);
  border-radius: 999px;
  background: rgba(75, 107, 255, 0.08);
  font-size: 16px;
  font-weight: 800;
}

.step-three-summary .summary-pill:nth-child(1)::before {
  content: "人";
}

.step-three-summary .summary-pill:nth-child(2)::before {
  content: "声";
  color: #139d9a;
  background: rgba(69, 200, 194, 0.12);
}

.step-three-summary .summary-pill:nth-child(3)::before {
  content: "T";
  color: #7c4dff;
  background: rgba(124, 77, 255, 0.1);
}

.step-three-summary .summary-pill span,
.step-three-summary .summary-pill strong {
  grid-column: 2;
}

.workflow-helper-note {
  position: relative;
  display: block;
  padding-left: 30px;
  color: transparent;
  font-size: 0;
}

.workflow-helper-note::before {
  position: absolute;
  left: 0;
  top: 50%;
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  color: #ffffff;
  content: "i";
  border-radius: 999px;
  background: linear-gradient(135deg, var(--primary), var(--accent-teal));
  box-shadow: 0 8px 18px rgba(75, 107, 255, 0.18);
  font-size: 13px;
  font-weight: 800;
  transform: translateY(-50%);
}

.workflow-helper-note::after {
  color: var(--text-sub);
  content: "先生成音轨，再合成 5 秒无字幕预览；确认无误后输出完整成片。";
  font-size: 13px;
  line-height: 1.6;
}

.compact-label {
  display: inline-block;
  max-width: 6em;
  min-width: 4em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: bottom;
}

.step-three-checks {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}

.status-check {
  grid-template-columns: auto auto;
  align-items: center;
  width: max-content;
  min-width: 0;
  padding: 9px 11px;
  border-radius: 999px;
  transition:
    transform var(--transition-fast),
    border-color var(--transition-fast),
    box-shadow var(--transition-fast),
    background var(--transition-fast);
}

.status-check:hover {
  transform: translateY(-1px);
  box-shadow: 0 16px 30px rgba(77, 101, 152, 0.12);
}

.status-check b {
  display: grid;
  place-items: center;
  min-width: 22px;
  height: 22px;
  color: var(--text-main);
  font-size: 13px;
  line-height: 1;
}

.status-check b.compact-label {
  display: block;
  height: auto;
  line-height: 1.2;
  place-items: initial;
}

.status-check--ok {
  border-color: rgba(31, 184, 133, 0.24);
  background: rgba(236, 253, 245, 0.88);
}

.status-check--ok b {
  color: #0f9f6e;
}

.status-check--ok b:not(.compact-label) {
  border-radius: 999px;
  background: rgba(31, 184, 133, 0.12);
}

.status-check--fail {
  border-color: rgba(239, 68, 68, 0.22);
  background: rgba(255, 241, 242, 0.88);
}

.status-check--fail b {
  color: #ef4444;
}

.status-check--fail b:not(.compact-label) {
  border-radius: 999px;
  background: rgba(239, 68, 68, 0.1);
}

.avatar-empty {
  display: grid;
  place-items: center;
  min-height: 156px;
  margin-top: 14px;
  padding: 18px;
  text-align: center;
  border: 1px dashed rgba(121, 144, 184, 0.28);
  border-radius: 22px;
  background: rgba(255, 255, 255, 0.54);
}

.avatar-empty--compact {
  min-height: 138px;
}

.avatar-empty__icon {
  display: grid;
  place-items: center;
  width: 54px;
  height: 54px;
  margin-bottom: 8px;
  color: var(--primary);
  border-radius: 18px;
  background: rgba(75, 107, 255, 0.1);
  box-shadow: 0 0 22px rgba(75, 107, 255, 0.12);
}

.avatar-empty p {
  margin: 6px 0 0;
  color: var(--text-sub);
  font-size: 12px;
}

.edit-layout {
  grid-template-columns: minmax(0, 1fr) minmax(220px, min(260px, 24vw));
  align-items: stretch;
}

.edit-main,
.output-panel {
  grid-column: 1 / 2;
}

.edit-layout > .preview-side {
  grid-column: 2 / 3;
  grid-row: 1 / span 2;
}

.publish-layout {
  grid-template-columns: minmax(0, 0.92fr) minmax(0, 0.92fr) minmax(
      0,
      min(240px, 26vw)
    );
  align-items: stretch;
}

.summary-stack,
.result-stack,
.publish-result-list,
.platform-list {
  display: grid;
  gap: 12px;
}

.segment-count-bar,
.segment-result__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.segment-editor {
  display: grid;
  gap: 12px;
}

.video-segment-row {
  display: grid;
  gap: 8px;
}

.video-segment-label {
  font-size: 12px;
}

.video-segment-input :deep(.n-input),
.video-segment-input :deep(.n-input-wrapper) {
  background: rgba(248, 250, 255, 0.94);
}

.video-segment-result {
  padding: 16px;
  border: 1px solid rgba(121, 144, 184, 0.18);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.72);
}

.video-preview-wrap {
  margin-top: 10px;
  overflow: hidden;
  border: 1px solid rgba(121, 144, 184, 0.16);
  border-radius: 16px;
  background: rgba(236, 242, 255, 0.72);
}

.video-preview {
  display: block;
  width: 100%;
  max-height: 360px;
  background: #e8eef9;
}

.preview-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 12px;
}

.phone-preview {
  display: grid;
  place-items: center;
}

.phone-face {
  display: grid;
  place-items: center;
  width: min(210px, 100%);
  aspect-ratio: 9 / 16;
  color: #ffffff;
  border-radius: 24px;
  background:
    radial-gradient(
      circle at 50% 20%,
      rgba(75, 107, 255, 0.2),
      transparent 26%
    ),
    linear-gradient(180deg, #2a3856, #152036);
  box-shadow:
    0 18px 42px rgba(64, 86, 122, 0.22),
    0 0 34px rgba(75, 107, 255, 0.12);
  overflow: hidden;
}

.phone-face--video {
  padding: 0;
  background: #0f172a;
}

.phone-face--video video {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  background: #0f172a;
}

.publish-left,
.publish-center {
  display: grid;
  gap: 18px;
  min-height: 0;
  align-content: start;
}

.publish-hero {
  padding: 22px;
  color: var(--text-main);
  border: 1px solid var(--border-strong);
  border-radius: 20px;
  background:
    radial-gradient(
      circle at 90% 0%,
      rgba(75, 107, 255, 0.22),
      transparent 32%
    ),
    linear-gradient(
      135deg,
      rgba(255, 255, 255, 0.9),
      rgba(236, 242, 255, 0.94) 54%,
      rgba(228, 236, 248, 0.96)
    );
  box-shadow: 0 18px 44px rgba(75, 107, 255, 0.1);
}

.publish-hero h1 {
  margin: 0 0 6px;
}

.publish-hero p {
  margin: 0;
  opacity: 0.8;
}

.publish-stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  margin-top: 18px;
}

.publish-stats div {
  padding: 12px;
  border: 1px solid rgba(121, 144, 184, 0.18);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.72);
}

.publish-stats strong,
.publish-stats span {
  display: block;
}

.publish-stats span {
  margin-top: 4px;
  font-size: 11px;
  opacity: 0.72;
}

.publish-copy :deep(.n-input) {
  background: rgba(248, 250, 255, 0.94);
}

.cover-row {
  display: grid;
  grid-template-columns: 56px minmax(0, 1fr);
  gap: 14px;
  align-items: center;
  margin: 14px 0;
}

.cover-thumb {
  display: grid;
  place-items: center;
  width: 52px;
  height: 62px;
  color: #ffffff;
  border-radius: 12px;
  background: linear-gradient(145deg, var(--primary), var(--accent-teal));
  box-shadow: 0 0 24px rgba(75, 107, 255, 0.16);
  font-size: 12px;
}

.publish-result-item,
.platform-item {
  display: grid;
  gap: 4px;
  padding: 12px;
  border: 1px solid rgba(121, 144, 184, 0.14);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.66);
}

.publish-result-item p {
  margin: 0;
  color: var(--text-sub);
  font-size: 12px;
  line-height: 1.6;
}

.platform-item {
  grid-template-columns: 38px minmax(0, 1fr) auto;
  align-items: center;
  transition:
    border-color var(--transition-fast),
    background var(--transition-fast),
    transform var(--transition-smooth);
}

.platform-item:hover {
  border-color: var(--border-strong);
  background: rgba(75, 107, 255, 0.08);
  transform: translateX(4px);
}

.platform-item > span {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  color: #ffffff;
  border-radius: 10px;
  background: linear-gradient(135deg, var(--primary), var(--accent-teal));
  font-size: 12px;
}

.platform-item p {
  margin: 4px 0 0;
  color: var(--text-sub);
  font-size: 11px;
}

.schedule-options {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-bottom: 14px;
}

.schedule-options button {
  height: 38px;
  color: var(--text-sub);
  cursor: pointer;
  border: 1px solid rgba(121, 144, 184, 0.18);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.7);
}

.schedule-options button.active {
  color: #ffffff;
  background: linear-gradient(135deg, var(--primary), var(--accent-teal));
}

.publish-btn {
  height: 44px;
  margin-bottom: 14px;
  border-radius: 12px;
}

.plan-empty {
  display: grid;
  place-items: center;
  min-height: 88px;
  color: var(--text-sub);
  border-radius: 14px;
  border: 1px dashed rgba(121, 144, 184, 0.22);
  background: rgba(255, 255, 255, 0.58);
  font-size: 13px;
  text-align: center;
}

.phone-face--poster {
  align-content: end;
  gap: 6px;
  padding: 26px 14px;
  text-align: center;
  background:
    linear-gradient(180deg, transparent 45%, rgba(16, 28, 48, 0.72)),
    radial-gradient(
      circle at 50% 18%,
      rgba(75, 107, 255, 0.42),
      transparent 22%
    ),
    linear-gradient(180deg, #243453, #172235);
}

.phone-face--poster strong {
  color: #dce7ff;
  font-size: 19px;
}

.phone-face--poster span {
  font-size: 12px;
}

.meta-readonly {
  white-space: pre-wrap;
  line-height: 1.7;
}

.create-footer {
  position: fixed;
  right: var(--shell-pad, 18px);
  bottom: max(12px, var(--app-safe-bottom));
  left: calc(
    var(--shell-pad, 18px) + var(--shell-sidebar-width, 252px) +
      var(--shell-gap, 18px)
  );
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--vc-gap-lg);
  height: clamp(56px, 7vw, 62px);
  padding: 0 clamp(16px, 2vw, 22px);
  border: 1px solid rgba(255, 255, 255, 0.58);
  border-radius: 22px;
  border-top: 1px solid var(--border-soft);
  background: rgba(255, 255, 255, 0.82);
  box-shadow: 0 -10px 34px rgba(64, 86, 122, 0.1);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
}

.footer-progress {
  width: min(240px, 40vw);
}

.footer-progress strong {
  display: block;
  margin: 2px 0 4px;
  color: var(--primary);
  font-size: 12px;
}

.next-btn {
  min-width: 150px;
  border-color: rgba(75, 107, 255, 0.32);
  border-radius: 14px;
}

@media (min-width: 1281px) {
  :global(body) {
    overflow: hidden;
  }

  :global(.shell) {
    height: 100dvh;
  }

  :global(.shell__content),
  :global(.shell__main) {
    height: 100%;
    min-height: 0;
  }

  :global(.shell__main) {
    overflow: hidden;
  }

  .video-create {
    height: 100%;
    min-height: 0;
  }

  .create-layout,
  .step-two-layout,
  .edit-layout,
  .publish-layout {
    overflow: hidden;
  }

  .main-board {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    gap: var(--vc-gap-lg);
  }

  .workspace > .panel,
  .step-two-workbench > .panel,
  .edit-main > .panel,
  .edit-layout > .panel,
  .publish-left > .panel,
  .publish-center > .panel,
  .script-side,
  .preview-side {
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    scrollbar-gutter: stable;
  }

  .step-two-layout {
    grid-template-rows: auto minmax(0, 1fr);
  }

  .edit-main {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
    gap: var(--vc-gap-lg);
    min-height: 0;
  }

  .publish-left {
    grid-template-rows: auto minmax(0, 1fr);
    overflow: hidden;
  }

  .publish-center {
    grid-template-rows: minmax(0, 1fr) auto;
    overflow: hidden;
  }
}

.step-switch-enter-active,
.step-switch-leave-active {
  transition:
    opacity 0.24s ease,
    transform var(--transition-smooth),
    filter 0.24s ease;
}

.step-switch-enter-from {
  opacity: 0;
  filter: blur(8px);
  transform: translateY(12px) scale(0.992);
}

.step-switch-leave-to {
  opacity: 0;
  filter: blur(6px);
  transform: translateY(-8px) scale(0.992);
}

@media (max-width: 1280px) {
  .video-create {
    display: block;
    overflow: visible;
  }

  .create-topbar {
    grid-template-columns: 1fr;
  }

  .topbar-progress {
    justify-self: start;
    text-align: left;
  }

  .stepper {
    justify-content: flex-start;
    gap: 14px;
    flex-wrap: nowrap;
    overflow-x: auto;
    padding-bottom: 6px;
    scrollbar-width: none;
  }

  .stepper::-webkit-scrollbar {
    display: none;
  }

  .create-layout,
  .workspace,
  .step-two-workbench,
  .edit-layout,
  .publish-layout {
    grid-template-columns: 1fr;
    overflow: visible;
  }

  .script-side,
  .preview-side {
    min-height: 0;
    border-left: 0;
    border-top: 1px solid var(--border-soft);
  }

  .step-two-workbench > .panel {
    overflow: visible;
  }

  .step-two-hook-row,
  .step-two-slider-grid,
  .step-two-control-grid,
  .avatar-strip {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .lip-sync-setup-card__tabs {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (min-width: 1281px) and (max-width: 1540px) {
  .create-layout {
    grid-template-columns: 1fr;
  }

  .script-side {
    min-height: 0;
    border-left: 0;
    border-top: 1px solid var(--border-soft);
  }

  .step-two-workbench {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .step-two-avatar-panel {
    grid-column: 1 / -1;
  }

  .step-two-avatar-panel .avatar-strip {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }

  .edit-layout {
    grid-template-columns: minmax(0, 1fr) 300px;
  }

  .edit-main,
  .output-panel {
    grid-column: 1 / 2;
  }

  .edit-layout > .preview-side {
    grid-column: 2 / 3;
    grid-row: 1 / span 2;
  }

  .publish-layout {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .preview-side--publish {
    grid-column: 1 / -1;
    grid-row: auto;
    border-left: 0;
    border-top: 1px solid var(--border-soft);
  }
}

@media (max-width: 980px) {
  .panel-head,
  .panel-head--between,
  .section-title--between,
  .segment-count-bar,
  .segment-result__head,
  .outline-footer {
    align-items: flex-start;
    flex-direction: column;
  }

  .summary-card,
  .publish-stats {
    grid-template-columns: 1fr;
  }

  .workflow-progress-card__head {
    flex-direction: column;
  }

  .workflow-progress-card__head > b {
    align-self: flex-start;
  }

  .workflow-progress-card {
    grid-template-rows: auto auto;
    padding: 18px;
  }

  .workflow-progress-track {
    display: none;
  }

  .workflow-progress-steps {
    grid-template-columns: 1fr;
    grid-row: auto;
  }

  .workflow-progress-steps li {
    justify-self: stretch;
    justify-content: start;
  }

  .subtitle-table-head {
    display: none;
  }

  .subtitle-table li {
    grid-template-columns: 1fr;
    gap: 8px;
  }

  .hook-preview {
    grid-template-columns: 1fr;
  }

  .template-chip-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .benchmark-post-grid {
    grid-template-columns: 1fr;
  }

  .platform-item {
    grid-template-columns: 34px minmax(0, 1fr);
  }

  .platform-item :deep(.n-button) {
    grid-column: 2 / 3;
    justify-self: start;
  }

  .create-footer {
    height: auto;
    padding: 14px 16px calc(14px + var(--app-safe-bottom));
    flex-direction: column;
    align-items: stretch;
  }

  .footer-progress {
    width: 100%;
  }

  .create-footer :deep(.n-space) {
    justify-content: flex-end;
  }
}

@media (max-width: 860px) {
  .create-layout,
  .step-two-layout,
  .edit-layout,
  .publish-layout {
    padding-left: 14px;
    padding-right: 14px;
  }

  .input-actions,
  .outline-footer,
  .benchmark-input-row,
  .benchmark-action-row,
  .publish-stats,
  .schedule-options {
    grid-template-columns: 1fr;
    flex-direction: column;
  }

  .create-footer {
    left: 14px;
    right: 14px;
    bottom: max(14px, var(--app-safe-bottom));
    padding-left: 14px;
    padding-right: 14px;
  }
}

@media (max-width: 760px) {
  .video-create {
    padding-bottom: calc(148px + var(--app-safe-bottom));
  }

  .create-topbar {
    gap: 12px;
    padding: 14px;
  }

  .script-side,
  .preview-side,
  .panel,
  .publish-hero {
    border-radius: 18px;
  }

  .source-switch {
    grid-template-columns: 1fr;
  }

  .phone-face {
    width: min(220px, 100%);
  }

  .cover-row {
    grid-template-columns: 48px minmax(0, 1fr);
    align-items: start;
  }

  .next-btn {
    width: 100%;
  }
}

@media (max-width: 560px) {
  .create-layout,
  .step-two-layout,
  .edit-layout,
  .publish-layout {
    gap: 16px;
  }

  .step-two-block-head,
  .step-two-script-meta,
  .step-two-footnote,
  .voice-preview-card__head,
  .voice-preview-card__player,
  .lip-sync-setup-card__resolution {
    align-items: flex-start;
    flex-direction: column;
  }

  .step-two-hook-row,
  .step-two-slider-grid,
  .step-two-control-grid,
  .meta-board__summary,
  .step-three-summary,
  .avatar-strip,
  .lip-sync-setup-card__tabs {
    grid-template-columns: 1fr;
  }

  .input-actions--triple {
    grid-template-columns: 1fr;
  }

  .template-chip-grid {
    grid-template-columns: 1fr;
  }

  .step-two-workbench,
  .workspace {
    gap: 16px;
  }

  .benchmark-card {
    grid-template-columns: 1fr;
    justify-items: start;
  }

  .benchmark-card__check {
    justify-self: end;
  }

  .source-switch__item,
  .idea-action {
    min-height: 52px;
  }

  .script-side,
  .preview-side {
    padding: 16px 14px;
  }

  .phone-face {
    width: min(100%, 240px);
  }
}

.step-two-script-frame {
  min-height: 0;
  overflow: hidden;
  border: 1px solid rgba(121, 144, 184, 0.16);
  border-radius: 22px;
  background: linear-gradient(
    180deg,
    rgba(255, 255, 255, 0.94),
    rgba(247, 250, 255, 0.88)
  );
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.92);
}

.step-two-script-frame--empty {
  display: flex;
}

.step-two-script-frame--empty .empty-block--embedded {
  width: 100%;
  min-height: 100%;
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
}

.step-two-script-scroll {
  padding: 8px 0;
  scrollbar-gutter: stable;
}

.step-two-script-list {
  gap: 0;
}

.step-two-script-line {
  padding: 14px 16px;
  border: 0;
  border-bottom: 1px solid rgba(121, 144, 184, 0.12);
  border-radius: 0;
  background: transparent;
}

.step-two-script-line:last-child {
  border-bottom: 0;
}

.step-two-script-line span {
  padding-top: 2px;
  font-size: 11px;
}

.step-two-script-line p {
  font-size: clamp(13px, 0.45vw + 12px, 14px);
  font-weight: 650;
}

.step-two-hook-row {
  gap: 10px;
}

.step-two-hook-card {
  padding: 12px 14px;
  border-radius: 18px;
  background: linear-gradient(
    180deg,
    rgba(247, 242, 255, 0.96),
    rgba(245, 248, 255, 0.9)
  );
  box-shadow: none;
}

.step-two-voice-shell {
  display: grid;
  gap: 10px;
  align-content: start;
  min-height: 0;
  max-height: 100%;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 10px;
  padding-right: 12px;
  padding-bottom: 16px;
  border: 1px solid rgba(121, 144, 184, 0.14);
  border-radius: 22px;
  background: linear-gradient(
    180deg,
    rgba(248, 250, 255, 0.96),
    rgba(240, 245, 255, 0.9)
  );
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.92);
  scrollbar-gutter: stable;
  scrollbar-width: thin;
  scrollbar-color: rgba(75, 107, 255, 0.32) transparent;
}

.step-two-voice-shell::-webkit-scrollbar {
  width: 8px;
}

.step-two-voice-shell::-webkit-scrollbar-track {
  margin: 14px 0;
  border-radius: 999px;
  background: transparent;
}

.step-two-voice-shell::-webkit-scrollbar-thumb {
  min-height: 42px;
  border: 2px solid rgba(255, 255, 255, 0.72);
  border-radius: 999px;
  background: linear-gradient(
      180deg,
      rgba(75, 107, 255, 0.34),
      rgba(75, 199, 187, 0.42)
    )
    padding-box;
}

.step-two-voice-panel {
  overflow: hidden !important;
}

.step-two-voice-panel .step-two-slider-grid {
  display: grid;
}

.step-two-control-grid,
.step-two-slider-grid {
  gap: 8px;
}

.step-two-control-card,
.step-two-slider-card,
.voice-preview-card {
  border-radius: 18px;
  box-shadow: none;
}

.step-two-control-card,
.step-two-slider-card {
  padding: 10px 12px;
  background: rgba(255, 255, 255, 0.86);
}

.step-two-control-card__main {
  gap: 12px;
}

.step-two-control-card :deep(.n-base-selection),
.step-two-control-card :deep(.n-base-selection-label),
.step-two-control-card :deep(.n-base-selection-tags),
.step-two-control-card :deep(.n-input-wrapper) {
  min-height: 44px;
  border-radius: 14px;
  background: rgba(247, 249, 255, 0.94);
}

.step-two-slider-card {
  gap: 8px;
}

.step-two-slider-card :deep(.n-slider-rail) {
  height: 6px;
  border-radius: 999px;
  background: rgba(191, 201, 223, 0.42);
}

.step-two-slider-card :deep(.n-slider-fill) {
  background: linear-gradient(90deg, #5d72ff, #7d47ff);
}

.step-two-slider-card :deep(.n-slider-handle) {
  box-shadow: 0 10px 22px rgba(106, 89, 255, 0.22);
}

.voice-power-stepper {
  border-radius: 16px;
  background: rgba(247, 249, 255, 0.94);
  box-shadow: none;
}

.voice-power-stepper button {
  min-height: 44px;
  font-size: 18px;
}

.step-two-inline-alert {
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.78);
}

.step-two-primary-btn {
  min-height: 48px;
  flex-shrink: 0;
  border-radius: 16px;
  font-size: 15px;
}

.voice-generate-progress {
  flex-shrink: 0;
  width: 100%;
}

.voice-preview-card {
  padding: 12px 14px;
  background: rgba(255, 255, 255, 0.86);
}

.voice-preview-card__player {
  padding: 12px 14px;
  border-radius: 16px;
}

.voice-source-switch {
  padding: 5px;
  border-radius: 20px;
}

.voice-source-switch__item {
  min-height: 44px;
}

.step-two-avatar-panel {
  align-content: start;
}

.step-two-block-head :deep(.n-button) {
  height: 36px;
  padding: 0 14px;
  border-radius: 999px;
  background: rgba(245, 242, 255, 0.92);
}

.avatar-strip--filled {
  grid-template-columns: none;
  grid-auto-flow: column;
  grid-auto-columns: min(100%, clamp(104px, 9.8vw, 122px));
  align-items: start;
  overflow-x: auto;
  padding-bottom: 8px;
  scrollbar-color: rgba(75, 107, 255, 0.2) transparent;
}

.avatar-empty-state {
  display: grid;
  gap: 10px;
  align-content: start;
}

.avatar-empty-state__hint {
  margin: 0;
  color: var(--text-sub);
  font-size: 12px;
  line-height: 1.7;
}

.avatar-add-card,
.avatar-select-card {
  min-height: clamp(150px, 17vw, 172px);
  padding: 10px 10px 8px;
  border-radius: clamp(18px, 1.6vw, 22px);
}

.avatar-add-card--compact {
  width: min(100%, clamp(104px, 9.8vw, 122px));
}

.avatar-add-card--empty {
  width: min(136px, 100%);
  min-height: clamp(154px, 18vw, 176px);
  justify-self: start;
  align-content: center;
}

.avatar-select-card__image,
.avatar-select-card__video,
.avatar-select-card__placeholder {
  aspect-ratio: 9 / 13;
  border-radius: clamp(15px, 1.35vw, 18px);
}

.avatar-select-card__name {
  text-align: center;
  font-size: 11px;
  color: var(--text-light);
}

.lip-sync-setup-card {
  gap: 11px;
  padding: 12px;
  border-radius: 22px;
  background: linear-gradient(
    180deg,
    rgba(255, 255, 255, 0.96),
    rgba(246, 249, 255, 0.9)
  );
}

.lip-sync-setup-card__tabs {
  gap: 8px;
}

.lip-sync-setup-card__tab {
  padding: 11px 12px;
  border-radius: 14px;
}

.lip-sync-setup-card__tab strong {
  font-size: 14px;
}

.lip-sync-setup-card__summary {
  gap: 8px;
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.lip-sync-setup-card__summary .summary-pill {
  padding: 8px 10px;
  border-radius: 14px;
  background: rgba(248, 250, 255, 0.92);
  min-width: 0;
}

.lip-sync-setup-card__summary .summary-pill strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (min-width: 1281px) and (max-width: 1540px) {
  .step-two-workbench {
    grid-template-columns: minmax(0, 0.92fr) minmax(0, 1.08fr);
  }

  .step-two-avatar-panel {
    grid-column: 1 / -1;
  }

  .avatar-strip--filled {
    grid-auto-columns: min(100%, clamp(104px, 11vw, 124px));
  }
}

@media (max-width: 980px) {
  .smart-clip-hero,
  .smart-clip-footer {
    grid-template-columns: 1fr;
  }

  .smart-clip-hero {
    display: grid;
    align-items: start;
  }

  .smart-clip-status-pill {
    text-align: left;
  }

  .smart-clip-grid {
    grid-template-columns: 1fr;
  }

  .smart-template-list,
  .smart-mode-grid,
  .smart-cut-summary,
  .smart-cut-actions {
    grid-template-columns: 1fr;
  }

  .smart-subtitle-row {
    grid-template-columns: 1fr;
  }

  .script-extract-actions {
    grid-template-columns: 1fr;
    gap: 14px;
  }

  .script-extract-footer {
    align-items: stretch;
  }

  .step-two-control-grid,
  .step-two-slider-grid,
  .lip-sync-setup-card__summary {
    grid-template-columns: 1fr;
  }

  .avatar-strip--filled {
    grid-auto-flow: row;
    grid-auto-columns: initial;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    overflow-x: visible;
  }
}

@media (max-width: 560px) {
  .avatar-strip--filled {
    grid-template-columns: 1fr;
  }

  .avatar-add-card--compact,
  .avatar-add-card--empty {
    width: 100%;
  }
}

.smart-editor-shell {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(330px, 23vw);
  gap: 0;
  width: 100%;
  min-height: calc(100vh - 160px);
  overflow: hidden;
  border: 1px solid rgba(226, 232, 240, 0.92);
  border-radius: 0;
  background: rgba(255, 255, 255, 0.98);
  box-shadow: 0 24px 70px rgba(61, 83, 128, 0.08);
}

.smart-editor-main {
  display: grid;
  grid-template-columns: minmax(340px, 0.95fr) minmax(430px, 1fr);
  grid-template-rows: auto minmax(0, 1fr);
  gap: 24px;
  min-width: 0;
  padding: clamp(22px, 2vw, 34px);
}

.smart-editor-head {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
}

.smart-editor-head h1 {
  margin: 0;
  color: #111827;
  font-size: clamp(30px, 2.8vw, 46px);
  line-height: 1;
  letter-spacing: -0.04em;
}

.smart-editor-head span {
  padding: 12px 18px;
  color: #7d8799;
  border-radius: 999px;
  background: #f5f6f8;
  font-size: 13px;
  font-weight: 800;
}

.smart-editor-left {
  display: grid;
  align-content: start;
  gap: 26px;
  min-width: 0;
}

.smart-left-section-title {
  display: flex;
  gap: 12px;
  align-items: center;
}

.smart-left-icon {
  display: grid;
  place-items: center;
  width: 42px;
  height: 42px;
  color: #ffffff;
  border-radius: 12px;
  background: linear-gradient(135deg, #7c3aed, #9b5cff);
  box-shadow: 0 14px 28px rgba(124, 58, 237, 0.22);
  font-size: 22px;
  font-weight: 900;
}

.smart-left-section-title strong,
.smart-subtitle-head strong,
.smart-result-head strong {
  display: block;
  color: #111827;
  font-size: 18px;
  font-weight: 900;
}

.smart-left-section-title p,
.smart-subtitle-head span {
  margin: 2px 0 0;
  color: #98a2b3;
  font-size: 12px;
  font-weight: 700;
}

.smart-style-card {
  position: relative;
  display: grid;
  grid-template-columns: 118px minmax(0, 1fr) auto;
  gap: 24px;
  align-items: center;
  min-height: 210px;
  padding: 24px;
  border: 1px solid #edf0f5;
  border-radius: 24px;
  background: #ffffff;
  box-shadow: 0 18px 44px rgba(15, 23, 42, 0.04);
}

.smart-style-cover {
  width: 112px;
  height: 164px;
  overflow: hidden;
  border-radius: 12px;
  background: linear-gradient(135deg, #f0f4ff, #faf7ff);
  box-shadow: 0 14px 28px rgba(15, 23, 42, 0.13);
}

.smart-style-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.smart-style-cover__empty {
  display: grid;
  place-items: center;
  height: 100%;
  color: #7c3aed;
  font-weight: 900;
}

.smart-style-info {
  display: grid;
  gap: 10px;
  min-width: 0;
}

.smart-style-info > span,
.smart-style-info label {
  color: #9aa4b5;
  font-size: 12px;
  font-weight: 900;
}

.smart-style-name {
  display: inline-flex;
  gap: 8px;
  align-items: center;
  width: fit-content;
  max-width: 100%;
  padding: 0;
  color: #111827;
  border: 0;
  background: transparent;
  cursor: pointer;
  font-size: 18px;
  font-weight: 900;
}

.smart-style-name i {
  color: #b2bac9;
  font-style: normal;
}

.smart-template-change,
.smart-title-row button {
  height: 38px;
  padding: 0 16px;
  color: #7c3aed;
  border: 1px solid rgba(124, 58, 237, 0.13);
  border-radius: 14px;
  background: #f6f1ff;
  box-shadow: 0 10px 24px rgba(124, 58, 237, 0.08);
  cursor: pointer;
  font-size: 13px;
  font-weight: 900;
}

.smart-title-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 10px;
}

.smart-title-row input,
.smart-title-input {
  width: 100%;
  height: 38px;
  padding: 0 16px;
  color: #111827;
  border: 0;
  border-radius: 12px;
  background: #f6f7f9;
  outline: none;
  font-weight: 900;
}

.smart-option-list {
  display: grid;
  gap: 24px;
  padding-top: 10px;
}

.smart-option-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
}

.smart-option-row > div {
  display: inline-flex;
  gap: 14px;
  align-items: center;
  color: #111827;
  font-size: 17px;
  font-weight: 900;
}

.smart-option-icon {
  display: inline-grid;
  place-items: center;
  width: 28px;
  color: #a4adbc;
  font-size: 22px;
  font-weight: 700;
}

.smart-switch,
.smart-mini-switch {
  position: relative;
  width: 56px;
  height: 30px;
  border: 0;
  border-radius: 999px;
  background: #c8c9cc;
  cursor: pointer;
  transition: background 0.2s ease;
}

.smart-switch::after,
.smart-mini-switch::after {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 24px;
  height: 24px;
  content: "";
  border-radius: 50%;
  background: #ffffff;
  box-shadow: 0 3px 8px rgba(15, 23, 42, 0.2);
  transition: transform 0.2s ease;
}

.smart-switch--on,
.smart-mini-switch--on {
  background: #8b5cf6;
}

.smart-switch--on::after,
.smart-mini-switch--on::after {
  transform: translateX(26px);
}

.smart-cut-inline {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  padding-left: 42px;
  margin-top: -12px;
}

.smart-cut-inline button {
  height: 30px;
  padding: 0 12px;
  color: #667085;
  border: 1px solid #e7eaf0;
  border-radius: 999px;
  background: #ffffff;
  cursor: pointer;
  font-size: 12px;
  font-weight: 900;
}

.smart-cut-inline button.active {
  color: #7c3aed;
  border-color: rgba(124, 58, 237, 0.22);
  background: #f6f1ff;
}

.smart-cut-inline span {
  color: #98a2b3;
  font-size: 12px;
  font-weight: 800;
}

.smart-music-row {
  display: grid;
  grid-template-columns: 38px minmax(150px, 1fr) 26px minmax(90px, 0.6fr) 78px;
  gap: 10px;
  align-items: center;
  padding-left: 42px;
  margin-top: -18px;
}

.smart-play-dot {
  display: grid;
  place-items: center;
  height: 38px;
  color: #7c3aed;
  border: 0;
  border-radius: 50%;
  background: #efe7ff;
}

.smart-music-row select,
.smart-music-row b {
  height: 38px;
  padding: 0 12px;
  color: #667085;
  border: 1px solid #e7eaf0;
  border-radius: 12px;
  background: #f8f9fb;
  font-weight: 800;
}

.smart-music-row b {
  display: grid;
  place-items: center;
}

.smart-music-row input {
  accent-color: #7c3aed;
}

.smart-subtitle-workbench {
  position: relative;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  border: 1px solid #edf0f5;
  border-radius: 22px;
  background: #ffffff;
  box-shadow: 0 18px 44px rgba(15, 23, 42, 0.04);
}

.smart-subtitle-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 22px 24px 16px;
  border-bottom: 1px solid #f0f2f6;
}

.smart-subtitle-head > div:first-child {
  display: grid;
  grid-template-columns: 6px auto;
  column-gap: 14px;
  align-items: center;
}

.smart-subtitle-head i {
  grid-row: 1 / span 2;
  width: 6px;
  height: 28px;
  border-radius: 999px;
  background: #7c3aed;
}

.smart-subtitle-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  justify-content: flex-end;
}

.smart-subtitle-actions label {
  display: inline-flex;
  gap: 8px;
  align-items: center;
  color: #111827;
  font-size: 13px;
  font-weight: 900;
}

.smart-mini-switch {
  width: 34px;
  height: 20px;
}

.smart-mini-switch::after {
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
}

.smart-mini-switch--on::after {
  transform: translateX(14px);
}

.smart-subtitle-actions button {
  height: 30px;
  padding: 0 12px;
  color: #7c3aed;
  border: 1px solid rgba(124, 58, 237, 0.22);
  border-radius: 999px;
  background: #ffffff;
  cursor: pointer;
  font-size: 12px;
  font-weight: 900;
}

.smart-subtitle-actions button.danger,
.smart-result-actions button.danger {
  color: #ef4444;
  border-color: rgba(239, 68, 68, 0.26);
}

.smart-subtitle-actions button.success {
  color: #16a34a;
  border-color: rgba(22, 163, 74, 0.22);
  background: #f0fdf4;
}

.smart-line-editor {
  min-height: 0;
  overflow: auto;
  padding: 2px 24px 20px;
}

.smart-line-editor::-webkit-scrollbar {
  width: 8px;
}

.smart-line-editor::-webkit-scrollbar-thumb {
  border: 2px solid #ffffff;
  border-radius: 999px;
  background: rgba(124, 58, 237, 0.28);
}

.smart-line-row {
  display: grid;
  grid-template-columns: 48px minmax(0, 1fr) 54px;
  gap: 12px;
  align-items: center;
  min-height: 54px;
  border-bottom: 1px solid #f2f4f7;
}

.smart-line-row > span {
  color: #ccd2dc;
  font-size: 12px;
  font-weight: 900;
}

.smart-line-row textarea {
  width: 100%;
  resize: none;
  color: #253047;
  border: 0;
  background: transparent;
  outline: none;
  font-size: 16px;
  font-weight: 900;
  line-height: 1.35;
}

.smart-line-row textarea::selection {
  color: #111827;
  background: rgba(255, 217, 74, 0.5);
}

.smart-line-row button {
  height: 28px;
  color: #b45309;
  border: 0;
  border-radius: 8px;
  background: rgba(255, 217, 74, 0.24);
  cursor: pointer;
  font-size: 12px;
  font-weight: 900;
}

.smart-line-row button.active {
  background: rgba(255, 217, 74, 0.52);
}

.smart-line-empty {
  display: grid;
  place-items: center;
  min-height: 220px;
  color: #98a2b3;
  font-weight: 800;
}

.smart-main-render {
  width: calc(100% - 48px);
  min-height: 52px;
  margin: 0 24px 20px;
  color: #ffffff;
  border: 0;
  border-radius: 18px;
  background: linear-gradient(135deg, #7c3aed, #8b5cf6);
  box-shadow: 0 16px 34px rgba(124, 58, 237, 0.22);
  cursor: pointer;
  font-size: 17px;
  font-weight: 900;
}

.smart-main-render:disabled {
  opacity: 0.72;
  cursor: wait;
}

.smart-result-panel {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  min-width: 0;
  min-height: 0;
  padding: 28px;
  border-left: 1px solid #edf0f5;
  background:
    radial-gradient(
      circle at 70% 8%,
      rgba(124, 58, 237, 0.04),
      transparent 28%
    ),
    #ffffff;
}

.smart-result-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 22px;
}

.smart-result-head > div:first-child {
  display: inline-flex;
  gap: 10px;
  align-items: center;
  color: #a78bfa;
}

.smart-result-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}

.smart-result-actions button,
.smart-result-actions a {
  display: inline-grid;
  place-items: center;
  height: 38px;
  padding: 0 14px;
  color: #7c3aed;
  text-decoration: none;
  border: 1px solid rgba(124, 58, 237, 0.22);
  border-radius: 10px;
  background: #ffffff;
  cursor: pointer;
  font-size: 13px;
  font-weight: 900;
}

.smart-result-actions a {
  color: #ffffff;
  border-color: transparent;
  background: linear-gradient(135deg, #7c3aed, #8b5cf6);
}

.smart-result-actions a.disabled {
  opacity: 0.48;
  pointer-events: none;
}

.smart-phone-result {
  display: grid;
  place-items: center;
  min-height: 0;
}

.smart-phone-result video,
.smart-phone-placeholder {
  width: min(100%, 370px);
  aspect-ratio: 9 / 16;
  overflow: hidden;
  border-radius: 34px;
  background: #ede5d8;
  box-shadow: 0 26px 54px rgba(15, 23, 42, 0.18);
}

.smart-phone-result video,
.smart-phone-placeholder img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.smart-phone-placeholder {
  position: relative;
}

.smart-phone-placeholder::after {
  position: absolute;
  inset: 0;
  content: "";
  background: linear-gradient(
    180deg,
    rgba(0, 0, 0, 0.08),
    transparent 38%,
    rgba(0, 0, 0, 0.58)
  );
}

.smart-phone-copy {
  position: absolute;
  z-index: 1;
  inset: 64px 20px 24px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  color: #ffffff;
  text-shadow: 0 3px 8px rgba(0, 0, 0, 0.35);
}

.smart-phone-copy strong {
  color: #64f4a3;
  font-size: clamp(26px, 2vw, 40px);
  font-weight: 1000;
  line-height: 1.05;
}

.smart-phone-copy b {
  font-size: clamp(24px, 1.7vw, 36px);
  font-weight: 1000;
  line-height: 1.05;
}

.smart-phone-copy span {
  font-size: 18px;
  font-weight: 1000;
}

.smart-result-status {
  display: grid;
  gap: 8px;
  margin-top: 18px;
}

.smart-result-track {
  display: block;
  height: 8px;
}

.smart-result-status span {
  color: #667085;
  font-size: 12px;
  font-weight: 800;
}

@media (max-width: 1280px) {
  .smart-editor-shell {
    grid-template-columns: 1fr;
  }

  .smart-result-panel {
    border-top: 1px solid #edf0f5;
    border-left: 0;
  }
}

@media (max-width: 980px) {
  .smart-editor-main {
    grid-template-columns: 1fr;
  }

  .smart-editor-head,
  .smart-result-head {
    align-items: flex-start;
    flex-direction: column;
  }
}

.smart-editor-shell {
  grid-template-columns: minmax(1020px, 1fr) clamp(390px, 24vw, 482px);
  min-height: calc(100vh - 128px);
}

.smart-editor-main {
  grid-template-columns: minmax(500px, 1.04fr) minmax(500px, 0.96fr);
  column-gap: clamp(28px, 2.6vw, 46px);
  row-gap: 22px;
  padding: clamp(30px, 3vw, 52px) clamp(28px, 2vw, 40px) 28px
    clamp(38px, 3vw, 58px);
}

.smart-editor-head {
  min-height: 58px;
}

.smart-editor-head h1 {
  font-size: clamp(34px, 2.5vw, 48px);
  font-weight: 1000;
  letter-spacing: -0.045em;
}

.smart-editor-head span {
  min-width: 420px;
  padding: 11px 18px;
  text-align: center;
  font-size: 12px;
}

.smart-left-section-title {
  min-height: 48px;
}

.smart-left-section-title strong,
.smart-subtitle-head strong,
.smart-result-head strong {
  font-size: 18px;
  line-height: 1.18;
}

.smart-left-section-title p,
.smart-subtitle-head span {
  font-size: 12px;
  line-height: 1.25;
}

.smart-style-card {
  grid-template-columns: 122px minmax(0, 1fr) 124px;
  min-height: 238px;
  padding: 24px;
  border-radius: 24px;
}

.smart-style-cover {
  width: 118px;
  height: 188px;
}

.smart-style-info {
  gap: 11px;
}

.smart-style-info > span,
.smart-style-info label {
  font-size: 12px;
  line-height: 1;
}

.smart-style-name {
  max-width: 280px;
  overflow: hidden;
  font-size: 18px;
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.smart-title-row input,
.smart-title-input {
  height: 40px;
  font-size: 14px;
}

.smart-title-row button,
.smart-template-change {
  height: 38px;
  font-size: 13px;
}

.smart-option-list {
  gap: 30px;
  padding-top: 18px;
}

.smart-option-row {
  min-height: 48px;
}

.smart-option-row > div {
  font-size: 18px;
  line-height: 1.1;
}

.smart-switch {
  width: 56px;
  height: 30px;
}

.smart-pip-strip {
  display: grid;
  grid-template-columns: 118px 118px 1fr;
  gap: 16px;
  align-items: end;
  padding-left: 42px;
  margin-top: -18px;
}

.smart-pip-add,
.smart-pip-thumb {
  display: grid;
  place-items: center;
  width: 118px;
  height: 150px;
  overflow: hidden;
  border-radius: 12px;
  background: #ffffff;
}

.smart-pip-add {
  gap: 6px;
  color: #98a2b3;
  border: 1px dashed #d9dee8;
  cursor: pointer;
  font-size: 14px;
  font-weight: 800;
}

.smart-pip-add span {
  display: grid;
  place-items: center;
  width: 42px;
  height: 42px;
  border-radius: 999px;
  background: #f7f8fb;
  font-size: 28px;
  font-weight: 400;
}

.smart-pip-add b {
  font-size: 13px;
}

.smart-pip-thumb {
  border: 1px solid #edf0f5;
  box-shadow: 0 12px 24px rgba(15, 23, 42, 0.08);
}

.smart-pip-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.smart-pip-thumb span {
  color: #98a2b3;
  font-weight: 900;
}

.smart-pip-config {
  justify-self: end;
  align-self: start;
  padding: 0;
  color: #7c3aed;
  border: 0;
  background: transparent;
  cursor: pointer;
  font-size: 13px;
  font-weight: 900;
}

.smart-music-row {
  grid-template-columns: 38px minmax(170px, 1fr) 24px minmax(112px, 0.7fr) 82px;
  gap: 10px;
}

.smart-subtitle-workbench {
  min-height: 724px;
  border-radius: 22px;
}

.smart-subtitle-head {
  min-height: 72px;
  padding: 18px 24px 14px;
}

.smart-subtitle-actions {
  gap: 8px;
}

.smart-subtitle-actions button {
  height: 30px;
  padding: 0 12px;
  font-size: 12px;
}

.smart-line-editor {
  padding: 0 24px 18px;
}

.smart-line-row {
  grid-template-columns: 42px minmax(0, 1fr) 52px;
  gap: 12px;
  min-height: 50px;
}

.smart-line-row > span {
  font-size: 12px;
}

.smart-line-row textarea {
  min-height: 28px;
  font-size: 16px;
  line-height: 1.36;
}

.smart-main-render {
  width: calc(100% - 48px);
  min-height: 54px;
  margin: 0 24px 18px;
  border-radius: 18px;
  font-size: 18px;
}

.smart-result-panel {
  padding: 30px 28px 28px;
}

.smart-result-head {
  min-height: 42px;
  margin-bottom: 20px;
}

.smart-result-actions {
  gap: 8px;
}

.smart-result-actions button,
.smart-result-actions a {
  height: 38px;
  min-width: 72px;
  padding: 0 13px;
  font-size: 13px;
}

.smart-phone-result video,
.smart-phone-placeholder {
  width: min(100%, 392px);
  max-height: calc(100vh - 246px);
  border-radius: 34px;
}

.smart-phone-copy {
  inset: 70px 24px 28px;
}

.smart-phone-copy strong {
  font-size: clamp(30px, 2.1vw, 42px);
}

.smart-phone-copy b {
  font-size: clamp(26px, 1.8vw, 38px);
}

.smart-phone-copy span {
  font-size: 18px;
  line-height: 1.35;
}

.smart-result-status {
  min-height: 42px;
}

@media (max-width: 1440px) {
  .smart-editor-shell {
    grid-template-columns: minmax(0, 1fr) 360px;
  }

  .smart-editor-main {
    grid-template-columns: minmax(420px, 1fr) minmax(430px, 1fr);
    padding-left: 34px;
  }

  .smart-style-card {
    grid-template-columns: 104px minmax(0, 1fr);
  }

  .smart-template-change {
    grid-column: 2;
    width: fit-content;
  }
}

/* 第三步按对标平台重新校准：固定外框节奏，内部三栏独立，避免右侧结果覆盖编辑区。 */
.video-create {
  padding-bottom: 92px;
  background: #f8f9fc;
}

.create-topbar {
  grid-template-columns: 160px minmax(0, 1fr) 160px;
  min-height: 80px;
  padding: 0 38px;
  border-bottom: 1px solid #e8ebf2;
  background: #ffffff;
  box-shadow: none;
}

.topbar-progress {
  display: none;
}

.back-link {
  font-size: 15px;
}

.stepper {
  gap: 28px;
}

.stepper__item {
  gap: 10px;
  font-size: 14px;
}

.stepper__item span {
  width: 34px;
  height: 34px;
  font-size: 14px;
}

.smart-clip-layout {
  height: calc(100dvh - 80px - 92px);
  padding: 34px 0 0 32px;
  overflow: hidden;
  background: #f8f9fc;
}

.smart-editor-shell {
  grid-template-columns: minmax(0, 1fr) 442px;
  width: 100%;
  height: 100%;
  min-height: 0;
  margin: 0;
  overflow: hidden;
  border: 1px solid #eef1f6;
  border-right: 0;
  border-radius: 32px 0 0 0;
  background: #ffffff;
  box-shadow: none;
}

.smart-editor-main {
  grid-template-columns: minmax(0, 572px) minmax(0, 1fr);
  grid-template-rows: 72px minmax(0, 1fr);
  column-gap: 34px;
  row-gap: 20px;
  min-width: 0;
  height: 100%;
  padding: 42px 34px 0 40px;
  overflow: hidden;
}

.smart-editor-head {
  min-height: 0;
  align-items: flex-start;
}

.smart-editor-head h1 {
  font-size: 36px;
  line-height: 1.05;
  letter-spacing: -0.04em;
}

.smart-editor-head span {
  min-width: 0;
  max-width: 360px;
  padding: 10px 16px;
  margin-top: 4px;
  color: #8a93a5;
  background: #f3f4f7;
  font-size: 12px;
}

.smart-editor-left {
  gap: 28px;
  min-height: 0;
  overflow: hidden;
}

.smart-left-section-title {
  min-height: 42px;
}

.smart-left-icon {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  font-size: 20px;
}

.smart-left-section-title strong,
.smart-subtitle-head strong,
.smart-result-head strong {
  font-size: 18px;
}

.smart-left-section-title p,
.smart-subtitle-head span {
  font-size: 12px;
}

.smart-style-card {
  grid-template-columns: 112px minmax(0, 1fr) 116px;
  gap: 22px;
  align-items: center;
  min-height: 200px;
  padding: 20px;
  border-color: #eef1f6;
  border-radius: 20px;
  box-shadow: none;
}

.smart-style-cover {
  width: 92px;
  height: 156px;
  justify-self: center;
  border-radius: 10px;
}

.smart-style-info {
  gap: 9px;
}

.smart-style-name {
  max-width: 260px;
  font-size: 17px;
}

.smart-title-row input,
.smart-title-input {
  height: 36px;
  padding: 0 14px;
  border-radius: 10px;
  font-size: 13px;
}

.smart-title-row button,
.smart-template-change {
  height: 36px;
  padding: 0 14px;
  border-radius: 12px;
  font-size: 12px;
}

.smart-option-list {
  gap: 27px;
  padding-top: 10px;
}

.smart-option-row {
  min-height: 42px;
}

.smart-option-row > div {
  gap: 14px;
  font-size: 17px;
}

.smart-option-icon {
  width: 28px;
  font-size: 21px;
}

.smart-switch {
  width: 48px;
  height: 26px;
}

.smart-switch::after {
  top: 3px;
  left: 3px;
  width: 20px;
  height: 20px;
}

.smart-switch--on::after {
  transform: translateX(22px);
}

.smart-cut-inline {
  padding-left: 42px;
  margin-top: -18px;
}

.smart-pip-strip {
  grid-template-columns: 96px 96px 1fr;
  gap: 16px;
  padding-left: 42px;
  margin-top: -14px;
}

.smart-pip-add,
.smart-pip-thumb {
  width: 96px;
  height: 136px;
  border-radius: 10px;
}

.smart-music-row {
  grid-template-columns: 34px minmax(0, 1fr) 22px minmax(82px, 0.48fr) 74px;
  padding-left: 42px;
  margin-top: -14px;
}

.smart-play-dot,
.smart-music-row select,
.smart-music-row b {
  height: 34px;
  border-radius: 10px;
}

.smart-subtitle-workbench {
  min-height: 0;
  height: 100%;
  border-color: #eef1f6;
  border-radius: 20px 20px 0 0;
  box-shadow: none;
}

.smart-subtitle-head {
  min-height: 64px;
  padding: 18px 20px 12px;
}

.smart-subtitle-actions {
  gap: 7px;
}

.smart-subtitle-actions button {
  height: 28px;
  padding: 0 10px;
  font-size: 12px;
}

.smart-line-editor {
  padding: 0 20px 14px;
}

.smart-line-row {
  grid-template-columns: 42px minmax(0, 1fr) 0;
  gap: 12px;
  min-height: 48px;
}

.smart-line-row textarea {
  min-height: 28px;
  font-size: 16px;
  line-height: 1.35;
}

.smart-line-row button {
  width: 0;
  padding: 0;
  opacity: 0;
  pointer-events: none;
}

.smart-line-row:hover button {
  width: 48px;
  padding: 0 8px;
  opacity: 1;
  pointer-events: auto;
}

.smart-main-render {
  width: calc(100% - 40px);
  min-height: 52px;
  margin: 0 20px 0;
  border-radius: 14px 14px 0 0;
  font-size: 17px;
}

.smart-result-panel {
  grid-template-rows: 46px minmax(0, 1fr) 44px;
  min-width: 0;
  height: 100%;
  padding: 30px 28px 28px;
  border-left: 1px solid #eef1f6;
  background: #ffffff;
}

.smart-result-head {
  min-height: 0;
  margin-bottom: 0;
}

.smart-result-actions {
  gap: 8px;
}

.smart-result-actions button,
.smart-result-actions a {
  height: 34px;
  min-width: auto;
  padding: 0 12px;
  border-radius: 8px;
  font-size: 12px;
}

.smart-phone-result {
  align-items: start;
  padding-top: 22px;
}

.smart-phone-result video,
.smart-phone-placeholder {
  width: min(100%, 374px);
  max-height: calc(100dvh - 80px - 92px - 116px);
  border-radius: 28px;
  box-shadow: 0 24px 54px rgba(15, 23, 42, 0.14);
}

.smart-phone-copy {
  inset: 84px 22px 30px;
}

.smart-phone-copy strong {
  font-size: clamp(30px, 2vw, 38px);
}

.smart-phone-copy b {
  font-size: clamp(26px, 1.7vw, 34px);
}

.smart-phone-copy span {
  font-size: 17px;
}

.smart-result-status {
  min-height: 0;
  margin-top: 0;
}

.create-footer {
  right: 0;
  bottom: 0;
  left: var(--shell-sidebar-width, 282px);
  height: 92px;
  padding: 0 34px;
  border: 0;
  border-top: 1px solid #e8ebf2;
  border-radius: 0;
  background: rgba(255, 255, 255, 0.96);
  box-shadow: none;
}

.footer-progress {
  width: 310px;
}

.next-btn {
  min-width: 172px;
  min-height: 56px;
  border-radius: 16px;
}

@media (max-width: 1540px) {
  .smart-clip-layout {
    padding: 26px 0 0 24px;
  }

  .smart-editor-shell {
    grid-template-columns: minmax(0, 1fr) 390px;
  }

  .smart-editor-main {
    grid-template-columns: minmax(0, 0.92fr) minmax(0, 1fr);
    column-gap: 24px;
    padding: 34px 24px 0 30px;
  }

  .smart-style-card {
    grid-template-columns: 96px minmax(0, 1fr);
  }

  .smart-template-change {
    grid-column: 2;
    width: fit-content;
  }
}

@media (max-width: 1280px) {
  .smart-clip-layout {
    height: auto;
    min-height: calc(100dvh - 80px - 92px);
    overflow: visible;
  }

  .smart-editor-shell {
    grid-template-columns: 1fr;
    height: auto;
  }

  .smart-editor-main {
    grid-template-columns: 1fr;
  }

  .smart-result-panel {
    border-top: 1px solid #eef1f6;
    border-left: 0;
  }
}

/* 第三步左侧模块：按对标图重新收敛比例，只修左侧视觉结构。 */
.smart-editor-main {
  grid-template-columns: minmax(660px, 0.52fr) minmax(0, 1fr);
  grid-template-rows: 54px minmax(0, 1fr);
  column-gap: 34px;
  row-gap: 26px;
  padding-top: 20px;
  padding-left: 12px;
}

.smart-editor-head {
  align-items: center;
}

.smart-editor-head h1 {
  font-size: 40px;
  font-weight: 1000;
  line-height: 1;
  letter-spacing: -0.05em;
}

.smart-editor-left {
  gap: 32px;
  overflow: visible;
}

.smart-left-section-title {
  gap: 12px;
  min-height: 40px;
}

.smart-left-icon {
  width: 40px;
  height: 40px;
  border-radius: 9px;
  background: linear-gradient(135deg, #7c3aed, #8b5cf6);
  box-shadow: none;
  font-size: 22px;
  line-height: 1;
}

.smart-left-section-title strong {
  color: #111827;
  font-size: 18px;
  font-weight: 1000;
  line-height: 1.08;
}

.smart-left-section-title p {
  margin-top: 4px;
  color: #98a2b3;
  font-size: 12px;
  font-weight: 700;
  line-height: 1.15;
}

.smart-style-card {
  grid-template-columns: 112px minmax(0, 1fr) 126px;
  gap: 24px;
  align-items: center;
  min-height: 246px;
  padding: 24px 24px 24px 26px;
  border: 1px solid #eef1f6;
  border-radius: 18px;
  background: #ffffff;
  box-shadow: 0 10px 24px rgba(15, 23, 42, 0.025);
}

.smart-style-cover {
  width: 110px;
  height: 196px;
  justify-self: start;
  border: 1px solid #111827;
  border-radius: 9px;
  background: #eef6ff;
  box-shadow: none;
}

.smart-style-info {
  gap: 10px;
  align-self: center;
}

.smart-style-info > span,
.smart-style-info label {
  color: #a2aabb;
  font-size: 12px;
  font-weight: 900;
  line-height: 1;
}

.smart-style-name {
  max-width: 360px;
  color: #111827;
  font-size: 19px;
  font-weight: 1000;
  line-height: 1.2;
}

.smart-style-name i {
  color: #c3cad5;
  font-size: 14px;
}

.smart-template-change {
  justify-self: end;
  align-self: start;
  min-width: 122px;
  height: 40px;
  margin-top: 8px;
  border: 0;
  border-radius: 999px;
  background: #f3edff;
  box-shadow: none;
  color: #7c3aed;
  font-size: 14px;
  font-weight: 900;
}

.smart-title-row {
  grid-template-columns: minmax(0, 1fr) 84px;
  gap: 10px;
  margin-top: 4px;
}

.smart-title-row input,
.smart-title-input {
  height: 40px;
  padding: 0 16px;
  border-radius: 12px;
  background: #f7f8fa;
  color: #111827;
  font-size: 14px;
  font-weight: 900;
}

.smart-title-row button {
  height: 36px;
  align-self: center;
  border: 1px solid rgba(124, 58, 237, 0.24);
  border-radius: 10px;
  background: #ffffff;
  box-shadow: 0 4px 12px rgba(124, 58, 237, 0.12);
  color: #7c3aed;
  font-size: 12px;
  font-weight: 900;
}

.smart-option-list {
  gap: 34px;
  padding-top: 4px;
}

.smart-option-row {
  min-height: 56px;
}

.smart-option-row > div {
  gap: 16px;
  color: #111827;
  font-size: 18px;
  font-weight: 1000;
}

.smart-option-icon {
  width: 28px;
  color: #9aa4b5;
  font-size: 24px;
}

.smart-switch {
  width: 56px;
  height: 30px;
  background: #c7c7cc;
}

.smart-switch::after {
  top: 3px;
  left: 3px;
  width: 24px;
  height: 24px;
}

.smart-switch--on::after {
  transform: translateX(26px);
}

.smart-cut-inline {
  padding-left: 44px;
  margin-top: -24px;
}

@media (max-width: 1540px) {
  .smart-editor-main {
    grid-template-columns: minmax(500px, 0.45fr) minmax(640px, 0.55fr);
  }

  .smart-style-card {
    grid-template-columns: 104px minmax(0, 1fr) 118px;
  }

  .smart-style-cover {
    width: 100px;
    height: 178px;
  }
}

/* 第三步中间字幕编辑：还原对标平台的横向编辑区，避免被挤成竖排。 */
.smart-editor-main {
  grid-template-columns: minmax(520px, 0.46fr) minmax(680px, 0.54fr);
}

.smart-subtitle-workbench {
  min-width: 680px;
  height: 100%;
  border: 1px solid #eef1f6;
  border-radius: 20px 20px 0 0;
  box-shadow: none;
}

.smart-subtitle-head {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  justify-content: space-between;
  min-height: 72px;
  padding: 18px 24px 14px;
  border-bottom: 1px solid #f2f4f7;
}

.smart-subtitle-head > div:first-child {
  grid-template-columns: 6px minmax(110px, auto);
  min-width: 142px;
  column-gap: 12px;
}

.smart-subtitle-head i {
  width: 6px;
  height: 28px;
}

.smart-subtitle-head strong {
  white-space: nowrap;
  font-size: 18px;
  line-height: 1.1;
}

.smart-subtitle-head span {
  white-space: nowrap;
  font-size: 12px;
  line-height: 1.2;
}

.smart-subtitle-actions {
  flex: 0 0 auto;
  flex-wrap: nowrap;
  gap: 8px;
}

.smart-subtitle-actions label {
  flex: 0 0 auto;
  white-space: nowrap;
}

.smart-subtitle-actions button {
  flex: 0 0 auto;
  height: 30px;
  padding: 0 12px;
  white-space: nowrap;
}

.smart-line-editor {
  padding: 0 24px 12px;
}

.smart-line-row {
  grid-template-columns: 42px minmax(0, 1fr);
  min-height: 52px;
  border-bottom: 1px solid #f5f6f8;
}

.smart-line-row textarea {
  min-height: 30px;
  font-size: 17px;
  font-weight: 1000;
  line-height: 1.3;
}

.smart-line-row button {
  display: none;
}

.smart-line-empty {
  min-height: 360px;
  padding: 0 28px;
  justify-items: start;
  text-align: left;
}

.smart-main-render {
  width: calc(100% - 40px);
  min-height: 54px;
  margin: 0 20px 0;
  border-radius: 16px 16px 0 0;
}

@media (max-width: 1540px) {
  .smart-editor-main {
    grid-template-columns: minmax(460px, 0.43fr) minmax(600px, 0.57fr);
  }

  .smart-subtitle-workbench {
    min-width: 600px;
  }
}

/* 第三步响应式兜底：模块只能压缩或换行，不能互相覆盖。 */
.smart-editor-shell,
.smart-editor-main,
.smart-editor-left,
.smart-subtitle-workbench,
.smart-result-panel {
  min-width: 0;
}

@media (max-width: 1880px) {
  .smart-editor-shell {
    grid-template-columns: minmax(0, 1fr) minmax(360px, 400px);
  }

  .smart-editor-main {
    grid-template-columns: minmax(440px, 0.44fr) minmax(0, 0.56fr);
    column-gap: 24px;
    padding-right: 24px;
  }

  .smart-subtitle-workbench {
    min-width: 0;
  }

  .smart-subtitle-actions {
    gap: 6px;
  }

  .smart-subtitle-actions button {
    padding: 0 10px;
  }
}

@media (max-width: 1680px) {
  .smart-editor-shell {
    grid-template-columns: minmax(0, 1fr) minmax(320px, 350px);
  }

  .smart-editor-main {
    grid-template-columns: minmax(390px, 0.42fr) minmax(0, 0.58fr);
    column-gap: 18px;
    padding-left: 22px;
    padding-right: 18px;
  }

  .smart-style-card {
    grid-template-columns: 96px minmax(0, 1fr);
    gap: 18px;
  }

  .smart-template-change {
    grid-column: 2;
    justify-self: start;
    margin-top: 0;
  }

  .smart-subtitle-head {
    padding-left: 18px;
    padding-right: 18px;
  }
}

@media (max-width: 1500px) {
  .smart-clip-layout {
    height: auto;
    min-height: calc(100dvh - 80px - 92px);
    overflow-y: auto;
    padding-right: 20px;
  }

  .smart-editor-shell {
    grid-template-columns: 1fr;
    height: auto;
    min-height: calc(100dvh - 80px - 92px - 34px);
    border-right: 1px solid #eef1f6;
    border-radius: 28px;
  }

  .smart-editor-main {
    grid-template-columns: minmax(400px, 0.42fr) minmax(0, 0.58fr);
    min-height: 760px;
    padding: 28px 24px 0;
  }

  .smart-result-panel {
    grid-template-rows: auto auto auto;
    border-top: 1px solid #eef1f6;
    border-left: 0;
  }

  .smart-phone-result {
    padding-top: 18px;
  }

  .smart-phone-result video,
  .smart-phone-placeholder {
    width: min(320px, 100%);
    max-height: 520px;
  }
}

@media (max-width: 1320px) {
  .smart-editor-main {
    grid-template-columns: 1fr;
    grid-template-rows: auto auto auto;
    row-gap: 24px;
    min-height: 0;
  }

  .smart-editor-head {
    grid-column: 1;
  }

  .smart-editor-left {
    overflow: visible;
  }

  .smart-style-card {
    grid-template-columns: 112px minmax(0, 1fr) 126px;
  }

  .smart-template-change {
    grid-column: auto;
    justify-self: end;
  }

  .smart-subtitle-workbench {
    min-height: 620px;
  }
}

@media (max-width: 860px) {
  .smart-clip-layout {
    padding: 18px 14px 0;
  }

  .smart-editor-main {
    padding: 20px 14px 0;
  }

  .smart-style-card {
    grid-template-columns: 92px minmax(0, 1fr);
    padding: 18px;
  }

  .smart-style-cover {
    width: 88px;
    height: 156px;
  }

  .smart-template-change {
    grid-column: 2;
    justify-self: start;
  }

  .smart-subtitle-head {
    align-items: flex-start;
    flex-direction: column;
  }

  .smart-subtitle-actions {
    flex-wrap: wrap;
    justify-content: flex-start;
  }
}

/* 第三步整体微缩：降低字体和按钮体量，并拉开生成结果与左侧工作区距离。 */
.smart-clip-layout {
  font-size: 13px;
}

.smart-editor-head h1 {
  font-size: 36px;
}

.smart-left-section-title strong,
.smart-subtitle-head strong,
.smart-result-head strong {
  font-size: 16px;
}

.smart-left-section-title p,
.smart-subtitle-head span,
.smart-style-info > span,
.smart-style-info label,
.smart-result-status span {
  font-size: 11px;
}

.smart-style-name {
  font-size: 17px;
}

.smart-option-row > div {
  font-size: 16px;
}

.smart-option-icon {
  font-size: 21px;
}

.smart-title-row input,
.smart-title-input {
  height: 36px;
  font-size: 13px;
}

.smart-template-change,
.smart-title-row button,
.smart-cut-inline button,
.smart-subtitle-actions button,
.smart-result-actions button,
.smart-result-actions a {
  height: 32px;
  padding: 0 11px;
  font-size: 11px;
}

.smart-subtitle-actions label {
  font-size: 12px;
}

.smart-switch {
  width: 50px;
  height: 27px;
}

.smart-switch::after {
  width: 21px;
  height: 21px;
}

.smart-switch--on::after {
  transform: translateX(23px);
}

.smart-mini-switch {
  width: 31px;
  height: 18px;
}

.smart-mini-switch::after {
  width: 14px;
  height: 14px;
}

.smart-mini-switch--on::after {
  transform: translateX(13px);
}

.smart-line-row textarea {
  font-size: 15px;
}

.smart-main-render {
  min-height: 50px;
  font-size: 15px;
}

.smart-phone-copy strong {
  font-size: clamp(26px, 1.8vw, 34px);
}

.smart-phone-copy b {
  font-size: clamp(22px, 1.5vw, 30px);
}

.smart-phone-copy span {
  font-size: 15px;
}

.smart-result-panel {
  margin-left: 40px;
}

@media (max-width: 1500px) {
  .smart-result-panel {
    margin-left: 0;
  }
}

/* 生成结果固定为第三步右侧独立模块。 */
.smart-editor-shell {
  grid-template-columns: minmax(0, 1fr) 520px;
  column-gap: 0;
  background: #ffffff;
}

.smart-editor-main {
  min-width: 0;
}

.smart-result-panel {
  align-self: stretch;
  box-sizing: border-box;
  width: 520px;
  margin-left: 40px;
  padding: 44px 42px 34px;
  border-left: 1px solid #eef1f6;
  background: #ffffff;
}

.smart-result-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 40px;
  margin: 0 0 34px;
}

.smart-result-head > div:first-child {
  gap: 12px;
  color: #8b5cf6;
}

.smart-result-head strong {
  color: #111827;
  font-size: 20px;
  font-weight: 1000;
}

.smart-result-actions {
  display: flex;
  flex: 0 0 auto;
  gap: 10px;
}

.smart-result-actions button,
.smart-result-actions a {
  height: 38px;
  padding: 0 16px;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 900;
}

.smart-result-actions a {
  min-width: 64px;
  background: linear-gradient(135deg, #b794f6, #8b5cf6);
}

.smart-phone-result {
  justify-items: start;
  align-items: start;
  padding-top: 0;
}

.smart-phone-result video,
.smart-phone-placeholder {
  width: 432px;
  max-width: 100%;
  max-height: none;
  border-radius: 30px;
  box-shadow: 0 30px 70px rgba(15, 23, 42, 0.14);
}

.smart-phone-copy {
  inset: 96px 28px 34px;
}

.smart-phone-copy strong {
  font-size: clamp(30px, 2.05vw, 40px);
}

.smart-phone-copy b {
  font-size: clamp(25px, 1.72vw, 34px);
}

.smart-phone-copy span {
  font-size: 16px;
}

.smart-result-status {
  margin-top: 14px;
}

@media (max-width: 1880px) {
  .smart-editor-shell {
    grid-template-columns: minmax(0, 1fr) 470px;
  }

  .smart-result-panel {
    width: 470px;
    margin-left: 32px;
    padding-left: 34px;
    padding-right: 34px;
  }

  .smart-phone-result video,
  .smart-phone-placeholder {
    width: 400px;
  }
}

@media (max-width: 1680px) {
  .smart-editor-shell {
    grid-template-columns: minmax(0, 1fr) 420px;
  }

  .smart-result-panel {
    width: 420px;
    margin-left: 24px;
    padding-left: 28px;
    padding-right: 28px;
  }

  .smart-result-actions button,
  .smart-result-actions a {
    padding: 0 12px;
    font-size: 12px;
  }

  .smart-phone-result video,
  .smart-phone-placeholder {
    width: 360px;
  }
}

@media (max-width: 1500px) {
  .smart-editor-shell {
    grid-template-columns: 1fr;
  }

  .smart-result-panel {
    width: 100%;
    margin-left: 0;
    border-top: 1px solid #eef1f6;
    border-left: 0;
  }

  .smart-phone-result {
    justify-items: center;
  }
}

/* 第三步基础高度下调，避免大模块撑得过满。 */
.smart-clip-layout {
  height: calc(100dvh - 80px - 132px);
  padding-top: 24px;
}

.smart-editor-shell {
  min-height: 0;
}

.smart-editor-main {
  grid-template-rows: 48px minmax(0, 1fr);
  padding-top: 18px;
}

.smart-subtitle-workbench {
  min-height: 560px;
}

.smart-phone-result video,
.smart-phone-placeholder {
  max-height: calc(100dvh - 80px - 132px - 112px);
}

@media (max-width: 1500px) {
  .smart-clip-layout {
    min-height: calc(100dvh - 80px - 132px);
  }

  .smart-editor-shell {
    min-height: calc(100dvh - 80px - 132px - 24px);
  }

  .smart-editor-main {
    min-height: 680px;
  }
}

@media (max-width: 1320px) {
  .smart-subtitle-workbench {
    min-height: 540px;
  }
}
</style>
