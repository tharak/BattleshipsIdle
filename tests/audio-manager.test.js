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

    audio.handleEvents([{ type: 'flagshipGunReady' }]);

    expect(audio.tone).toHaveBeenCalledTimes(1);
    vi.runAllTimers();
    expect(audio.tone).toHaveBeenCalledTimes(3);
    expect(audio.tone.mock.calls.map(([tone]) => tone.frequency)).toEqual([360, 540, 760]);
  });

  it('covers battlefield, progression, and alert events with procedural cues', () => {
    vi.useFakeTimers();
    vi.stubGlobal('window', { setTimeout });
    const audio = new AudioManager({ now: () => 1_000 });
    audio.tone = vi.fn();
    audio.noise = vi.fn();

    audio.handleEvents([
      { type: 'runStarted' },
      { type: 'waveStarted', isBoss: false },
      { type: 'projectileFired', faction: 'friendly' },
      { type: 'projectileFired', faction: 'enemy' },
      { type: 'impact', faction: 'friendly' },
      { type: 'shieldImpact' },
      { type: 'damaged', faction: 'friendly' },
      { type: 'destroyed', faction: 'enemy', role: 'raider' },
      { type: 'areaImpact' },
      { type: 'breach' },
      { type: 'formationChanged' },
      { type: 'shopOpened' },
      { type: 'shopClosed' },
      { type: 'upgradePurchased' },
      { type: 'friendlyJoined' },
      { type: 'bossWaveStarted' },
      { type: 'bossBarrierImpact' },
      { type: 'bossExposed' },
      { type: 'bossBarrierRestored' },
      { type: 'waveCleared' },
      { type: 'gameOver' },
    ]);
    vi.runAllTimers();

    expect(audio.tone.mock.calls.length).toBeGreaterThanOrEqual(29);
    expect(audio.noise).toHaveBeenCalledTimes(5);
  });

  it('throttles rapid automatic weapon cues independently by faction', () => {
    const audio = new AudioManager({ now: () => 1_000 });
    audio.tone = vi.fn();

    audio.handleEvents([
      { type: 'projectileFired', faction: 'friendly' },
      { type: 'projectileFired', faction: 'friendly' },
      { type: 'projectileFired', faction: 'enemy' },
      { type: 'projectileFired', faction: 'enemy' },
    ]);

    expect(audio.tone).toHaveBeenCalledTimes(2);
    expect(audio.tone.mock.calls.map(([tone]) => tone.frequency)).toEqual([820, 190]);
  });

  it('layers distinct start, pulse, overheat, and ready cues for the flagship gun', () => {
    vi.useFakeTimers();
    vi.stubGlobal('window', { setTimeout });
    const audio = new AudioManager({ now: () => 1_000 });
    audio.tone = vi.fn();
    audio.noise = vi.fn();

    audio.handleEvents([
      { type: 'flagshipGunStarted' },
      { type: 'flagshipGunPulse', pulseIndex: 1, hitId: 'enemy-1' },
      { type: 'flagshipGunStopped', reason: 'depleted' },
      { type: 'flagshipGunReady' },
    ]);
    vi.runAllTimers();

    expect(audio.tone.mock.calls.length).toBeGreaterThanOrEqual(7);
    expect(audio.noise).toHaveBeenCalledTimes(2);
  });

  it('gives every enabled interface button a quiet pointer cue', () => {
    let pointerHandler;
    const root = {
      addEventListener: vi.fn((eventName, handler) => {
        if (eventName === 'pointerdown') pointerHandler = handler;
      }),
      removeEventListener: vi.fn(),
    };
    const audio = new AudioManager({ now: () => 1_000 });
    audio.tone = vi.fn();
    audio.bindUi(root);

    pointerHandler({ target: { closest: () => ({ disabled: false }) } });

    expect(audio.tone).toHaveBeenCalledWith(expect.objectContaining({ frequency: 720, gain: 0.012 }));
    audio.unbindUi();
    expect(root.removeEventListener).toHaveBeenCalledWith('pointerdown', pointerHandler);
  });
});
