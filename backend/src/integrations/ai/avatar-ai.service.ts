import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type TalkingAvatarJobRequest = {
  /** 占位：不同厂商字段不同，这里仅保留通用信息 */
  provider: 'stub' | 'custom_http';
  endpoint?: string;
  payload: {
    taskId: string;
    /** 口播最终文案 */
    script: string;
    /** 用户照片在对象存储上的 URL（未来） */
    portraitAssetUrl?: string;
    /** 生成模式 */
    mode: string;
    /** 画幅 */
    aspect: string;
  };
};

/**
 * 「照片开口」/数字人驱动：此处只组装 job 请求占位，不调用外网。
 *
 * 常见对接方向（按需二选一或组合）：
 * - 厂商 HTTP API（HeyGen、SadTalker 云服务、火山等）：在此填充 endpoint、签名头、multipart
 * - 自建 GPU 服务：投递到内部队列，由渲染 Worker 消费
 */
@Injectable()
export class AvatarAiService {
  private readonly logger = new Logger(AvatarAiService.name);

  constructor(private readonly config: ConfigService) {}

  buildJobRequest(params: {
    taskId: string;
    script: string;
    mode: string;
    aspect: string;
  }): TalkingAvatarJobRequest {
    const endpoint = this.config.get<string>('AVATAR_HTTP_ENDPOINT')?.trim();
    return {
      provider: endpoint ? 'custom_http' : 'stub',
      endpoint: endpoint || undefined,
      payload: {
        taskId: params.taskId,
        script: params.script,
        mode: params.mode,
        aspect: params.aspect,
        portraitAssetUrl: undefined,
      },
    };
  }

  async driveWithPlaceholder(params: {
    taskId: string;
    script: string;
    mode: string;
    aspect: string;
  }): Promise<{ ok: boolean; note: string }> {
    const job = this.buildJobRequest(params);
    this.logger.log(
      `task=${params.taskId} Avatar job 占位：${JSON.stringify({
        provider: job.provider,
        endpoint: job.endpoint,
        scriptPreview: `${job.payload.script.slice(0, 80)}…`,
      })}`,
    );
    return { ok: true, note: '数字人驱动请求已记录，待接入真实服务' };
  }
}
