import { Module } from '@nestjs/common';
import { AiModule } from '../../integrations/ai/ai.module';
import { DigitalHumanModule } from '../digital-human/digital-human.module';
import { FfmpegAudioService } from '../../integrations/media/ffmpeg-audio.service';
import { VideoMediaDownloadService } from '../../integrations/video/video-media-download.service';
import { VideoMetaService } from '../../integrations/video/video-meta.service';
import { ToolsController } from './tools.controller';

@Module({
  imports: [AiModule, DigitalHumanModule],
  controllers: [ToolsController],
  providers: [
    VideoMetaService,
    VideoMediaDownloadService,
    FfmpegAudioService,
  ],
})
export class ToolsModule {}
