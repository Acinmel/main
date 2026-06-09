import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { DatabaseService } from '../../database/database.service';
import { VideoProjectsService } from './video-projects.service';

function makeService() {
  const db = {
    queryOne: jest.fn(),
    queryAll: jest.fn(),
    execute: jest.fn().mockResolvedValue(undefined),
  };
  const service = new VideoProjectsService(db as unknown as DatabaseService);
  return { service, db };
}

describe('VideoProjectsService', () => {
  it('creates project owned by current user', async () => {
    const { service, db } = makeService();
    db.queryOne.mockResolvedValueOnce({
      id: 'project_1',
      user_id: 'u1',
      name: '任务A',
      status: 'active',
      archived_at: null,
      created_at: '2026-05-25T00:00:00.000Z',
      updated_at: '2026-05-25T00:00:00.000Z',
    });

    const created = await service.createProject('u1', { name: '任务A' });

    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO video_projects'),
      expect.arrayContaining(['u1', '任务A']),
    );
    expect(created.projectId).toBe('project_1');
    expect(created.archived).toBe(false);
  });

  it('lists projects with pagination and scope filter', async () => {
    const { service, db } = makeService();
    db.queryOne.mockResolvedValueOnce({ c: 2 });
    db.queryAll.mockResolvedValueOnce([
      {
        id: 'project_2',
        user_id: 'u1',
        name: '任务B',
        status: 'active',
        archived_at: null,
        created_at: '2026-05-25T00:00:00.000Z',
        updated_at: '2026-05-25T00:05:00.000Z',
      },
    ]);

    const result = await service.listProjects('u1', {
      scope: 'active',
      limit: 20,
      offset: 0,
    });

    expect(db.queryOne).toHaveBeenCalledWith(
      expect.stringContaining('COUNT(1) AS c'),
      ['u1', 'active'],
    );
    expect(db.queryAll).toHaveBeenCalledWith(
      expect.stringContaining('LIMIT ? OFFSET ?'),
      ['u1', 'active', 20, 0],
    );
    expect(result.total).toBe(2);
    expect(result.items).toHaveLength(1);
    expect(result.hasMore).toBe(true);
  });

  it('renames project and updates timestamp', async () => {
    const { service, db } = makeService();
    db.queryOne
      .mockResolvedValueOnce({
        id: 'project_3',
        user_id: 'u1',
        name: '旧名',
        status: 'active',
        archived_at: null,
        created_at: '2026-05-25T00:00:00.000Z',
        updated_at: '2026-05-25T00:00:00.000Z',
      })
      .mockResolvedValueOnce({
        id: 'project_3',
        user_id: 'u1',
        name: '新名',
        status: 'active',
        archived_at: null,
        created_at: '2026-05-25T00:00:00.000Z',
        updated_at: '2026-05-25T00:10:00.000Z',
      });

    const row = await service.renameProject('u1', 'project_3', {
      name: '新名',
    });

    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE video_projects'),
      expect.arrayContaining(['新名', 'project_3', 'u1']),
    );
    expect(row.name).toBe('新名');
  });

  it('archives/unarchives project by owner', async () => {
    const { service, db } = makeService();
    db.queryOne
      .mockResolvedValueOnce({
        id: 'project_4',
        user_id: 'u1',
        name: '任务C',
        status: 'active',
        archived_at: null,
        created_at: '2026-05-25T00:00:00.000Z',
        updated_at: '2026-05-25T00:00:00.000Z',
      })
      .mockResolvedValueOnce({
        id: 'project_4',
        user_id: 'u1',
        name: '任务C',
        status: 'archived',
        archived_at: '2026-05-25T00:20:00.000Z',
        created_at: '2026-05-25T00:00:00.000Z',
        updated_at: '2026-05-25T00:20:00.000Z',
      });

    const archived = await service.archiveProject('u1', 'project_4', {});

    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining(
        'SET status = ?, archived_at = ?, updated_at = ?',
      ),
      expect.arrayContaining(['archived', 'project_4', 'u1']),
    );
    expect(archived.archived).toBe(true);
  });

  it('rejects empty name and throws not found for cross-user project', async () => {
    const { service, db } = makeService();
    await expect(
      service.renameProject('u1', 'project_5', { name: '   ' }),
    ).rejects.toBeInstanceOf(BadRequestException);

    db.queryOne.mockResolvedValueOnce(null);
    await expect(service.getProject('u1', 'project_5')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
