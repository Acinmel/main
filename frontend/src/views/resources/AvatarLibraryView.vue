<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { NAlert, NButton, NEmpty, NModal, NSpin, useMessage } from "naive-ui";
import {
  avatarVideoStreamUrl,
  createAvatarResource,
  listAvatarResources,
  uploadAvatarResource,
} from "@/api/resources";
import AvatarResourceCard from "@/components/resources/AvatarResourceCard.vue";
import DeleteConfirmModal from "@/components/resources/DeleteConfirmModal.vue";
import HeaderFilter from "@/components/resources/HeaderFilter.vue";
import NewAvatarModal from "@/components/resources/NewAvatarModal.vue";
import { useCursorList } from "@/composables/useCursorList";
import { useDebouncedInfiniteScroll } from "@/composables/useDebouncedInfiniteScroll";
import { useResourceActions } from "@/composables/useResourceActions";
import type {
  AvatarResource,
  CreateAvatarResourceDraft,
  ResourceScope,
} from "@/types/resources";

const avatarCardPreviewCache = new Map<string, string>();

const props = withDefaults(
  defineProps<{
    title?: string;
    subtitle?: string;
    actionText?: string;
    showSearch?: boolean;
  }>(),
  {
    title: "数字人库",
    subtitle: "海量高清数字人，满足多种应用场景",
    actionText: "定制数字人",
    showSearch: true,
  },
);

const message = useMessage();
const router = useRouter();
const scope = ref<ResourceScope>("all");
const scrollRef = ref<HTMLElement | null>(null);
const selectedIds = ref<string[]>([]);
const keyword = ref("");
const createOpen = ref(false);
const creating = ref(false);
const deleteOpen = ref(false);
const deleting = ref(false);
const pendingDeleteIds = ref<string[]>([]);
const previewUrl = ref<string | null>(null);
const cardVideoUrls = ref<Record<string, string>>({});
const cardVideoLoading = ref<Record<string, boolean>>({});
const pendingCardVideoIds = new Set<string>();
let previewObjectUrl: string | null = null;

const list = useCursorList<AvatarResource>((cursor) =>
  listAvatarResources({ scope: scope.value, cursor, limit: 18 }),
);
const actions = useResourceActions("avatars");
const batchDeleteDisabled = computed(() => selectedIds.value.length === 0);
const visibleItems = computed(() => {
  const q = keyword.value.trim().toLowerCase();
  if (!q) return list.items.value;
  return list.items.value.filter((item) => item.name.toLowerCase().includes(q));
});

useDebouncedInfiniteScroll(
  () => scrollRef.value,
  () => void list.loadMore(),
);

watch(scope, () => {
  selectedIds.value = [];
  void list.refresh();
});

onMounted(() => {
  void list.refresh();
});

onBeforeUnmount(() => {
  revokePreviewObjectUrl();
  clearCardVideoState();
});

watch(
  () => list.items.value,
  (items) => {
    const visibleIds = new Set(items.map((item) => item.id));
    const nextUrls: Record<string, string> = {};
    for (const [id, url] of Object.entries(cardVideoUrls.value)) {
      if (visibleIds.has(id)) nextUrls[id] = url;
    }
    cardVideoUrls.value = nextUrls;

    const nextLoading: Record<string, boolean> = {};
    for (const [id, loading] of Object.entries(cardVideoLoading.value)) {
      if (visibleIds.has(id)) nextLoading[id] = loading;
    }
    cardVideoLoading.value = nextLoading;

    for (const id of Array.from(pendingCardVideoIds)) {
      if (!visibleIds.has(id)) pendingCardVideoIds.delete(id);
    }
  },
);

function toggleSelected(id: string, checked: boolean) {
  selectedIds.value = checked
    ? [...selectedIds.value, id]
    : selectedIds.value.filter((x) => x !== id);
}

function revokePreviewObjectUrl() {
  if (previewObjectUrl?.startsWith("blob:")) {
    URL.revokeObjectURL(previewObjectUrl);
  }
  previewObjectUrl = null;
}

function clearCardVideoState() {
  cardVideoUrls.value = {};
  cardVideoLoading.value = {};
  pendingCardVideoIds.clear();
}

function resolveAvatarPreviewUrl(source: string) {
  return /^(https?:|data:|blob:)/i.test(source)
    ? source
    : avatarVideoStreamUrl(source);
}

function getCardPreviewCacheKey(item: AvatarResource) {
  return `${item.id}::${item.originalVideoUrl ?? ""}`;
}

function dropStaleCardPreviewCache(item: AvatarResource, keepKey: string) {
  const cachePrefix = `${item.id}::`;
  for (const [cacheKey, cacheUrl] of avatarCardPreviewCache.entries()) {
    if (!cacheKey.startsWith(cachePrefix) || cacheKey === keepKey) continue;
    if (cacheUrl.startsWith("blob:")) URL.revokeObjectURL(cacheUrl);
    avatarCardPreviewCache.delete(cacheKey);
  }
}

async function ensureCardVideoPreview(item: AvatarResource) {
  const source = item.originalVideoUrl?.trim();
  if (
    !source ||
    cardVideoUrls.value[item.id] ||
    pendingCardVideoIds.has(item.id)
  )
    return;
  const cacheKey = getCardPreviewCacheKey(item);
  const cachedUrl = avatarCardPreviewCache.get(cacheKey);
  if (cachedUrl) {
    cardVideoUrls.value = {
      ...cardVideoUrls.value,
      [item.id]: cachedUrl,
    };
    return;
  }

  pendingCardVideoIds.add(item.id);
  cardVideoLoading.value = { ...cardVideoLoading.value, [item.id]: true };
  try {
    const nextUrl = resolveAvatarPreviewUrl(source);

    if (!list.items.value.some((current) => current.id === item.id)) {
      return;
    }

    dropStaleCardPreviewCache(item, cacheKey);
    avatarCardPreviewCache.set(cacheKey, nextUrl);
    cardVideoUrls.value = {
      ...cardVideoUrls.value,
      [item.id]: nextUrl,
    };
  } catch {
    // 单张卡片预览失败不阻塞资源库使用，仍保留封面和“原始视频”弹窗按钮兜底。
  } finally {
    pendingCardVideoIds.delete(item.id);
    const nextLoading = { ...cardVideoLoading.value };
    delete nextLoading[item.id];
    cardVideoLoading.value = nextLoading;
  }
}

async function rename(item: AvatarResource, name: string) {
  try {
    const patch = await actions.rename(item.id, name);
    list.updateItem(item.id, patch);
    message.success("名称已更新");
  } catch {
    message.error("名称更新失败");
  }
}

function requestDelete(ids: string[]) {
  pendingDeleteIds.value = ids;
  deleteOpen.value = true;
}

async function confirmDelete() {
  deleting.value = true;
  try {
    const ids =
      pendingDeleteIds.value.length === 1
        ? await actions.remove(pendingDeleteIds.value[0])
        : await actions.removeMany(pendingDeleteIds.value);
    list.removeItems(ids);
    selectedIds.value = selectedIds.value.filter((id) => !ids.includes(id));
    deleteOpen.value = false;
    message.success("已删除资源");
  } catch {
    message.error("删除失败");
  } finally {
    deleting.value = false;
  }
}

async function createAvatar(body: CreateAvatarResourceDraft) {
  creating.value = true;
  try {
    const item = body.uploadFile
      ? await uploadAvatarResource(body)
      : await createAvatarResource(body);
    list.prepend(item);
    createOpen.value = false;
    message.success("视频素材已添加");
  } catch {
    message.error("创建失败");
  } finally {
    creating.value = false;
  }
}

function goCreate(item: AvatarResource) {
  if (!item.originalVideoUrl) {
    message.warning("这个数字人还没有绑定原始视频，请先补充视频素材。");
    return;
  }
  void router.push({ name: "studio", query: { avatarId: item.id } });
}

async function preview(item: AvatarResource) {
  const source = item.originalVideoUrl?.trim();
  if (!source) return;
  revokePreviewObjectUrl();
  const nextUrl = resolveAvatarPreviewUrl(source);
  previewObjectUrl = nextUrl;
  previewUrl.value = nextUrl;
}
</script>

<template>
  <main ref="scrollRef" class="resource-page">
    <HeaderFilter
      v-model="scope"
      v-model:search-value="keyword"
      :title="props.title"
      :subtitle="props.subtitle"
      :action-text="props.actionText"
      :batch-delete-disabled="batchDeleteDisabled"
      :show-search="props.showSearch"
      search-placeholder="搜索..."
      @action="createOpen = true"
      @batch-delete="requestDelete(selectedIds)"
    />

    <n-alert v-if="list.error.value" type="error" class="resource-state">
      {{ list.error.value }}
      <n-button text type="primary" @click="list.refresh">重试</n-button>
    </n-alert>

    <n-spin :show="list.loading.value">
      <n-empty
        v-if="list.empty.value"
        description="暂无数字人视频素材"
        class="resource-state"
      />
      <n-empty
        v-else-if="visibleItems.length === 0"
        description="没有匹配的数字人"
        class="resource-state"
      />
      <div v-else class="resource-grid resource-grid--avatar">
        <AvatarResourceCard
          v-for="item in visibleItems"
          :key="item.id"
          :item="item"
          :selected="selectedIds.includes(item.id)"
          :preview-video-url="cardVideoUrls[item.id]"
          :preview-loading="Boolean(cardVideoLoading[item.id])"
          @update:selected="toggleSelected(item.id, $event)"
          @rename="rename(item, $event)"
          @delete="requestDelete([item.id])"
          @preview="preview(item)"
          @request-preview="ensureCardVideoPreview(item)"
          @create="goCreate(item)"
        />
      </div>
      <div v-if="list.loadingMore.value" class="resource-loading">
        继续加载中...
      </div>
      <div
        v-else-if="!list.hasMore.value && list.items.value.length"
        class="resource-loading"
      >
        已加载全部
      </div>
    </n-spin>

    <NewAvatarModal
      v-model:show="createOpen"
      :loading="creating"
      @submit="createAvatar"
    />
    <DeleteConfirmModal
      v-model:show="deleteOpen"
      title="删除数字人"
      :count="pendingDeleteIds.length"
      :loading="deleting"
      @confirm="confirmDelete"
    />
    <n-modal
      :show="Boolean(previewUrl)"
      preset="card"
      class="video-modal"
      title="原始视频预览"
      @update:show="
        (show) => {
          if (!show) {
            previewUrl = null;
            revokePreviewObjectUrl();
          }
        }
      "
    >
      <video v-if="previewUrl" controls :src="previewUrl" preload="metadata" />
    </n-modal>
  </main>
</template>

<style scoped>
.resource-page {
  height: calc(100vh - 88px);
  overflow: auto;
  padding: 36px 44px 56px;
  color: var(--text-main);
  background:
    radial-gradient(circle at 82% 8%, rgba(73, 107, 255, 0.1), transparent 26%),
    radial-gradient(
      circle at 18% 0%,
      rgba(67, 207, 191, 0.08),
      transparent 24%
    ),
    linear-gradient(
      180deg,
      rgba(255, 255, 255, 0.22),
      rgba(246, 249, 255, 0.04)
    );
}

.resource-grid {
  display: grid;
  gap: 34px 32px;
}

.resource-grid--avatar {
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  align-items: start;
}

.resource-state {
  margin: 34px auto;
}

.resource-loading {
  padding: 18px;
  color: var(--text-sub);
  text-align: center;
}

.video-modal video {
  width: 100%;
  max-height: 70vh;
  border-radius: 14px;
  background: #0f172a;
}

@media (max-width: 760px) {
  .resource-page {
    padding: 22px 16px 40px;
  }

  .resource-grid {
    gap: 18px;
  }

  .resource-grid--avatar {
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  }
}
</style>
