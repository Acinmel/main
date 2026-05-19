import { ConfigService } from '@nestjs/config';
import type { DatabaseService } from '../../database/database.service';
import { SavedVideoService } from './saved-video.service';

function makeService(opts?: { mysql?: boolean }) {
  const db = {
    queryOne: jest.fn(),
    queryAll: jest.fn(),
    execute: jest.fn().mockResolvedValue(undefined),
  };
  const config = {
    get: jest.fn((key: string) => {
      if (key === 'MYSQL_DATABASE') return opts?.mysql ? 'shuziren' : '';
      return undefined;
    }),
  } as unknown as ConfigService;
  const service = new SavedVideoService(
    db as unknown as DatabaseService,
    config,
  );
  return { service, db };
}

describe('SavedVideoService', () => {
  it('upserts and reads back saved video metadata (sqlite)', async () => {
    const { service, db } = makeService();
    db.queryOne.mockResolvedValueOnce({
      id: 'sv-1',
      user_id: 'u-1',
      file_name: 'a.mp4',
      file_size: 1024,
      mime_type: 'video/mp4',
      source_video_url: 'https://example.com/a',
      created_at: '2026-05-19T00:00:00.000Z',
      updated_at: '2026-05-19T00:00:00.000Z',
    });

    const row = await service.upsertForUser('u-1', {
      fileName: 'a.mp4',
      fileSize: 1024,
      mimeType: 'video/mp4',
      sourceVideoUrl: 'https://example.com/a',
    });

    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('ON CONFLICT(user_id, file_name) DO UPDATE SET'),
      expect.arrayContaining(['u-1', 'a.mp4', 1024]),
    );
    expect(row.fileName).toBe('a.mp4');
    expect(row.userId).toBe('u-1');
  });

  it('uses mysql upsert syntax when MYSQL_DATABASE is configured', async () => {
    const { service, db } = makeService({ mysql: true });
    db.queryOne.mockResolvedValueOnce({
      id: 'sv-2',
      user_id: 'u-2',
      file_name: 'b.mp4',
      file_size: 2048,
      mime_type: 'video/mp4',
      source_video_url: '',
      created_at: '2026-05-19T00:00:00.000Z',
      updated_at: '2026-05-19T00:00:00.000Z',
    });

    await service.upsertForUser('u-2', {
      fileName: 'b.mp4',
      fileSize: 2048,
    });

    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('ON DUPLICATE KEY UPDATE'),
      expect.any(Array),
    );
  });

  it('lists only current user files with max limit guard', async () => {
    const { service, db } = makeService();
    db.queryAll.mockResolvedValueOnce([
      {
        id: 'sv-3',
        user_id: 'u-3',
        file_name: 'c.mp4',
        file_size: 3000,
        mime_type: 'video/mp4',
        source_video_url: '',
        created_at: '2026-05-19T00:00:00.000Z',
        updated_at: '2026-05-19T00:00:00.000Z',
      },
    ]);

    const list = await service.listByUser('u-3', 9999);

    expect(db.queryAll).toHaveBeenCalledWith(
      expect.stringContaining('WHERE user_id = ?'),
      ['u-3', 200],
    );
    expect(list).toHaveLength(1);
    expect(list[0].fileName).toBe('c.mp4');
  });
});
