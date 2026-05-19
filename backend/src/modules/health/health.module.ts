import { Module } from '@nestjs/common';
import { FfmpegAudioService } from '../../integrations/media/ffmpeg-audio.service';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

@Module({
  controllers: [HealthController],
  providers: [HealthService, FfmpegAudioService],
})
export class HealthModule {}
