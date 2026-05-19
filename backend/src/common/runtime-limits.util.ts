type ReleaseFn = () => void;

class RuntimeLimiter {
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(
    private readonly name: string,
    private concurrency: number,
    private queueLimit: number,
  ) {}

  setLimits(concurrency: number, queueLimit: number): void {
    this.concurrency = Math.max(1, Math.floor(concurrency));
    this.queueLimit = Math.max(0, Math.floor(queueLimit));
    this.drain();
  }

  async run<T>(work: () => Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      return await work();
    } finally {
      release();
    }
  }

  private acquire(): Promise<ReleaseFn> {
    if (this.active < this.concurrency) {
      this.active += 1;
      return Promise.resolve(() => this.release());
    }
    if (this.waiting.length >= this.queueLimit) {
      return Promise.reject(new Error(`${this.name} queue is full`));
    }
    return new Promise((resolve) => {
      this.waiting.push(() => {
        this.active += 1;
        resolve(() => this.release());
      });
    });
  }

  private release(): void {
    this.active = Math.max(0, this.active - 1);
    this.drain();
  }

  private drain(): void {
    while (this.active < this.concurrency) {
      const next = this.waiting.shift();
      if (!next) return;
      next();
    }
  }
}

const runtimeLimiters = new Map<string, RuntimeLimiter>();

export function readPositiveInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export function runWithRuntimeLimit<T>(
  name: string,
  options: { concurrency: number; queueLimit: number },
  work: () => Promise<T>,
): Promise<T> {
  const concurrency = Math.max(1, Math.floor(options.concurrency));
  const queueLimit = Math.max(0, Math.floor(options.queueLimit));
  const existing = runtimeLimiters.get(name);
  if (existing) {
    existing.setLimits(concurrency, queueLimit);
    return existing.run(work);
  }
  const limiter = new RuntimeLimiter(name, concurrency, queueLimit);
  runtimeLimiters.set(name, limiter);
  return limiter.run(work);
}
