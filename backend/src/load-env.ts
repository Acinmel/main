/**
 * 在加载其它模块前读入 .env，使 FileInterceptor 等装饰器能读到 WHISPER_MEDIA_MAX_BYTES。
 *
 * - Docker 容器：先根目录 .env（compose 常挂载到 /workspace/.env），再 backend/.env 覆盖。
 * - 本机 pm2 / nest：只读 backend/.env。若连根目录 .env 一起读，会带入 MYSQL_DATABASE 等，
 *   本地未起 MySQL 时 DatabaseService 连库失败 → 进程退出 → 前端/Nginx 502。
 */
import { existsSync } from 'fs';
import { config } from 'dotenv';
import { resolve } from 'path';

const backendEnv = resolve(__dirname, '..', '.env');
const repoRootEnv = resolve(__dirname, '..', '..', '.env');
const inDocker = existsSync('/.dockerenv');

if (inDocker) {
  if (existsSync(repoRootEnv)) config({ path: repoRootEnv });
  // 不得 override：docker compose 已把 WHISPER_HTTP_URL、FFMPEG_BIN 等注入 process.env；
  // backend/.env 里常见的 127.0.0.1、Windows 路径会覆盖容器内正确的 whisper:8010、/usr/bin/ffmpeg。
  if (existsSync(backendEnv)) config({ path: backendEnv, override: false });
} else if (existsSync(backendEnv)) {
  config({ path: backendEnv });
}
