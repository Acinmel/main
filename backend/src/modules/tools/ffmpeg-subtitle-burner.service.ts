import { Injectable } from '@nestjs/common';
import {
  FfmpegAudioService,
  type TimedOverlayAsset,
  type TranscribeMediaInput,
} from '../../integrations/media/ffmpeg-audio.service';

@Injectable()
export class FfmpegSubtitleBurnerService {
  constructor(private readonly ffmpegAudio: FfmpegAudioService) {}

  async muxVideoAndAudio(params: {
    video: { buffer: Buffer; originalname: string };
    audio: { buffer: Buffer; originalname?: string };
  }): Promise<TranscribeMediaInput> {
    return this.ffmpegAudio.replaceVideoAudio(params);
  }

  async burnAss(params: {
    inputVideoPath: string;
    subtitleAssPath: string;
    outputVideoPath: string;
  }): Promise<void> {
    await this.ffmpegAudio.burnAssSubtitles({
      inputVideoPath: params.inputVideoPath,
      subtitleAssPath: params.subtitleAssPath,
      outputVideoPath: params.outputVideoPath,
    });
  }

  async normalizeVideoForRenderMode(params: {
    inputVideoPath: string;
    outputVideoPath: string;
    renderMode?: '1080x1920' | 'adaptive' | 'preserveSourceAspect';
  }): Promise<void> {
    await this.ffmpegAudio.normalizeVideoForRenderMode({
      inputVideoPath: params.inputVideoPath,
      outputVideoPath: params.outputVideoPath,
      renderMode: params.renderMode,
    });
  }

  async overlayTimedAssets(params: {
    inputVideoPath: string;
    outputVideoPath: string;
    overlays: TimedOverlayAsset[];
  }): Promise<void> {
    await this.ffmpegAudio.overlayTimedVideoAssets({
      inputVideoPath: params.inputVideoPath,
      outputVideoPath: params.outputVideoPath,
      overlays: params.overlays,
    });
  }

  async probeDurationSeconds(videoPath: string): Promise<number | null> {
    return this.ffmpegAudio.probeFileDurationSeconds(videoPath);
  }
}
