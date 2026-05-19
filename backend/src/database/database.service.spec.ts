import { ConfigService } from '@nestjs/config';
import type { Pool } from 'mysql2/promise';
import { DatabaseService } from './database.service';

type ColumnShape = {
  dataType: string;
  isNullable: 'YES' | 'NO';
};

describe('DatabaseService MySQL governance migration', () => {
  it('widens subtitle template data URL columns to LONGTEXT', async () => {
    const columns = new Map<string, ColumnShape>([
      [
        'subtitle_template_resources.cover_url',
        { dataType: 'varchar', isNullable: 'YES' },
      ],
      [
        'subtitle_template_resources.preview_url',
        { dataType: 'varchar', isNullable: 'YES' },
      ],
      [
        'subtitle_template_resources.style_json',
        { dataType: 'text', isNullable: 'NO' },
      ],
    ]);
    const executedSql: string[] = [];
    const query = jest.fn(
      (
        sql: string,
        params: unknown[] = [],
      ): Promise<[Record<string, unknown>[]]> => {
        const normalized = sql.replace(/\s+/g, ' ').trim();
        executedSql.push(normalized);
        if (normalized.includes('INFORMATION_SCHEMA.COLUMNS')) {
          const key = `${String(params[0])}.${String(params[1])}`;
          const col = columns.get(key);
          return Promise.resolve([col ? [col] : []]);
        }
        if (normalized.includes('INFORMATION_SCHEMA.STATISTICS')) {
          return Promise.resolve([[{ c: 1 }]]);
        }
        return Promise.resolve([[]]);
      },
    );
    const service = new DatabaseService(new ConfigService());
    (service as unknown as { mysqlPool: Pool }).mysqlPool = {
      query,
    } as unknown as Pool;

    await (
      service as unknown as { ensureGovernanceMysql: () => Promise<void> }
    ).ensureGovernanceMysql();

    expect(executedSql).toEqual(
      expect.arrayContaining([
        'ALTER TABLE subtitle_template_resources MODIFY COLUMN cover_url LONGTEXT NULL',
        'ALTER TABLE subtitle_template_resources MODIFY COLUMN preview_url LONGTEXT NULL',
        `UPDATE subtitle_template_resources SET style_json = '{}' WHERE style_json IS NULL`,
        'ALTER TABLE subtitle_template_resources MODIFY COLUMN style_json LONGTEXT NOT NULL',
      ]),
    );
  });
});
