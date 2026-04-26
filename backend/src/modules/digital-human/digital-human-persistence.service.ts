import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs/promises';
import * as path from 'path';
import { DatabaseService } from '../../database/database.service';

export interface DigitalHumanTemplateRow {
  user_id: string;
  style_id: string;
  output_relative_path: string;
  selfie_relative_path: string;
  created_at: string;
  updated_at: string;
}

@Injectable()
export class DigitalHumanPersistenceService {
  private readonly storageRoot: string;

  constructor(
    private readonly config: ConfigService,
    private readonly databaseService: DatabaseService,
  ) {
    this.storageRoot =
      this.config.get<string>('DIGITAL_HUMAN_STORAGE_DIR')?.trim() ||
      path.join(process.cwd(), 'data', 'digital-humans');
  }

  getStorageRoot(): string {
    return this.storageRoot;
  }

  async findByUserId(userId: string): Promise<DigitalHumanTemplateRow | null> {
    return this.databaseService.queryOne<DigitalHumanTemplateRow>(
      `SELECT user_id, style_id, output_relative_path, selfie_relative_path, created_at, updated_at
       FROM digital_human_templates WHERE user_id = ?`,
      [userId],
    );
  }

  /**
   * 每用户仅一条：写入新文件后 upsert；先删旧文件再落库。
   */
  async saveOrReplace(
    userId: string,
    payload: {
      styleId: string;
      outputBuffer: Buffer;
      outputExt: '.png' | '.jpg';
      selfieBuffer: Buffer;
      selfieMime: string;
    },
  ): Promise<{ outputRelativePath: string }> {
    const dir = this.sanitizeUserId(userId);
    const userDirAbs = path.join(this.storageRoot, dir);
    await fs.mkdir(userDirAbs, { recursive: true });

    const old = await this.findByUserId(userId);
    if (old) {
      await this.unlinkQuiet(path.join(this.storageRoot, old.output_relative_path));
      await this.unlinkQuiet(path.join(this.storageRoot, old.selfie_relative_path));
    }

    const selfieExt: '.png' | '.jpg' = payload.selfieMime.includes('png') ? '.png' : '.jpg';
    const outRel = `${dir}/output${payload.outputExt}`.replace(/\\/g, '/');
    const selfRel = `${dir}/selfie${selfieExt}`.replace(/\\/g, '/');

    await fs.writeFile(path.join(this.storageRoot, outRel), payload.outputBuffer);
    await fs.writeFile(path.join(this.storageRoot, selfRel), payload.selfieBuffer);

    const now = new Date().toISOString();
    const existing = await this.databaseService.queryOne<{ created_at: string }>(
      'SELECT created_at FROM digital_human_templates WHERE user_id = ?',
      [userId],
    );

    if (existing) {
      await this.databaseService.execute(
        `UPDATE digital_human_templates
         SET style_id = ?, output_relative_path = ?, selfie_relative_path = ?, updated_at = ?
         WHERE user_id = ?`,
        [payload.styleId, outRel, selfRel, now, userId],
      );
    } else {
      await this.databaseService.execute(
        `INSERT INTO digital_human_templates
         (user_id, style_id, output_relative_path, selfie_relative_path, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [userId, payload.styleId, outRel, selfRel, now, now],
      );
    }

    return { outputRelativePath: outRel };
  }

  absolutePathForOutput(row: DigitalHumanTemplateRow): string {
    return path.join(this.storageRoot, row.output_relative_path);
  }

  /**
   * 删除该用户的数字人记录与磁盘文件；无记录时返回 false。
   */
  async deleteByUserId(userId: string): Promise<boolean> {
    const row = await this.findByUserId(userId);
    if (!row) {
      return false;
    }
    await this.unlinkQuiet(path.join(this.storageRoot, row.output_relative_path));
    await this.unlinkQuiet(path.join(this.storageRoot, row.selfie_relative_path));
    await this.databaseService.execute(
      'DELETE FROM digital_human_templates WHERE user_id = ?',
      [userId],
    );
    return true;
  }

  private sanitizeUserId(userId: string): string {
    const s = userId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
    return s.length > 0 ? s : 'anonymous';
  }

  private async unlinkQuiet(abs: string): Promise<void> {
    try {
      await fs.unlink(abs);
    } catch {
      /* noop */
    }
  }
}
