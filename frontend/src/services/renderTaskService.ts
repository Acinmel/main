import type { SmartClipRenderTask } from "@/api/task";

export type RenderTaskStatus = "pending" | "processing" | "success" | "failed";

export function toRenderTaskStatus(task: SmartClipRenderTask): RenderTaskStatus {
  if (task.status === "failed") return "failed";
  if (task.status === "completed") return "success";
  if (task.status === "processing") return "processing";
  return "pending";
}

export function isRenderTaskTerminal(task: SmartClipRenderTask) {
  const status = toRenderTaskStatus(task);
  return status === "success" || status === "failed";
}
