import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { configureHttpApp } from './app.config';
import { AppModule } from './app.module';

/**
 * HTTP 入口：统一 /api 前缀，便于与 Vite 开发代理对齐
 */
async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  /** 首页「预览成片」可携带数字人图 data URL，需放宽 JSON 体积 */
  app.useBodyParser('json', { limit: '15mb' });
  configureHttpApp(app);
  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`API listening on http://localhost:${port}/api`);
}
void bootstrap();
