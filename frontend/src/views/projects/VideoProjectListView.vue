<script setup lang="ts">
import axios from "axios";
import {
  NAlert,
  NButton,
  NEmpty,
  NPagination,
  NSelect,
  NSpace,
  NTag,
  NText,
  useMessage,
} from "naive-ui";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import {
  archiveVideoProject,
  getVideoProject,
  listVideoProjects,
  renameVideoProject,
} from "@/api/videoProjects";
import type {
  VideoProjectRecord,
  VideoProjectScope,
} from "@/api/videoProjects";
import { describeHttpOrNetworkError } from "@/utils/httpErrorMessage";

const router = useRouter();
const message = useMessage();

const pageSize = 20;
const scope = ref<VideoProjectScope>("active");
const page = ref(1);
const projects = ref<VideoProjectRecord[]>([]);
const total = ref(0);
const hasMore = ref(false);
const listLoading = ref(false);
const listError = ref("");
const openingProjectId = ref("");
const mutatingProjectIds = ref<Record<string, boolean>>({});

let listAbortController: AbortController | null = null;
let detailAbortController: AbortController | null = null;
let listRequestSeq = 0;

const scopeOptions = [
  { label: "进行中", value: "active" },
  { label: "已归档", value: "archived" },
  { label: "全部", value: "all" },
];

const pageCount = computed(() => Math.max(1, Math.ceil(total.value / pageSize)));

function isAbortError(error: unknown) {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    axios.isCancel(error) ||
    (axios.isAxiosError(error) && error.code === "ERR_CANCELED")
  );
}

function formatDate(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function setMutating(projectId: string, busy: boolean) {
  mutatingProjectIds.value = {
    ...mutatingProjectIds.value,
    [projectId]: busy,
  };
}

function isProjectBusy(projectId: string) {
  return Boolean(mutatingProjectIds.value[projectId]) || openingProjectId.value === projectId;
}

function applyProjectPatch(project: VideoProjectRecord) {
  projects.value = projects.value.map((item) =>
    item.projectId === project.projectId ? project : item,
  );
}

async function loadProjects() {
  listAbortController?.abort();
  const controller = new AbortController();
  listAbortController = controller;
  const seq = ++listRequestSeq;
  listLoading.value = true;
  listError.value = "";

  try {
    const response = await listVideoProjects(
      {
        scope: scope.value,
        limit: pageSize,
        offset: (page.value - 1) * pageSize,
      },
      { signal: controller.signal },
    );
    if (seq !== listRequestSeq || controller.signal.aborted) return;
    projects.value = response.items;
    total.value = response.total;
    hasMore.value = response.hasMore;
  } catch (error: unknown) {
    if (isAbortError(error)) return;
    if (seq !== listRequestSeq) return;
    listError.value = describeHttpOrNetworkError(error);
  } finally {
    if (seq === listRequestSeq) {
      listLoading.value = false;
      if (listAbortController === controller) {
        listAbortController = null;
      }
    }
  }
}

async function openProject(project: VideoProjectRecord) {
  if (isProjectBusy(project.projectId)) return;
  detailAbortController?.abort();
  const controller = new AbortController();
  detailAbortController = controller;
  openingProjectId.value = project.projectId;
  try {
    await getVideoProject(project.projectId, { signal: controller.signal });
    if (controller.signal.aborted) return;
    await router.push({
      name: "studio",
      query: { projectId: project.projectId },
    });
  } catch (error: unknown) {
    if (!isAbortError(error)) {
      message.error(describeHttpOrNetworkError(error));
    }
  } finally {
    if (detailAbortController === controller) {
      detailAbortController = null;
    }
    if (openingProjectId.value === project.projectId) {
      openingProjectId.value = "";
    }
  }
}

async function renameProject(project: VideoProjectRecord) {
  if (isProjectBusy(project.projectId)) return;
  const nextName = window.prompt("任务名称", project.name)?.trim();
  if (!nextName || nextName === project.name) return;
  setMutating(project.projectId, true);
  try {
    const updated = await renameVideoProject(project.projectId, { name: nextName });
    applyProjectPatch(updated);
    message.success("任务名称已更新");
  } catch (error: unknown) {
    message.error(describeHttpOrNetworkError(error));
  } finally {
    setMutating(project.projectId, false);
  }
}

async function setProjectArchived(project: VideoProjectRecord, archived: boolean) {
  if (isProjectBusy(project.projectId)) return;
  setMutating(project.projectId, true);
  try {
    const updated = await archiveVideoProject(project.projectId, { archived });
    if (scope.value === "all") {
      applyProjectPatch(updated);
    } else {
      projects.value = projects.value.filter((item) => item.projectId !== project.projectId);
      total.value = Math.max(0, total.value - 1);
    }
    message.success(archived ? "任务已归档" : "任务已恢复");
  } catch (error: unknown) {
    message.error(describeHttpOrNetworkError(error));
  } finally {
    setMutating(project.projectId, false);
  }
}

watch(scope, () => {
  page.value = 1;
  void loadProjects();
});

watch(page, () => {
  void loadProjects();
});

onMounted(() => {
  void loadProjects();
});

onUnmounted(() => {
  listAbortController?.abort();
  detailAbortController?.abort();
});
</script>

<template>
  <main class="project-list-page">
    <section class="project-list-header">
      <div>
        <n-text depth="3">创作任务</n-text>
        <h1>任务列表</h1>
      </div>
      <n-space align="center" :size="12">
        <n-select
          v-model:value="scope"
          class="scope-select"
          :options="scopeOptions"
          size="medium"
        />
        <n-button type="primary" @click="router.push({ name: 'studio' })">
          新建任务
        </n-button>
      </n-space>
    </section>

    <n-alert v-if="listError" type="error" :show-icon="false" class="project-list-alert">
      <div class="project-list-error">
        <span>{{ listError }}</span>
        <n-button tertiary size="small" type="primary" @click="loadProjects">
          重试
        </n-button>
      </div>
    </n-alert>

    <section class="project-list-card">
      <div class="project-list-card__head">
        <span>共 {{ total }} 个任务</span>
        <n-button
          tertiary
          size="small"
          :loading="listLoading"
          @click="loadProjects"
        >
          刷新
        </n-button>
      </div>

      <div v-if="listLoading && !projects.length" class="project-list-loading">
        正在加载任务...
      </div>

      <n-empty
        v-else-if="!projects.length"
        description="暂无任务"
        class="project-list-empty"
      />

      <div v-else class="project-list-table" :class="{ 'is-refreshing': listLoading }">
        <article
          v-for="project in projects"
          :key="project.projectId"
          class="project-row"
        >
          <button
            type="button"
            class="project-row__main"
            :disabled="isProjectBusy(project.projectId)"
            @click="openProject(project)"
          >
            <strong>{{ project.name }}</strong>
            <span>{{ project.projectId }}</span>
          </button>
          <div class="project-row__meta">
            <n-tag size="small" :type="project.archived ? 'default' : 'success'">
              {{ project.archived ? "已归档" : "进行中" }}
            </n-tag>
            <span>更新 {{ formatDate(project.updatedAt) }}</span>
          </div>
          <n-space class="project-row__actions" :size="8">
            <n-button
              size="small"
              secondary
              :loading="openingProjectId === project.projectId"
              :disabled="Boolean(mutatingProjectIds[project.projectId])"
              @click="openProject(project)"
            >
              打开
            </n-button>
            <n-button
              size="small"
              tertiary
              :disabled="isProjectBusy(project.projectId)"
              @click="renameProject(project)"
            >
              改名
            </n-button>
            <n-button
              size="small"
              tertiary
              :loading="Boolean(mutatingProjectIds[project.projectId])"
              :disabled="openingProjectId === project.projectId"
              @click="setProjectArchived(project, !project.archived)"
            >
              {{ project.archived ? "恢复" : "归档" }}
            </n-button>
          </n-space>
        </article>
      </div>

      <footer v-if="projects.length || total > pageSize" class="project-list-pagination">
        <n-pagination
          v-model:page="page"
          :page-count="pageCount"
          :disabled="listLoading"
        />
        <n-text depth="3">
          第 {{ page }} 页，{{ hasMore ? "还有更多" : "已到末页" }}
        </n-text>
      </footer>
    </section>
  </main>
</template>

<style scoped>
.project-list-page {
  width: min(1120px, 100%);
  margin: 0 auto;
  padding: 32px 18px 64px;
}

.project-list-header,
.project-list-card__head,
.project-row,
.project-list-error,
.project-list-pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.project-list-header {
  margin-bottom: 18px;
}

.project-list-header h1 {
  margin: 4px 0 0;
  color: #f8fafc;
  font-size: 32px;
  line-height: 1.15;
}

.scope-select {
  width: 132px;
}

.project-list-alert {
  margin-bottom: 14px;
}

.project-list-error {
  width: 100%;
}

.project-list-card {
  min-height: 420px;
  padding: 18px;
  border: 1px solid rgba(148, 163, 184, 0.24);
  border-radius: 18px;
  background: rgba(15, 23, 42, 0.9);
  box-shadow: 0 20px 60px rgba(15, 23, 42, 0.24);
}

.project-list-card__head {
  padding-bottom: 14px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.16);
  color: #cbd5e1;
}

.project-list-loading,
.project-list-empty {
  display: grid;
  min-height: 300px;
  place-items: center;
  color: #94a3b8;
}

.project-list-table {
  display: grid;
  gap: 10px;
  padding-top: 14px;
}

.project-list-table.is-refreshing {
  opacity: 0.68;
}

.project-row {
  min-height: 78px;
  padding: 14px;
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 12px;
  background: rgba(2, 6, 23, 0.34);
}

.project-row__main {
  display: grid;
  min-width: 0;
  flex: 1 1 360px;
  gap: 5px;
  border: 0;
  padding: 0;
  color: inherit;
  text-align: left;
  background: transparent;
  cursor: pointer;
}

.project-row__main:disabled {
  cursor: wait;
}

.project-row__main strong {
  overflow: hidden;
  color: #f8fafc;
  font-size: 17px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.project-row__main span,
.project-row__meta span {
  color: #94a3b8;
  font-size: 12px;
}

.project-row__meta {
  display: grid;
  min-width: 178px;
  gap: 6px;
}

.project-row__actions {
  flex-wrap: nowrap;
}

.project-list-pagination {
  padding-top: 18px;
}

@media (max-width: 760px) {
  .project-list-header,
  .project-row,
  .project-list-pagination {
    align-items: stretch;
    flex-direction: column;
  }

  .project-row__meta {
    min-width: 0;
  }

  .project-row__actions {
    width: 100%;
  }
}
</style>
