import { Module } from '@nestjs/common';
import { AiModule } from '../../integrations/ai/ai.module';
import { DigitalHumanModule } from '../digital-human/digital-human.module';
import { FfmpegAudioService } from '../../integrations/media/ffmpeg-audio.service';
import { DouyinBenchmarkService } from '../../integrations/video/douyin-benchmark.service';
import { VideoMediaDownloadService } from '../../integrations/video/video-media-download.service';
import { VideoMetaService } from '../../integrations/video/video-meta.service';
import { ResourcesModule } from '../resources/resources.module';
import { SubtitleWorkflowService } from './subtitle-workflow.service';
import { ToolsController } from './tools.controller';
import { VideoProjectRenderService } from './video-project-render.service';
import { VideoProjectsController } from './video-projects.controller';

@Module({
  imports: [AiModule, DigitalHumanModule, ResourcesModule],
  controllers: [ToolsController, VideoProjectsController],
  providers: [
    DouyinBenchmarkService,
    VideoMetaService,
    VideoMediaDownloadService,
    FfmpegAudioService,
    SubtitleWorkflowService,
    VideoProjectRenderService,
  ],
})
export class ToolsModule {}
