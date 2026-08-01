import { afterEach, describe, expect, it, vi } from 'vitest';
import { AudioManager } from '../src/audio/AudioManager.js';

describe('AudioManager', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('plays a distinct three-note cue when the flagship finishes charging', () => {
    vi.useFakeTimers();
    vi.stubGlobal('window', { setTimeout });
    const audio = new AudioManager();
    audio.tone = vi.fn();

    audio.handleEvents([{ type: 'volleyReady' }]);

    expect(audio.tone).toHaveBeenCalledTimes(1);
    vi.runAllTimers();
    expect(audio.tone).toHaveBeenCalledTimes(3);
    expect(audio.tone.mock.calls.map(([tone]) => tone.frequency)).toEqual([360, 540, 760]);
  });
});
