import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AvatarAiService } from '../../integrations/ai/avatar-ai.service';
import type { RewriteAiService } from '../../integrations/ai/rewrite-ai.service';
import type { SpeechAiService } from '../../integrations/ai/speech-ai.service';
import type { TranscriptionAiService } from '../../integrations/ai/transcription-ai.service';
import type { DigitalHumanPersistenceService } from '../digital-human/digital-human-persistence.service';
import type { ResourcesService } from '../resources/resources.service';
import type { UserWorksPersistenceService } from '../works/user-works-persistence.service';
import { TasksService } from './tasks.service';

function makeService() {
  const transcriptionAi = {
    transcribe: jest.fn(),
  };
  const rewriteAi = {
    suggest: jest.fn(),
  };
  const speechAi = {
    synthesizeWithPlaceholder: jest.fn(),
  };
  const avatarAi = {
    driveWithPlaceholder: jest.fn(),
  };
  const userWorks = {
    upsertFromTask: jest.fn().mockResolvedValue(undefined),
    findTaskForUser: jest.fn().mockResolvedValue(null),
    findTaskById: jest.fn().mockResolvedValue(null),
    listSummaries: jest.fn().mockResolvedValue([]),
  };
  const digitalHumanPersistence = {
    findByUserId: jest.fn().mockResolvedValue(null),
  };
  const resources = {
    getVoice: jest.fn(),
  };
  const config = {
    get: jest.fn(),
  } as unknown as ConfigService;

  const service = new TasksService(
    transcriptionAi as unknown as TranscriptionAiService,
    rewriteAi as unknown as RewriteAiService,
    speechAi as unknown as SpeechAiService,
    avatarAi as unknown as AvatarAiService,
    userWorks as unknown as UserWorksPersistenceService,
    digitalHumanPersistence as unknown as DigitalHumanPersistenceService,
    resources as unknown as ResourcesService,
    config,
  );

  return {
    service,
    speechAi,
    resources,
  };
}

async function prepareRewritingTask(service: TasksService, userId = 'user-1') {
  const task = await service.createTask(
    userId,
    'https://www.douyin.com/video/123456',
    'seed transcript content for rendering test',
  );
  const row = (
    service as unknown as { tasks: Map<string, Record<string, unknown>> }
  ).tasks.get(task.id);
  if (!row) throw new Error('task cache missing');
  row.status = 'rewriting';
  row.rewrite = {
    text: 'rewrite content for render submit validation test case',
    style: 'knowledge',
  };
  row.renderStarted = false;
  return task.id;
}

describe('TasksService voiceStyleId guard (BE-026)', () => {
  it('rejects built-in neutral_female in submitRender', async () => {
    const { service, resources } = makeService();
    const taskId = await prepareRewritingTask(service);

    await expect(
      service.submitRender('user-1', taskId, {
        mode: 'virtual_bg',
        aspect: '9:16',
        voiceStyleId: 'neutral_female',
        subtitleStyleId: 'subtitle-1',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(resources.getVoice).not.toHaveBeenCalled();
  });

  it('rejects non-owned voiceStyleId in submitRender', async () => {
    const { service, resources } = makeService();
    const taskId = await prepareRewritingTask(service);
    resources.getVoice.mockResolvedValue({
      owner: 'recommended',
      canUseForRender: true,
      renderUnavailableReason: null,
    });

    await expect(
      service.submitRender('user-1', taskId, {
        mode: 'virtual_bg',
        aspect: '9:16',
        voiceStyleId: 'voice-shared-1',
        subtitleStyleId: 'subtitle-1',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('fails voice stage when renderConfig misses voiceStyleId instead of fallback', async () => {
    const { service, speechAi } = makeService();
    const taskId = await prepareRewritingTask(service);
    const row = (
      service as unknown as { tasks: Map<string, Record<string, unknown>> }
    ).tasks.get(taskId);
    if (!row) throw new Error('task cache missing');
    row.status = 'voice_generating';
    row.renderConfig = {
      mode: 'virtual_bg',
      aspect: '9:16',
      subtitleStyleId: 'subtitle-1',
    };

    await (
      service as unknown as { advanceVoiceAsync: (id: string) => Promise<void> }
    ).advanceVoiceAsync(taskId);

    expect(speechAi.synthesizeWithPlaceholder).not.toHaveBeenCalled();
    expect(row.status).toBe('failed');
    expect(String(row.failReason || '')).toContain('voiceStyleId');
  });
});
