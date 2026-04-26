/**
 * 连通性 / 鉴权测试：读取 backend/.env 中的 SEEDREAM_HTTP_URL、SEEDREAM_API_KEY，
 * 发送与 digital-human-image.service 一致的最小请求体（sequential 关闭以省配额）。
 *
 * 用法：在 backend 目录执行  npm run test:seedream
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const REF_JPEG_URL = 'https://httpbin.org/image/jpeg';

async function main() {
  const apiUrl =
    process.env.SEEDREAM_HTTP_URL?.trim() || 'https://api.jiekou.ai/v3/seedream-4.5';
  const apiKey = process.env.SEEDREAM_API_KEY?.trim();

  if (!apiKey) {
    console.error(
      '未设置 SEEDREAM_API_KEY。请在 backend/.env 中配置 SEEDREAM_HTTP_URL 与 SEEDREAM_API_KEY 后重试。',
    );
    process.exit(1);
  }

  const refRes = await fetch(REF_JPEG_URL);
  if (!refRes.ok) {
    console.error('无法下载测试参考图', REF_JPEG_URL, refRes.status);
    process.exit(1);
  }
  const refBuf = Buffer.from(await refRes.arrayBuffer());
  const refDataUrl = `data:image/jpeg;base64,${refBuf.toString('base64')}`;

  const body = {
    size: process.env.SEEDREAM_IMAGE_SIZE?.trim() || '2K',
    image: [refDataUrl],
    prompt: '连通性测试：请输出一张简单静物图。',
    watermark: true,
    sequential_image_generation: 'disabled',
  };

  const res = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  console.log('HTTP', res.status);
  console.log(text.slice(0, 2000));

  if (!res.ok) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
