import { Module } from '@nestjs/common';
import { AiModule } from '../../integrations/ai/ai.module';
import { FfmpegAudioService } from '../../integrations/media/ffmpeg-audio.service';
import { ResourcesController } from './resources.controller';
import { ResourcesService } from './resources.service';

@Module({
  imports: [AiModule],
  controllers: [ResourcesController],
  providers: [ResourcesService, FfmpegAudioService],
  exports: [ResourcesService],
})
export class ResourcesModule {}
