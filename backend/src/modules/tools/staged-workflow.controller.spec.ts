import { StagedWorkflowController } from './staged-workflow.controller';

describe('StagedWorkflowController', () => {
  it('creates subtitle track automatically after upload-complete', async () => {
    const staged = {
      createAudioAssetFromUploadComplete: jest.fn().mockResolvedValue({
        audioAssetId: 'audio_1',
        projectId: 'p1',
        subtitleTrackId: null,
      }),
      createSubtitleTrackForAudioAsset: jest.fn().mockResolvedValue({
        subtitleTrackId: 'track_1',
      }),
    };
    const controller = new StagedWorkflowController(staged as never);
    const req = { userId: 'u1' };

    const result = await controller.createAudioAssetFromUploadComplete(
      req as never,
      { audioUrl: 'https://cdn/audio.wav' } as never,
    );

    expect(staged.createAudioAssetFromUploadComplete).toHaveBeenCalled();
    expect(staged.createSubtitleTrackForAudioAsset).toHaveBeenCalledWith(
      'u1',
      'audio_1',
      { projectId: 'p1' },
    );
    expect(result).toEqual({
      audioAssetId: 'audio_1',
      projectId: 'p1',
      subtitleTrackId: 'track_1',
    });
  });

  it('passes idempotency key from request header for tts generation', async () => {
    const staged = {
      createAudioAssetFromTts: jest.fn().mockResolvedValue({
        audioAssetId: 'audio_2',
        projectId: 'p2',
        subtitleTrackId: 'track_2',
      }),
    };
    const controller = new StagedWorkflowController(staged as never);
    const req = {
      userId: 'u1',
      get: jest.fn().mockImplementation((name: string) => {
        return name === 'idempotency-key' ? 'idem-tts-001' : undefined;
      }),
    };

    await controller.createAudioAssetFromTts(
      req as never,
      {
        projectId: 'project_1',
        text: 'hello',
      } as never,
    );

    expect(staged.createAudioAssetFromTts).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({
        text: 'hello',
        projectId: 'project_1',
        idempotencyKey: 'idem-tts-001',
      }),
    );
  });

  it('rejects tts generation when projectId is missing', async () => {
    const staged = {
      createAudioAssetFromTts: jest.fn(),
    };
    const controller = new StagedWorkflowController(staged as never);
    const req = {
      userId: 'u1',
      get: jest.fn().mockReturnValue(undefined),
    };

    await expect(
      controller.createAudioAssetFromTts(
        req as never,
        {
          text: 'hello',
        } as never,
      ),
    ).rejects.toThrow(/projectId is required/);
    expect(staged.createAudioAssetFromTts).not.toHaveBeenCalled();
  });

  it('rejects subtitle-track creation with legacy studio-current projectId', async () => {
    const staged = {
      createSubtitleTrackForAudioAsset: jest.fn(),
    };
    const controller = new StagedWorkflowController(staged as never);
    const req = { userId: 'u1' };

    expect(() =>
      controller.createSubtitleTrack(req as never, 'audio_3', {
        projectId: 'studio-current',
        scriptSegments: ['a'],
      } as never),
    ).toThrow(/studio-current is not allowed/);
    expect(staged.createSubtitleTrackForAudioAsset).not.toHaveBeenCalled();
  });

  it('passes projectId + script payload when creating subtitle track', async () => {
    const staged = {
      createSubtitleTrackForAudioAsset: jest.fn().mockResolvedValue({
        subtitleTrackId: 'track_3',
      }),
    };
    const controller = new StagedWorkflowController(staged as never);
    const req = { userId: 'u1' };

    await controller.createSubtitleTrack(req as never, 'audio_3', {
      projectId: 'project_1',
      scriptText: '第一句。第二句。',
      scriptSegments: ['第一句。', '第二句。'],
    } as never);

    expect(staged.createSubtitleTrackForAudioAsset).toHaveBeenCalledWith(
      'u1',
      'audio_3',
      {
        projectId: 'project_1',
        scriptText: '第一句。第二句。',
        scriptSegments: ['第一句。', '第二句。'],
        requireScriptSegments: true,
      },
    );
  });
});
