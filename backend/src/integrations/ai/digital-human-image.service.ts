import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { assertUrlSafeForServerFetch } from '../../common/url-safety.util';
import {
  getDigitalHumanStyleOrThrow,
  listDigitalHumanStylesPublic,
} from './digital-human-styles';

/**
 * 自拍照 → 数字人形象图。
 *
 * 优先级：
 * 1) 配置了 SEEDREAM_HTTP_URL + SEEDREAM_API_KEY：兼容 jiekou.ai 等「整段 URL」接口（如 /v3/seedream-4.5），
 *    请求体含 size、image[]、prompt、watermark、optimize_prompt_options、sequential_*（无 path 内嵌 model）
 * 2) 配置了 ARK_API_KEY：火山方舟 `POST .../v1/images/generations`（含 model、response_format 等）
 * 3) 配置了 DIGITAL_HUMAN_API_URL：自定义 JSON POST（content + image_base64 + style_id）
 * 4) 否则 mock
 */
@Injectable()
export class DigitalHumanImageService {
  private readonly logger = new Logger(DigitalHumanImageService.name);

  constructor(private readonly config: ConfigService) {}

  listStyles() {
    return { styles: listDigitalHumanStylesPublic() };
  }

  async generateFromSelfie(params: {
    imageBuffer: Buffer;
    mimeType: string;
    styleId: string;
  }): Promise<{
    imageUrl: string | null;
    styleId: string;
    styleLabel: string;
    contentUsed: string;
    mode: 'seedream' | 'ark' | 'remote' | 'mock';
    hint?: string;
  }> {
    const style = getDigitalHumanStyleOrThrow(params.styleId);
    const contentUsed = style.content;

    const seedreamUrl = this.config.get<string>('SEEDREAM_HTTP_URL')?.trim();
    const seedreamKey = this.config.get<string>('SEEDREAM_API_KEY')?.trim();
    if (seedreamUrl) {
      if (!seedreamKey) {
        throw new BadRequestException(
          '已配置 SEEDREAM_HTTP_URL 但未配置 SEEDREAM_API_KEY，无法调用 Seedream 兼容接口',
        );
      }
      return this.generateViaSeedreamHttp(params, style.id, style.label, contentUsed, seedreamUrl, seedreamKey);
    }

    const arkKey = this.config.get<string>('ARK_API_KEY')?.trim();
    if (arkKey) {
      return this.generateViaArk(params, style.id, style.label, contentUsed, arkKey);
    }

    const apiUrl = this.config.get<string>('DIGITAL_HUMAN_API_URL')?.trim();
    if (!apiUrl) {
      return {
        imageUrl: null,
        styleId: style.id,
        styleLabel: style.label,
        contentUsed,
        mode: 'mock',
        hint:
          '未配置 SEEDREAM_HTTP_URL+SEEDREAM_API_KEY、ARK_API_KEY 或 DIGITAL_HUMAN_API_URL。可在 .env 中配置 jiekou Seedream（SEEDREAM_HTTP_URL）或火山方舟（ARK_API_KEY）。',
      };
    }

    const apiKey = this.config.get<string>('DIGITAL_HUMAN_API_KEY')?.trim();
    const timeoutMs = Number(this.config.get('DIGITAL_HUMAN_API_TIMEOUT_MS') ?? 120_000);

    const body = {
      content: contentUsed,
      style_id: style.id,
      style_label: style.label,
      image_base64: params.imageBuffer.toString('base64'),
      mime_type: params.mimeType,
    };

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!res.ok) {
        const t = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status} ${t.slice(0, 500)}`);
      }

      const json = (await res.json()) as Record<string, unknown>;
      const imageUrl = this.pickImageUrl(json);
      if (!imageUrl) {
        throw new Error('响应中未找到图片 URL 字段（支持 image_url / url / data.image_url 等）');
      }

      return {
        imageUrl,
        styleId: style.id,
        styleLabel: style.label,
        contentUsed,
        mode: 'remote',
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`数字人生成接口失败：${msg}`);
      throw e;
    }
  }

  /**
   * Seedream 兼容网关（如 jiekou.ai `POST .../v3/seedream-4.5`）：官方示例字段为
   * size、image、prompt、watermark、optimize_prompt_options、sequential_image_generation 等（无 body 内 model）。
   * image 默认传 data URL 字符串数组；若接口要求对象数组可设 SEEDREAM_IMAGE_ITEM_STYLE=object。
   */
  private async generateViaSeedreamHttp(
    params: { imageBuffer: Buffer; mimeType: string; styleId: string },
    styleId: string,
    styleLabel: string,
    contentUsed: string,
    apiUrl: string,
    apiKey: string,
  ): Promise<{
    imageUrl: string;
    styleId: string;
    styleLabel: string;
    contentUsed: string;
    mode: 'seedream';
  }> {
    const size = this.config.get<string>('SEEDREAM_IMAGE_SIZE')?.trim() || '2K';
    const wmRaw = this.config.get<string>('SEEDREAM_IMAGE_WATERMARK')?.trim();
    const watermark =
      wmRaw === undefined || wmRaw === ''
        ? true
        : wmRaw !== '0' && wmRaw !== 'false' && wmRaw !== 'no';

    const timeoutMs = Number(this.config.get('SEEDREAM_HTTP_TIMEOUT_MS') ?? 300_000);

    const seqRaw =
      this.config.get<string>('SEEDREAM_SEQUENTIAL_IMAGE_GENERATION')?.trim() ||
      this.config.get<string>('ARK_SEQUENTIAL_IMAGE_GENERATION')?.trim() ||
      'auto';
    const sequentialImageGeneration = seqRaw === 'disabled' ? 'disabled' : 'auto';

    const maxRaw =
      this.config.get<string | number>('SEEDREAM_SEQUENTIAL_MAX_IMAGES') ??
      this.config.get<string | number>('ARK_SEQUENTIAL_MAX_IMAGES') ??
      3;
    const maxParsed =
      typeof maxRaw === 'number' ? maxRaw : Number(String(maxRaw).trim());
    const maxImages = Number.isFinite(maxParsed)
      ? Math.min(15, Math.max(1, Math.floor(maxParsed)))
      : 3;

    const prompt = this.buildArkPrompt(contentUsed, styleLabel, params.mimeType);
    const dataUrl = this.bufferToImageDataUrl(params.imageBuffer, params.mimeType);
    const imageField = this.buildSeedreamImageField(dataUrl);

    const body: Record<string, unknown> = {
      size,
      image: imageField,
      prompt,
      watermark,
      sequential_image_generation: sequentialImageGeneration,
    };

    if (sequentialImageGeneration !== 'disabled') {
      body.sequential_image_generation_options = {
        max_images: maxImages,
      };
    }

    const optMode = this.config.get<string>('SEEDREAM_OPTIMIZE_PROMPT_MODE')?.trim();
    if (optMode) {
      body.optimize_prompt_options = { mode: optMode };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const t = await res.text().catch(() => '');
        throw new Error(`Seedream HTTP ${res.status} ${t.slice(0, 500)}`);
      }

      const json = (await res.json()) as Record<string, unknown>;
      const imageUrl = this.pickImageUrl(json);
      if (!imageUrl) {
        throw new Error('Seedream 响应中未找到图片 URL');
      }

      return {
        imageUrl,
        styleId,
        styleLabel,
        contentUsed,
        mode: 'seedream',
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`Seedream 数字人生成失败：${msg}`);
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * jiekou 文档里 `image` 多为字符串数组（URL 或 data URL）；若 `image: [{}]` 需对象，设 SEEDREAM_IMAGE_ITEM_STYLE=object。
   */
  private buildSeedreamImageField(dataUrl: string): unknown[] {
    const style = this.config.get<string>('SEEDREAM_IMAGE_ITEM_STYLE')?.trim() || 'string';
    if (style === 'object') {
      const key = this.config.get<string>('SEEDREAM_IMAGE_OBJECT_KEY')?.trim() || 'image';
      return [{ [key]: dataUrl }];
    }
    return [dataUrl];
  }

  /**
   * 火山方舟：OpenAI 兼容 `POST .../v1/images/generations`（与 Python OpenAI 客户端等价）。
   * 使用 fetch 直传 JSON，支持方舟扩展字段：参考图 `image`（data URL）、
   * `sequential_image_generation`（默认 auto，非 disabled）、组图选项等。
   */
  private async generateViaArk(
    params: { imageBuffer: Buffer; mimeType: string; styleId: string },
    styleId: string,
    styleLabel: string,
    contentUsed: string,
    apiKey: string,
  ): Promise<{
    imageUrl: string;
    styleId: string;
    styleLabel: string;
    contentUsed: string;
    mode: 'ark';
  }> {
    /** 图片生成：`POST {api/v3}/images/generations`（末尾多 `/v1` 的旧配置会自动去掉） */
    const rawBase =
      this.config.get<string>('ARK_BASE_URL')?.trim() ||
      'https://ark.cn-beijing.volces.com/api/v3';
    let base = rawBase.replace(/\/$/, '');
    if (base.endsWith('/v1')) base = base.slice(0, -3);
    const url = `${base}/images/generations`;
    const model =
      this.config.get<string>('ARK_IMAGE_MODEL')?.trim() || 'doubao-seedream-5-0-260128';
    const size = this.config.get<string>('ARK_IMAGE_SIZE')?.trim() || '2K';
    const wmRaw = this.config.get<string>('ARK_IMAGE_WATERMARK')?.trim();
    const watermark = wmRaw !== '0' && wmRaw !== 'false' && wmRaw !== 'no';

    const timeoutMs = Number(this.config.get('ARK_IMAGE_TIMEOUT_MS') ?? 300_000);

    /** 组图：仅 `disabled` 关闭；其余为 `auto`（模型决定是否组图，见方舟文档） */
    const sequentialRaw =
      this.config.get<string>('ARK_SEQUENTIAL_IMAGE_GENERATION')?.trim() || 'auto';
    const sequentialImageGeneration = sequentialRaw === 'disabled' ? 'disabled' : 'auto';

    const maxImagesParsed = Number(this.config.get('ARK_SEQUENTIAL_MAX_IMAGES') ?? 3);
    const maxImages = Number.isFinite(maxImagesParsed)
      ? Math.min(15, Math.max(1, Math.floor(maxImagesParsed)))
      : 3;

    const prompt = this.buildArkPrompt(contentUsed, styleLabel, params.mimeType);
    const refImageDataUrl = this.bufferToImageDataUrl(params.imageBuffer, params.mimeType);

    const requestBody: Record<string, unknown> = {
      model,
      prompt,
      size,
      response_format: 'url',
      watermark,
      sequential_image_generation: sequentialImageGeneration,
      /** 参考图：官方支持 URL 或 data:image/...;base64,... */
      image: [refImageDataUrl],
    };

    if (sequentialImageGeneration !== 'disabled') {
      requestBody.sequential_image_generation_options = {
        max_images: maxImages,
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!res.ok) {
        const t = await res.text().catch(() => '');
        throw new Error(`Ark HTTP ${res.status} ${t.slice(0, 500)}`);
      }

      const json = (await res.json()) as Record<string, unknown>;
      const imageUrl = this.pickImageUrl(json);
      if (!imageUrl) {
        throw new Error('Ark 响应中未找到图片 URL（期望 data[0].url）');
      }

      return {
        imageUrl,
        styleId,
        styleLabel,
        contentUsed,
        mode: 'ark',
      };
    } catch (e) {
      clearTimeout(timer);
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`Ark 数字人生成失败：${msg}`);
      throw e;
    }
  }

  /** 参考图 data URL（与方舟文档一致：格式名小写） */
  private bufferToImageDataUrl(buffer: Buffer, mimeType: string): string {
    const sub = mimeType.includes('png') ? 'png' : 'jpeg';
    return `data:image/${sub};base64,${buffer.toString('base64')}`;
  }

  /** Ark：风格预设 + 口播数字人说明；参考人脸已由 image[] 传入 */
  private buildArkPrompt(contentUsed: string, styleLabel: string, mimeType: string): string {
    const suffix =
      this.config.get<string>('ARK_IMAGE_PROMPT_SUFFIX')?.trim() ||
      [
        '【输出要求】在严格保留参考人脸身份特征的前提下，生成适合短视频口播使用的数字人形象图，',
        '人物主体清晰、光线自然，构图适合竖屏或半身虚拟主播展示。',
        `参考图为 ${mimeType.includes('png') ? 'PNG' : 'JPEG'} 人像；请与上述风格「${styleLabel}」在着装与气质上保持一致。`,
      ].join('');

    return `${contentUsed}\n\n${suffix}`;
  }

  /**
   * 拉取远端返回的图片 URL 到内存（用于落盘）；含 SSRF 校验与体积上限。
   */
  async fetchRemoteImageBuffer(imageUrl: string): Promise<{ buffer: Buffer; ext: '.png' | '.jpg' }> {
    let u: URL;
    try {
      u = new URL(imageUrl);
    } catch {
      throw new BadRequestException('图片地址无效');
    }
    assertUrlSafeForServerFetch(u);

    const timeoutMs = Number(this.config.get('DIGITAL_HUMAN_API_TIMEOUT_MS') ?? 120_000);
    const maxBytes = Number(this.config.get('DIGITAL_HUMAN_IMAGE_MAX_BYTES') ?? 15 * 1024 * 1024);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(imageUrl, { signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new BadRequestException(`拉取生成图失败：HTTP ${res.status} ${t.slice(0, 200)}`);
    }

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes) {
      throw new BadRequestException(`生成图过大（>${maxBytes} 字节）`);
    }

    const ct = (res.headers.get('content-type') ?? '').toLowerCase();
    const pathLower = u.pathname.toLowerCase();
    let ext: '.png' | '.jpg' = '.jpg';
    if (ct.includes('png') || pathLower.endsWith('.png')) ext = '.png';
    else if (ct.includes('jpeg') || ct.includes('jpg') || pathLower.endsWith('.jpg') || pathLower.endsWith('.jpeg')) {
      ext = '.jpg';
    }

    return { buffer: buf, ext };
  }

  private pickImageUrl(json: Record<string, unknown>): string | null {
    const direct =
      (json.image_url as string) ||
      (json.imageUrl as string) ||
      (json.url as string) ||
      null;
    if (direct && typeof direct === 'string') return direct;

    const dataRaw = json.data;
    if (Array.isArray(dataRaw) && dataRaw.length > 0) {
      const first = dataRaw[0];
      if (first && typeof first === 'object') {
        const o = first as Record<string, unknown>;
        const u =
          (o.url as string) || (o.image_url as string) || (o.imageUrl as string);
        if (u && typeof u === 'string') return u;
      }
    }

    const data = dataRaw as Record<string, unknown> | undefined;
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      const u =
        (data.image_url as string) ||
        (data.url as string) ||
        (data.imageUrl as string);
      if (u && typeof u === 'string') return u;
    }

    const result = json.result as Record<string, unknown> | undefined;
    if (result && typeof result === 'object') {
      const u = (result.url as string) || (result.image_url as string);
      if (u && typeof u === 'string') return u;
    }

    const output = json.output as Record<string, unknown> | undefined;
    if (output && typeof output === 'object') {
      const u = (output.url as string) || (output.image_url as string);
      if (u && typeof u === 'string') return u;
    }

    const imagesRaw = json.images;
    if (Array.isArray(imagesRaw) && imagesRaw.length > 0) {
      const first = imagesRaw[0];
      if (typeof first === 'string') return first;
      if (first && typeof first === 'object') {
        const o = first as Record<string, unknown>;
        const u = (o.url as string) || (o.image_url as string);
        if (u && typeof u === 'string') return u;
      }
    }

    return null;
  }
}
