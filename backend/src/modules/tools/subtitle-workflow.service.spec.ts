import { ConfigService } from '@nestjs/config';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { SubtitleWorkflowService } from './subtitle-workflow.service';

function makeService() {
  const ffmpegAudio = {
    probeMediaSummary: jest.fn(),
    clipAudio: jest.fn(),
  };
  const service = new SubtitleWorkflowService(
    new ConfigService({}),
    {} as never,
    {} as never,
    {} as never,
    ffmpegAudio as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { service, ffmpegAudio };
}

describe('SubtitleWorkflowService media preflight', () => {
  it('uses provider-aligned default limits and no pix-fmt blocking by default', () => {
    const { service } = makeService();
    const limits = (
      service as unknown as {
        readLipSyncPreflightLimits: () => {
          maxSourceDurationSeconds: number;
          maxSourceSizeBytes: number;
          maxPreparedDurationSeconds: number;
          maxPreparedSizeBytes: number;
          maxPreparedWidth: number;
          maxPreparedHeight: number;
          allowedPreparedPixFmts: Set<string>;
          maxAudioDurationSeconds: number;
          maxAudioSizeBytes: number;
        };
      }
    ).readLipSyncPreflightLimits();

    expect(limits.maxSourceDurationSeconds).toBe(120);
    expect(limits.maxSourceSizeBytes).toBe(300 * 1024 * 1024);
    expect(limits.maxPreparedDurationSeconds).toBe(120);
    expect(limits.maxPreparedSizeBytes).toBe(300 * 1024 * 1024);
    expect(limits.maxPreparedWidth).toBe(2048);
    expect(limits.maxPreparedHeight).toBe(2048);
    expect(limits.allowedPreparedPixFmts.size).toBe(0);
    expect(limits.maxAudioDurationSeconds).toBe(120);
    expect(limits.maxAudioSizeBytes).toBe(30 * 1024 * 1024);
  });

  it('normalizes audio to wav when container/extension mismatch', async () => {
    const { service, ffmpegAudio } = makeService();
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lip-preflight-'));
    const inputPath = path.join(tmpDir, 'input.mp3');
    await fs.writeFile(inputPath, Buffer.from('demo'));

    ffmpegAudio.probeMediaSummary
      .mockResolvedValueOnce({
        formatName: 'wav',
        durationSeconds: 2.1,
        sizeBytes: 1024,
        bitRate: 256000,
        video: null,
        audio: {
          codecName: 'pcm_s16le',
          sampleRate: 16000,
          channels: 1,
          channelLayout: 'mono',
          bitRate: 256000,
        },
      })
      .mockResolvedValueOnce({
        formatName: 'wav',
        durationSeconds: 2.1,
        sizeBytes: 2048,
        bitRate: 256000,
        video: null,
        audio: {
          codecName: 'pcm_s16le',
          sampleRate: 16000,
          channels: 1,
          channelLayout: 'mono',
          bitRate: 256000,
        },
      });
    ffmpegAudio.clipAudio.mockResolvedValue(undefined);

    try {
      const result = await (
        service as unknown as {
          normalizeLipSyncAudioInput: (params: {
            audioPath: string;
            mimeType: string;
            originalName: string;
            draftDir: string;
          }) => Promise<{
            audioPath: string;
            mimeType: string;
            converted: boolean;
          }>;
        }
      ).normalizeLipSyncAudioInput({
        audioPath: inputPath,
        mimeType: 'application/octet-stream',
        originalName: 'input.mp3',
        draftDir: tmpDir,
      });

      expect(result.converted).toBe(true);
      expect(result.mimeType).toBe('audio/wav');
      expect(path.extname(result.audioPath)).toBe('.wav');
      expect(ffmpegAudio.clipAudio).toHaveBeenCalledTimes(1);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('rejects oversized media before provider submit', () => {
    const { service } = makeService();
    const summary = {
      formatName: 'mov,mp4,m4a,3gp,3g2,mj2',
      durationSeconds: 12,
      sizeBytes: 11 * 1024 * 1024,
      bitRate: 12_000_000,
      video: {
        codecName: 'h264',
        width: 1280,
        height: 720,
        pixFmt: 'yuv420p',
        avgFrameRate: 30,
        colorSpace: 'bt709',
        colorRange: 'tv',
      },
      audio: null,
    };

    expect(() =>
      (
        service as unknown as {
          assertLipSyncMediaThreshold: (
            label: string,
            summaryArg: unknown,
            limits: {
              maxSizeBytes?: number;
            },
          ) => void;
        }
      ).assertLipSyncMediaThreshold('源视频', summary, {
        maxSizeBytes: 5 * 1024 * 1024,
      }),
    ).toThrow(/体积过大/);
  });

  it('does not reject media only because bitrate is high', () => {
    const { service } = makeService();
    const summary = {
      formatName: 'mov,mp4,m4a,3gp,3g2,mj2',
      durationSeconds: 12,
      sizeBytes: 30 * 1024 * 1024,
      bitRate: 30_000_000,
      video: {
        codecName: 'h264',
        width: 1280,
        height: 720,
        pixFmt: 'yuv420p',
        avgFrameRate: 30,
        colorSpace: 'bt709',
        colorRange: 'tv',
      },
      audio: null,
    };

    expect(() =>
      (
        service as unknown as {
          assertLipSyncMediaThreshold: (
            label: string,
            summaryArg: unknown,
            limits: {
              maxDurationSeconds?: number;
              maxSizeBytes?: number;
              maxWidth?: number;
              maxHeight?: number;
            },
          ) => void;
        }
      ).assertLipSyncMediaThreshold('prepared video', summary, {
        maxDurationSeconds: 120,
        maxSizeBytes: 300 * 1024 * 1024,
        maxWidth: 2048,
        maxHeight: 2048,
      }),
    ).not.toThrow();
  });
});
