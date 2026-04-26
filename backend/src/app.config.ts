import type { INestApplication } from '@nestjs/common';

/**
 * 与 main 一致：全局前缀、CORS、反向代理信任（供 e2e 与生产共用）
 */
export function configureHttpApp(app: INestApplication): void {
  app.setGlobalPrefix('api');
  applyCors(app);
  applyTrustProxy(app);
}

function applyCors(app: INestApplication): void {
  const raw = process.env.CORS_ORIGINS?.trim();
  if (!raw) {
    app.enableCors({ origin: true });
    return;
  }
  const allowed = raw.split(',').map((s) => s.trim()).filter(Boolean);
  if (allowed.length === 0) {
    app.enableCors({ origin: true });
    return;
  }
  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
      if (!origin) {
        callback(null, true);
        return;
      }
      if (allowed.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
  });
}

function applyTrustProxy(app: INestApplication): void {
  if (process.env.TRUST_PROXY !== '1' && process.env.TRUST_PROXY !== 'true') {
    return;
  }
  const server = app.getHttpAdapter().getInstance() as {
    set?: (key: string, value: unknown) => void;
  };
  server?.set?.('trust proxy', 1);
}
