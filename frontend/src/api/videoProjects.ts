import { http } from "@/api/http";

export interface VideoProjectRecord {
  projectId: string;
  name: string;
  archived: boolean;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type VideoProjectScope = "active" | "archived" | "all";

export interface ListVideoProjectsParams {
  scope?: VideoProjectScope;
  limit?: number;
  offset?: number;
}

export interface VideoProjectListResponse {
  items: VideoProjectRecord[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

type RequestOptions = {
  signal?: AbortSignal;
};

export async function createVideoProject(
  body: { name: string },
  opts: RequestOptions = {},
) {
  const { data } = await http.post<VideoProjectRecord>("v1/video-projects", body, {
    timeout: 20_000,
    signal: opts.signal,
  });
  return data;
}

export async function listVideoProjects(
  params: ListVideoProjectsParams = {},
  opts: RequestOptions = {},
) {
  const { data } = await http.get<VideoProjectListResponse>("v1/video-projects", {
    params,
    timeout: 20_000,
    signal: opts.signal,
  });
  return data;
}

export async function getVideoProject(
  projectId: string,
  opts: RequestOptions = {},
) {
  const { data } = await http.get<VideoProjectRecord>(
    `v1/video-projects/${encodeURIComponent(projectId)}`,
    {
      timeout: 20_000,
      signal: opts.signal,
    },
  );
  return data;
}

export async function renameVideoProject(
  projectId: string,
  body: { name: string },
  opts: RequestOptions = {},
) {
  const { data } = await http.patch<VideoProjectRecord>(
    `v1/video-projects/${encodeURIComponent(projectId)}`,
    body,
    {
      timeout: 20_000,
      signal: opts.signal,
    },
  );
  return data;
}

export async function archiveVideoProject(
  projectId: string,
  body: { archived: boolean },
  opts: RequestOptions = {},
) {
  const { data } = await http.post<VideoProjectRecord>(
    `v1/video-projects/${encodeURIComponent(projectId)}/archive`,
    body,
    {
      timeout: 20_000,
      signal: opts.signal,
    },
  );
  return data;
}
