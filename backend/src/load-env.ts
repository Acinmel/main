/**
 * 在加载其它模块前读入 backend/.env，使 FileInterceptor 等装饰器能读到 WHISPER_MEDIA_MAX_BYTES。
 */
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env') });
