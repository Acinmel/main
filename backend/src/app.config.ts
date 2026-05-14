import type { INestApplication } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

/**
 * Shared HTTP bootstrap config for local e2e and production runtime.
 */
export function configureHttpApp(app: INestApplication): void {
  app.setGlobalPrefix('api');
  assertProductionRuntimeConfig();
  applySecurityHeaders(app);
  applyCors(app);
  applyTrustProxy(app);
  applyBasicRateLimit(app);
}

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

function assertProductionRuntimeConfig(): void {
  if (!isProduction()) {
    return;
  }
  if (!process.env.JWT_SECRET?.trim()) {
    throw new Error('JWT_SECRET is required when NODE_ENV=production');
  }
  if (!process.env.CORS_ORIGINS?.trim()) {
    throw new Error('CORS_ORIGINS is required when NODE_ENV=production');
  }
}

function applySecurityHeaders(app: INestApplication): void {
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-DNS-Prefetch-Control', 'off');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
    res.setHeader(
      'Permissions-Policy',
      'camera=(), microphone=(), geolocation=(), payment=()',
    );
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    );
    if (
      isProduction() &&
      (req.secure || req.headers['x-forwarded-proto'] === 'https')
    ) {
      res.setHeader(
        'Strict-Transport-Security',
        'max-age=31536000; includeSubDomains',
      );
    }
    next();
  });
}

function applyCors(app: INestApplication): void {
  const raw = process.env.CORS_ORIGINS?.trim();
  if (!raw) {
    app.enableCors({ origin: true });
    return;
  }
  const allowed = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (allowed.length === 0) {
    app.enableCors({ origin: !isProduction() });
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
      callback(null, allowed.includes(origin));
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

type RateBucket = {
  resetAt: number;
  count: number;
};

const rateBuckets = new Map<string, RateBucket>();

function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  const parsed = raw ? Number(raw) : fallback;
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

function routeLimit(path: string, method: string): number {
  if (method === 'OPTIONS') {
    return Number.POSITIVE_INFINITY;
  }
  if (path.startsWith('/api/v1/auth/')) {
    return readPositiveInt('RATE_LIMIT_AUTH_MAX', 20);
  }
  if (path.startsWith('/api/v1/tools/')) {
    return readPositiveInt('RATE_LIMIT_AI_MAX', 60);
  }
  return readPositiveInt('RATE_LIMIT_GENERAL_MAX', 600);
}

function clientKey(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  const forwardedIp = Array.isArray(forwarded)
    ? forwarded[0]
    : forwarded?.split(',')[0];
  return (
    forwardedIp?.trim() ||
    req.ip ||
    req.socket.remoteAddress ||
    'unknown-client'
  );
}

function applyBasicRateLimit(app: INestApplication): void {
  const windowMs = readPositiveInt('RATE_LIMIT_WINDOW_MS', 60_000);
  app.use((req: Request, res: Response, next: NextFunction) => {
    const limit = routeLimit(req.path, req.method);
    if (!Number.isFinite(limit)) {
      next();
      return;
    }
    const now = Date.now();
    const key = `${clientKey(req)}:${req.method}:${req.path}`;
    const bucket = rateBuckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }
    bucket.count += 1;
    if (bucket.count <= limit) {
      next();
      return;
    }
    const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    res.setHeader('Retry-After', String(retryAfter));
    res.status(429).json({
      statusCode: 429,
      message: '请求过于频繁，请稍后再试',
    });
  });

  setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of rateBuckets.entries()) {
      if (bucket.resetAt <= now) {
        rateBuckets.delete(key);
      }
    }
  }, windowMs).unref?.();
}
