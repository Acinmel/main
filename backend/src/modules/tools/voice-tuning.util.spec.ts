import { normalizeVoiceTuning } from './voice-tuning.util';

describe('normalizeVoiceTuning', () => {
  it('uses top-level voiceRate before stale nested speechRate', () => {
    expect(
      normalizeVoiceTuning({
        voiceRate: 0.92,
        voiceTuning: { speechRate: 1.13 },
      }).speechRate,
    ).toBe(0.92);
  });

  it('keeps nested speechRate when no top-level voiceRate is supplied', () => {
    expect(
      normalizeVoiceTuning({
        voiceTuning: { speechRate: '1.08' as unknown as number },
      }).speechRate,
    ).toBe(1.08);
  });

  it('accepts speechRate alias before nested speechRate and clamps the supported range', () => {
    expect(
      normalizeVoiceTuning({
        speechRate: 1.777,
        voiceTuning: { speechRate: 1.13 },
      }).speechRate,
    ).toBe(1.5);
    expect(normalizeVoiceTuning({ speechRate: 0.1 }).speechRate).toBe(0.5);
  });

  it('normalizes matching top-level voice controls', () => {
    const tuning = normalizeVoiceTuning({
      voiceLanguage: ' zh-CN ',
      voiceEmotion: '开心',
      voiceEmotionIntensity: '1.2',
      voiceVolume: '0.9',
      voicePitch: '1.1',
    });

    expect(tuning).toEqual({
      language: 'zh-CN',
      emotion: '开心',
      emotionIntensity: 1.2,
      speechRate: null,
      volume: 0.9,
      pitch: 1.1,
    });
  });
});
