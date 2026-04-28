/**
 * 在加载其它模块前读入 .env，使 FileInterceptor 等装饰器能读到 WHISPER_MEDIA_MAX_BYTES。
 *
 * 说明：pm2 / nest 的 process.cwd() 常为 backend/，只会读到 backend/.env；
 * Docker / 运维常在仓库根目录放 .env。此处按「根目录 → backend」顺序加载，
 * 后者 override，保证本地改 backend/.env 仍优先于根目录同名键。
 */
import { existsSync } from 'fs';
import { config } from 'dotenv';
import { resolve } from 'path';

const backendEnv = resolve(__dirname, '..', '.env');
const repoRootEnv = resolve(__dirname, '..', '..', '.env');

if (existsSync(repoRootEnv)) {
  config({ path: repoRootEnv });
}
if (existsSync(backendEnv)) {
  config({ path: backendEnv, override: true });
}
