import { Module } from '@nestjs/common';
import { AvatarAiService } from './avatar-ai.service';
import { RewriteAiService } from './rewrite-ai.service';
import { SpeechAiService } from './speech-ai.service';
import { TranscriptionAiService } from './transcription-ai.service';
import { VideoGenerateLlmService } from './video-generate-llm.service';
import { DigitalHumanImageService } from './digital-human-image.service';
import { SeedanceI2vService } from './seedance-i2v.service';
import { ArkI2vVideoService } from './ark-i2v-video.service';

@Module({
  providers: [
    RewriteAiService,
    TranscriptionAiService,
    SpeechAiService,
    AvatarAiService,
    VideoGenerateLlmService,
    DigitalHumanImageService,
    SeedanceI2vService,
    ArkI2vVideoService,
  ],
  exports: [
    RewriteAiService,
    TranscriptionAiService,
    SpeechAiService,
    AvatarAiService,
    VideoGenerateLlmService,
    DigitalHumanImageService,
    SeedanceI2vService,
    ArkI2vVideoService,
  ],
})
export class AiModule {}
