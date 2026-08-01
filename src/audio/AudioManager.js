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
        this.tone({ frequency: 95, endFrequency: 34, duration: 0.48, gain: 0.085, type: 'sawtooth' });
        window.setTimeout(() => this.tone({ frequency: 780, endFrequency: 120, duration: 0.3, gain: 0.052, type: 'square' }), 34);
      } else if (event.type === 'volleyReady') {
        this.tone({ frequency: 360, endFrequency: 480, duration: 0.12, gain: 0.035, type: 'sine' });
        window.setTimeout(() => this.tone({ frequency: 540, endFrequency: 720, duration: 0.14, gain: 0.038, type: 'sine' }), 90);
        window.setTimeout(() => this.tone({ frequency: 760, endFrequency: 980, duration: 0.18, gain: 0.042, type: 'triangle' }), 180);
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
