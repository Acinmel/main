/**
 * 火山方舟图片生成连通性测试（与 digital-human-image.generateViaArk 一致）。
 * 依赖：backend/.env 中 ARK_API_KEY（及可选 ARK_BASE_URL、ARK_IMAGE_MODEL）
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

/** 方舟要求参考图至少约 14×14px；使用公网测试 JPEG（需能访问外网） */
const REF_JPEG_URL = 'https://httpbin.org/image/jpeg';

function pickImageUrl(json) {
  const direct =
    json.image_url || json.imageUrl || json.url || null;
  if (direct && typeof direct === 'string') return direct;
  const dataRaw = json.data;
  if (Array.isArray(dataRaw) && dataRaw.length > 0) {
    const o = dataRaw[0];
    if (o && typeof o === 'object') {
      const u = o.url || o.image_url || o.imageUrl;
      if (u && typeof u === 'string') return u;
    }
  }
  return null;
}

async function main() {
  const apiKey = process.env.ARK_API_KEY?.trim();
  if (!apiKey) {
    console.error('未设置 ARK_API_KEY。');
    process.exit(1);
  }

  const refRes = await fetch(REF_JPEG_URL);
  if (!refRes.ok) {
    console.error('无法下载测试参考图', REF_JPEG_URL, refRes.status);
    process.exit(1);
  }
  const refBuf = Buffer.from(await refRes.arrayBuffer());
  const refDataUrl = `data:image/jpeg;base64,${refBuf.toString('base64')}`;

  let base = (process.env.ARK_BASE_URL?.trim() || 'https://ark.cn-beijing.volces.com/api/v3').replace(
    /\/$/,
    '',
  );
  if (base.endsWith('/v1')) base = base.slice(0, -3);
  const url = `${base}/images/generations`;

  const model =
    process.env.ARK_IMAGE_MODEL?.trim() || 'doubao-seedream-5-0-260128';

  const body = {
    model,
    prompt: '连通性测试：输出一张简单静物图。',
    size: process.env.ARK_IMAGE_SIZE?.trim() || '2K',
    response_format: 'url',
    watermark: true,
    sequential_image_generation: 'disabled',
    image: [refDataUrl],
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  console.log('POST', url);
  console.log('HTTP', res.status);
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    console.log(text.slice(0, 2000));
    process.exit(res.ok ? 0 : 1);
  }
  console.log(JSON.stringify(json, null, 2).slice(0, 2500));
  const u = pickImageUrl(json);
  if (res.ok && u) {
    console.log('\nOK，图片 URL 前缀:', String(u).slice(0, 80) + '...');
  }
  if (!res.ok) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
