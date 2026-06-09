import { Module } from '@nestjs/common';
import { AiModule } from '../../integrations/ai/ai.module';
import { DigitalHumanModule } from '../digital-human/digital-human.module';
import { FfmpegAudioService } from '../../integrations/media/ffmpeg-audio.service';
import { DouyinBenchmarkService } from '../../integrations/video/douyin-benchmark.service';
import { VideoMediaDownloadService } from '../../integrations/video/video-media-download.service';
import { VideoMetaService } from '../../integrations/video/video-meta.service';
import { ResourcesModule } from '../resources/resources.module';
import { SubtitleWorkflowService } from './subtitle-workflow.service';
import { TaskStatusCacheService } from './task-status-cache.service';
import { VoicePreviewTaskService } from './voice-preview-task.service';
import { RecentExtractionService } from './recent-extraction.service';
import { SavedVideoService } from './saved-video.service';
import { ToolsController } from './tools.controller';
import { VideoProjectRenderService } from './video-project-render.service';
import { VideoProjectsController } from './video-projects.controller';
import { VideoScriptController } from './video-script.controller';
import { VideoScriptService } from './video-script.service';
import { TitleAssetsController } from './title-assets.controller';
import { TitleAssetsService } from './title-assets.service';
import { FfmpegSubtitleBurnerService } from './ffmpeg-subtitle-burner.service';
import { StagedWorkflowService } from './staged-workflow.service';
import { StagedWorkflowController } from './staged-workflow.controller';
import { VideoProjectsService } from './video-projects.service';

@Module({
  imports: [AiModule, DigitalHumanModule, ResourcesModule],
  controllers: [
    ToolsController,
    VideoProjectsController,
    VideoScriptController,
    TitleAssetsController,
    StagedWorkflowController,
  ],
  providers: [
    DouyinBenchmarkService,
    VideoMetaService,
    VideoMediaDownloadService,
    FfmpegAudioService,
    SubtitleWorkflowService,
    TaskStatusCacheService,
    VoicePreviewTaskService,
    RecentExtractionService,
    SavedVideoService,
    VideoProjectRenderService,
    VideoScriptService,
    TitleAssetsService,
    FfmpegSubtitleBurnerService,
    StagedWorkflowService,
    VideoProjectsService,
  ],
})
export class ToolsModule {}
