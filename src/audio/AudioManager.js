export class AudioManager {
  constructor({ enabled = true } = {}) {
    this.enabled = enabled;
    this.context = null;
    this.lastImpactAt = 0;
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    if (!this.enabled && this.context?.state === 'running') this.context.suspend();
  }

  ensureContext() {
    if (!this.enabled) return null;
    if (!this.context) {
      const AudioContext = window.AudioContext ?? window.webkitAudioContext;
      if (!AudioContext) return null;
      this.context = new AudioContext();
    }
    if (this.context.state === 'suspended') this.context.resume();
    return this.context;
  }

  tone({ frequency = 220, endFrequency = frequency, duration = 0.12, gain = 0.035, type = 'sine' }) {
    const context = this.ensureContext();
    if (!context) return;
    const now = context.currentTime;
    const oscillator = context.createOscillator();
    const volume = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, now);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), now + duration);
    volume.gain.setValueAtTime(0.0001, now);
    volume.gain.exponentialRampToValueAtTime(gain, now + 0.012);
    volume.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(volume).connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);
  }

  handleEvents(events) {
    if (!this.enabled) return;
    for (const event of events) {
      if (event.type === 'volleyFired') {
        this.tone({ frequency: 130, endFrequency: 42, duration: 0.38, gain: 0.07, type: 'sawtooth' });
        window.setTimeout(() => this.tone({ frequency: 560, endFrequency: 210, duration: 0.22, gain: 0.035 }), 45);
      } else if (event.type === 'destroyed') {
        const now = performance.now();
        if (now - this.lastImpactAt > 75) {
          this.lastImpactAt = now;
          this.tone({ frequency: event.role === 'boss' ? 90 : 170, endFrequency: 48, duration: 0.2, gain: 0.025, type: 'triangle' });
        }
      } else if (event.type === 'bossWaveStarted') {
        this.tone({ frequency: 70, endFrequency: 46, duration: 0.75, gain: 0.055, type: 'sawtooth' });
      } else if (event.type === 'bossExposed') {
        this.tone({ frequency: 420, endFrequency: 820, duration: 0.18, gain: 0.04, type: 'square' });
      } else if (event.type === 'upgradePurchased') {
        this.tone({ frequency: 330, endFrequency: 660, duration: 0.16, gain: 0.035 });
      } else if (event.type === 'gameOver') {
        this.tone({ frequency: 160, endFrequency: 42, duration: 0.8, gain: 0.055, type: 'triangle' });
      }
    }
  }
}
