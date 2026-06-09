import { ConfigService } from '@nestjs/config';
import { FfmpegAudioService } from './ffmpeg-audio.service';

type FfmpegAudioServiceInternals = {
  execMediaTool: (
    file: string,
    args: string[],
    options: { timeout?: number; maxBuffer?: number; windowsHide?: boolean },
  ) => Promise<{ stdout: string | Buffer; stderr: string | Buffer }>;
};

type ExecCall = [
  string,
  string[],
  { timeout?: number; maxBuffer?: number; windowsHide?: boolean },
];

function pickCallsByTool(calls: ExecCall[], toolName: 'ffmpeg' | 'ffprobe') {
  const needle = `${toolName}.exe`;
  return calls.filter(([filePath]) => filePath.toLowerCase().endsWith(needle));
}

describe('FfmpegAudioService', () => {
  it('buildPreviewMp4FromTransparentWebm passes duration boundary and shortest flag', async () => {
    const service = new FfmpegAudioService(
      new ConfigService({ FFMPEG_TIMEOUT_MS: '120000' }),
    );
    const internals = service as unknown as FfmpegAudioServiceInternals;
    const execSpy = jest
      .spyOn(internals, 'execMediaTool')
      .mockResolvedValue({ stdout: '', stderr: '' });

    await service.buildPreviewMp4FromTransparentWebm({
      inputWebmPath: 'input.webm',
      outputMp4Path: 'output.mp4',
      durationSeconds: 1.2,
      width: 1080,
      height: 1920,
    });

    expect(execSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining(['-t', '1.2', '-shortest']),
      expect.objectContaining({ windowsHide: true }),
    );
  });

  it('always keeps shortest flag for preview mp4 even without duration', async () => {
    const service = new FfmpegAudioService(
      new ConfigService({ FFMPEG_TIMEOUT_MS: '120000' }),
    );
    const internals = service as unknown as FfmpegAudioServiceInternals;
    const execSpy = jest
      .spyOn(internals, 'execMediaTool')
      .mockResolvedValue({ stdout: '', stderr: '' });

    await service.buildPreviewMp4FromTransparentWebm({
      inputWebmPath: 'input.webm',
      outputMp4Path: 'output.mp4',
    });

    const calls = execSpy.mock.calls as Array<
      [
        string,
        string[],
        { timeout?: number; maxBuffer?: number; windowsHide?: boolean },
      ]
    >;
    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toContain('-shortest');
    expect(calls[0][1]).not.toContain('-t');
  });

  it('prepareVideoForAliLipSync keeps adaptive scale behavior when renderMode=adaptive', async () => {
    const service = new FfmpegAudioService(
      new ConfigService({ FFMPEG_TIMEOUT_MS: '120000' }),
    );
    const internals = service as unknown as FfmpegAudioServiceInternals;
    const execSpy = jest
      .spyOn(internals, 'execMediaTool')
      .mockImplementation(async (_file, args) => {
        if (args.includes('-show_entries')) {
          return {
            stdout: JSON.stringify({
              streams: [
                {
                  pix_fmt: 'yuvj420p',
                  color_range: 'pc',
                  color_space: 'bt709',
                  color_transfer: 'bt709',
                  color_primaries: 'bt709',
                },
              ],
            }),
            stderr: '',
          };
        }
        return { stdout: '', stderr: '' };
      });

    await service.prepareVideoForAliLipSync({
      inputVideoPath: 'input.mp4',
      outputVideoPath: 'output.mp4',
      clipSeconds: 5,
      renderMode: 'adaptive',
    });

    const calls = execSpy.mock.calls as Array<
      [
        string,
        string[],
        { timeout?: number; maxBuffer?: number; windowsHide?: boolean },
      ]
    >;
    expect(calls).toHaveLength(2);
    const ffmpegArgs = calls[1][1];
    expect(ffmpegArgs).toContain(
      "scale='trunc(iw/2)*2':'trunc(ih/2)*2':flags=lanczos,setsar=1",
    );
    expect(ffmpegArgs.join(' ')).not.toContain('scale=w=2048:h=2048');
    expect(ffmpegArgs).toEqual(
      expect.arrayContaining([
        '-map_metadata',
        '0',
        '-pix_fmt',
        'yuvj420p',
        '-color_range',
        'pc',
        '-colorspace',
        'bt709',
        '-color_trc',
        'bt709',
        '-color_primaries',
        'bt709',
      ]),
    );
  });

  it('burnAssSubtitles keeps metadata mapping and uses quality profile', async () => {
    const service = new FfmpegAudioService(
      new ConfigService({ FFMPEG_TIMEOUT_MS: '120000' }),
    );
    const internals = service as unknown as FfmpegAudioServiceInternals;
    const execSpy = jest
      .spyOn(internals, 'execMediaTool')
      .mockImplementation(async (_file, args) => {
        if (args.includes('-show_entries')) {
          return {
            stdout: JSON.stringify({
              streams: [{ pix_fmt: 'yuv420p' }],
            }),
            stderr: '',
          };
        }
        return { stdout: '', stderr: '' };
      });

    await service.burnAssSubtitles({
      inputVideoPath: 'input.mp4',
      subtitleAssPath: 'subtitle.ass',
      outputVideoPath: 'output.mp4',
      clipSeconds: 3,
    });

    const calls = execSpy.mock.calls as Array<
      [
        string,
        string[],
        { timeout?: number; maxBuffer?: number; windowsHide?: boolean },
      ]
    >;
    expect(calls).toHaveLength(2);
    const ffmpegArgs = calls[1][1];
    expect(ffmpegArgs).toEqual(
      expect.arrayContaining([
        '-map_metadata',
        '0',
        '-crf',
        '18',
        '-pix_fmt',
        'yuv420p',
      ]),
    );
  });

  it('normalizeVideoForRenderMode keeps audio stream and applies 9:16 pad strategy', async () => {
    const service = new FfmpegAudioService(
      new ConfigService({ FFMPEG_TIMEOUT_MS: '120000' }),
    );
    const internals = service as unknown as FfmpegAudioServiceInternals;
    const execSpy = jest
      .spyOn(internals, 'execMediaTool')
      .mockImplementation(async (_file, args) => {
        if (args.includes('-show_entries')) {
          return {
            stdout: JSON.stringify({
              streams: [{ pix_fmt: 'yuv420p' }],
            }),
            stderr: '',
          };
        }
        return { stdout: '', stderr: '' };
      });

    await service.normalizeVideoForRenderMode({
      inputVideoPath: 'input.mp4',
      outputVideoPath: 'output.mp4',
      renderMode: '1080x1920',
    });

    const calls = execSpy.mock.calls as Array<
      [
        string,
        string[],
        { timeout?: number; maxBuffer?: number; windowsHide?: boolean },
      ]
    >;
    expect(calls).toHaveLength(2);
    const ffmpegArgs = calls[1][1];
    expect(ffmpegArgs).toContain(
      'scale=1080:1920:force_original_aspect_ratio=decrease:flags=lanczos,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black,setsar=1',
    );
    expect(ffmpegArgs).toEqual(
      expect.arrayContaining([
        '-map_metadata',
        '0',
        '-c:a',
        'copy',
        '-movflags',
        '+faststart',
      ]),
    );
  });

  it('prepareVideoForAliLipSync preserves source geometry when renderMode=preserveSourceAspect', async () => {
    const service = new FfmpegAudioService(
      new ConfigService({ FFMPEG_TIMEOUT_MS: '120000' }),
    );
    const internals = service as unknown as FfmpegAudioServiceInternals;
    const execSpy = jest
      .spyOn(internals, 'execMediaTool')
      .mockImplementation(async (_file, args) => {
        if (args.includes('-show_entries')) {
          return {
            stdout: JSON.stringify({
              streams: [{ pix_fmt: 'yuv420p' }],
            }),
            stderr: '',
          };
        }
        return { stdout: '', stderr: '' };
      });

    await service.prepareVideoForAliLipSync({
      inputVideoPath: 'input.mp4',
      outputVideoPath: 'output.mp4',
      renderMode: 'preserveSourceAspect',
    });

    const calls = execSpy.mock.calls as ExecCall[];
    const ffprobeCalls = pickCallsByTool(calls, 'ffprobe');
    const ffmpegCalls = pickCallsByTool(calls, 'ffmpeg');
    expect(ffmpegCalls).toHaveLength(1);
    expect(
      ffprobeCalls.some(([, args]) =>
        args.join(' ').includes('format=format_name,duration'),
      ),
    ).toBe(true);
    const ffmpegArgs = ffmpegCalls[0][1];
    expect(ffmpegArgs).not.toContain('-vf');
    expect(ffmpegArgs.join(' ')).not.toContain('scale=');
    expect(ffmpegArgs).toEqual(
      expect.arrayContaining(['-map_metadata', '0', '-c:v', 'libx264']),
    );
  });

  it('prepareVideoForAliLipSync defaults to preserveSourceAspect when renderMode is missing', async () => {
    const service = new FfmpegAudioService(
      new ConfigService({ FFMPEG_TIMEOUT_MS: '120000' }),
    );
    const internals = service as unknown as FfmpegAudioServiceInternals;
    const execSpy = jest
      .spyOn(internals, 'execMediaTool')
      .mockImplementation(async (_file, args) => {
        if (args.includes('-show_entries')) {
          return {
            stdout: JSON.stringify({
              streams: [{ pix_fmt: 'yuv420p' }],
            }),
            stderr: '',
          };
        }
        return { stdout: '', stderr: '' };
      });

    await service.prepareVideoForAliLipSync({
      inputVideoPath: 'input.mp4',
      outputVideoPath: 'output.mp4',
    });

    const calls = execSpy.mock.calls as ExecCall[];
    const ffprobeCalls = pickCallsByTool(calls, 'ffprobe');
    const ffmpegCalls = pickCallsByTool(calls, 'ffmpeg');
    expect(ffmpegCalls).toHaveLength(1);
    expect(
      ffprobeCalls.some(([, args]) =>
        args.join(' ').includes('format=format_name,duration'),
      ),
    ).toBe(true);
    const ffmpegArgs = ffmpegCalls[0][1];
    expect(ffmpegArgs).not.toContain('-vf');
    expect(ffmpegArgs.join(' ')).not.toContain('scale=');
  });

  it('normalizeVideoForRenderMode preserves source geometry when renderMode=preserveSourceAspect', async () => {
    const service = new FfmpegAudioService(
      new ConfigService({ FFMPEG_TIMEOUT_MS: '120000' }),
    );
    const internals = service as unknown as FfmpegAudioServiceInternals;
    const execSpy = jest
      .spyOn(internals, 'execMediaTool')
      .mockImplementation(async (_file, args) => {
        if (args.includes('-show_entries')) {
          return {
            stdout: JSON.stringify({
              streams: [{ pix_fmt: 'yuv420p' }],
            }),
            stderr: '',
          };
        }
        return { stdout: '', stderr: '' };
      });

    await service.normalizeVideoForRenderMode({
      inputVideoPath: 'input.mp4',
      outputVideoPath: 'output.mp4',
      renderMode: 'preserveSourceAspect',
    });

    const calls = execSpy.mock.calls as ExecCall[];
    const ffprobeCalls = pickCallsByTool(calls, 'ffprobe');
    const ffmpegCalls = pickCallsByTool(calls, 'ffmpeg');
    expect(ffmpegCalls).toHaveLength(1);
    expect(
      ffprobeCalls.some(([, args]) =>
        args.join(' ').includes('format=format_name,duration'),
      ),
    ).toBe(true);
    const ffmpegArgs = ffmpegCalls[0][1];
    expect(ffmpegArgs).not.toContain('-vf');
    expect(ffmpegArgs.join(' ')).not.toContain('scale=');
    expect(ffmpegArgs).toEqual(
      expect.arrayContaining(['-c:a', 'copy', '-map_metadata', '0']),
    );
  });
});
