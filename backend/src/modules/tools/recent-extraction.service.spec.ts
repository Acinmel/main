import { ConfigService } from '@nestjs/config';
import type { DatabaseService } from '../../database/database.service';
import {
  RecentExtractionService,
  type UpsertRecentExtractionInput,
} from './recent-extraction.service';

function makeService(opts?: { mysql?: boolean }) {
  const db = {
    queryAll: jest.fn(),
    execute: jest.fn().mockResolvedValue(undefined),
  };
  const config = {
    get: jest.fn((key: string) => {
      if (key === 'MYSQL_DATABASE') return opts?.mysql ? 'shuziren' : '';
      return undefined;
    }),
  } as unknown as ConfigService;
  const service = new RecentExtractionService(
    db as unknown as DatabaseService,
    config,
  );
  return { service, db };
}

describe('RecentExtractionService', () => {
  it('lists only the requested user records with capped limit', async () => {
    const { service, db } = makeService();
    db.queryAll.mockResolvedValueOnce([
      {
        id: 'r1',
        source_url: 'https://example.com/a',
        platform: '抖音',
        title: 't1',
        summary: 's1',
        cover_url: '',
        video_url: '',
        extracted_at: '2026-05-18T10:00:00.000Z',
        created_at: '2026-05-18T10:00:00.000Z',
        updated_at: '2026-05-18T10:00:00.000Z',
      },
    ]);

    const rows = await service.listByUser('u-1', 99);

    expect(db.queryAll).toHaveBeenCalledWith(
      expect.stringContaining('LIMIT ?'),
      ['u-1', 20],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].sourceUrl).toBe('https://example.com/a');
  });

  it('upserts by user + sourceUrl and reads back the saved row (sqlite)', async () => {
    const { service, db } = makeService({ mysql: false });
    const input: UpsertRecentExtractionInput = {
      sourceUrl: 'https://v.douyin.com/abc',
      platform: '抖音',
      title: '标题',
      summary: '摘要',
    };
    db.queryAll.mockResolvedValueOnce([
      {
        id: 'r2',
        source_url: input.sourceUrl,
        platform: input.platform,
        title: input.title,
        summary: input.summary,
        cover_url: '',
        video_url: '',
        extracted_at: '2026-05-18T10:00:00.000Z',
        created_at: '2026-05-18T10:00:00.000Z',
        updated_at: '2026-05-18T10:00:00.000Z',
      },
    ]);

    const row = await service.upsertForUser('u-2', input);

    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('ON CONFLICT(user_id, source_url) DO UPDATE SET'),
      expect.arrayContaining(['u-2', input.sourceUrl]),
    );
    expect(row.sourceUrl).toBe(input.sourceUrl);
    expect(row.title).toBe(input.title);
  });

  it('uses mysql upsert syntax when MYSQL_DATABASE is set', async () => {
    const { service, db } = makeService({ mysql: true });
    db.queryAll.mockResolvedValueOnce([
      {
        id: 'r3',
        source_url: 'https://example.com',
        platform: '视频',
        title: 'title',
        summary: '',
        cover_url: '',
        video_url: '',
        extracted_at: '2026-05-18T10:00:00.000Z',
        created_at: '2026-05-18T10:00:00.000Z',
        updated_at: '2026-05-18T10:00:00.000Z',
      },
    ]);

    await service.upsertForUser('u-3', { sourceUrl: 'https://example.com' });

    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('ON DUPLICATE KEY UPDATE'),
      expect.any(Array),
    );
  });
});
