import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type TalkingAvatarJobRequest = {
  provider: 'stub' | 'custom_http';
  endpoint?: string;
  payload: {
    taskId: string;
    script: string;
    portraitAssetUrl?: string;
    mode: string;
    aspect: string;
  };
};

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
      `task=${params.taskId} Avatar job placeholder: ${JSON.stringify({
        provider: job.provider,
        endpoint: job.endpoint,
        scriptPreview: `${job.payload.script.slice(0, 80)}...`,
      })}`,
    );
    await Promise.resolve();
    return { ok: true, note: 'Avatar request recorded, waiting worker' };
  }
}
