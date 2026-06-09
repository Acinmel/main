import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AliLipSyncService } from './ali-lip-sync.service';

describe('AliLipSyncService', () => {
  it('rejects oversized aliyun videoretalk input before provider submit', async () => {
    const service = new AliLipSyncService(
      new ConfigService({
        LIP_SYNC_PROVIDER: 'aliyun-videoretalk',
        DASHSCOPE_API_KEY: 'test-key',
        ALI_VIDEORETALK_INPUT_MAX_BYTES: '1024',
      }),
    );

    await expect(
      service.submitLipSync({
        video: {
          buffer: Buffer.alloc(2048, 1),
          filename: 'big.mp4',
          mimeType: 'video/mp4',
        },
        audio: {
          buffer: Buffer.alloc(16, 1),
          filename: 'ok.wav',
          mimeType: 'audio/wav',
        },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      service.submitLipSync({
        video: {
          buffer: Buffer.alloc(2048, 1),
          filename: 'big.mp4',
          mimeType: 'video/mp4',
        },
        audio: {
          buffer: Buffer.alloc(16, 1),
          filename: 'ok.wav',
          mimeType: 'audio/wav',
        },
      }),
    ).rejects.toThrow(/input too large/i);
  });
});
