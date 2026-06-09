import { Module } from '@nestjs/common';
import { AvatarAiService } from './avatar-ai.service';
import { RewriteAiService } from './rewrite-ai.service';
import { SpeechAiService } from './speech-ai.service';
import { TranscriptionAiService } from './transcription-ai.service';
import { DigitalHumanImageService } from './digital-human-image.service';
import { AliLipSyncService } from './ali-lip-sync.service';
import { QwenVoiceCloneService } from './qwen-voice-clone.service';
import { TranscriptStore } from '../transcription/transcript.store';

@Module({
  providers: [
    RewriteAiService,
    TranscriptionAiService,
    SpeechAiService,
    AvatarAiService,
    DigitalHumanImageService,
    AliLipSyncService,
    QwenVoiceCloneService,
    TranscriptStore,
  ],
  exports: [
    RewriteAiService,
    TranscriptionAiService,
    SpeechAiService,
    AvatarAiService,
    DigitalHumanImageService,
    AliLipSyncService,
    QwenVoiceCloneService,
    TranscriptStore,
  ],
})
export class AiModule {}
