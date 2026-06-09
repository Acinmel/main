import 'reflect-metadata';
import { IS_PUBLIC_KEY } from '../auth/public.decorator';
import { ToolsController } from './tools.controller';

describe('ToolsController preview audio stream', () => {
  it('marks signed preview audio stream as public', () => {
    const isPublic = Reflect.getMetadata(
      IS_PUBLIC_KEY,
      ToolsController.prototype.streamPreviewAudio,
    );

    expect(isPublic).toBe(true);
  });
});
