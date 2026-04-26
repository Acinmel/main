/**
 * 轮询工具：直到 predicate 为真或超时
 */
export async function pollUntil<T>(
  fn: () => Promise<T>,
  predicate: (v: T) => boolean,
  options: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<T> {
  const intervalMs = options.intervalMs ?? 800
  const timeoutMs = options.timeoutMs ?? 120_000
  const start = Date.now()

  for (;;) {
    const value = await fn()
    if (predicate(value)) return value
    if (Date.now() - start > timeoutMs) {
      throw new Error('轮询超时，请稍后重试或刷新页面')
    }
    await new Promise((r) => setTimeout(r, intervalMs))
  }
}
