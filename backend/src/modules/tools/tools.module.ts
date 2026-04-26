import { Module } from '@nestjs/common';
import { AiModule } from '../../integrations/ai/ai.module';
import { DigitalHumanModule } from '../digital-human/digital-human.module';
import { FfmpegAudioService } from '../../integrations/media/ffmpeg-audio.service';
import { VideoMediaDownloadService } from '../../integrations/video/video-media-download.service';
import { VideoMetaService } from '../../integrations/video/video-meta.service';
import { WhisperTranscriptStore } from '../../integrations/whisper/whisper-transcript.store';
import { WhisperService } from '../../integrations/whisper/whisper.service';
import { ToolsController } from './tools.controller';

@Module({
  imports: [AiModule, DigitalHumanModule],
  controllers: [ToolsController],
  providers: [
    VideoMetaService,
    VideoMediaDownloadService,
    FfmpegAudioService,
    WhisperTranscriptStore,
    WhisperService,
  ],
})
export class ToolsModule {}
