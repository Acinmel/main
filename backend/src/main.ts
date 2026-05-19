import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import { configureHttpApp } from './app.config';
import { AppModule } from './app.module';

function resolveUploadRoot(): string {
  const configured = process.env.UPLOAD_DIR?.trim();
  return path.resolve(configured || 'uploads');
}

function ensureUploadDirs(root: string): void {
  for (const dir of ['video', 'audio', 'output']) {
    mkdirSync(path.join(root, dir), { recursive: true });
  }
}

function printBuildInfo(): void {
  const candidates = [
    path.join(process.cwd(), 'BUILD_INFO.json'),
    path.join(process.cwd(), 'backend', 'BUILD_INFO.json'),
  ];
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    try {
      console.log(`BUILD_INFO ${readFileSync(candidate, 'utf8')}`);
      return;
    } catch {
      return;
    }
  }
}

/**
 * HTTP 入口：统一 /api 前缀，便于与 Vite 开发代理对齐
 */
async function bootstrap() {
  printBuildInfo();
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  /** 首页「预览成片」可携带数字人图 data URL，需放宽 JSON 体积 */
  app.useBodyParser('json', { limit: '15mb' });
  const uploadRoot = resolveUploadRoot();
  ensureUploadDirs(uploadRoot);
  app.useStaticAssets(uploadRoot, { prefix: '/uploads/' });
  configureHttpApp(app);
  const port = process.env.PORT ?? 3000;
  await app.listen(port);

  console.log(`API listening on http://localhost:${port}/api`);
}
void bootstrap();
