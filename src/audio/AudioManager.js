const FRIENDLY = 'friendly';

export class AudioManager {
  constructor({ enabled = true, now = () => globalThis.performance?.now?.() ?? Date.now() } = {}) {
    this.enabled = enabled;
    this.context = null;
    this.now = now;
    this.lastPlayed = new Map();
    this.uiRoot = null;
    this.uiPointerHandler = null;
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    if (!this.enabled && this.context?.state === 'running') this.context.suspend();
  }

  ensureContext() {
    if (!this.enabled) return null;
    if (!this.context) {
      const AudioContext = globalThis.window?.AudioContext ?? globalThis.window?.webkitAudioContext;
      if (!AudioContext) return null;
      this.context = new AudioContext();
    }
    if (this.context.state === 'suspended') this.context.resume();
    return this.context;
  }

  tone({ frequency = 220, endFrequency = frequency, duration = 0.12, gain = 0.035, type = 'sine' }) {
    const context = this.ensureContext();
    if (!context) return;
    const startTime = context.currentTime;
    const oscillator = context.createOscillator();
    const volume = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, startTime);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), startTime + duration);
    volume.gain.setValueAtTime(0.0001, startTime);
    volume.gain.exponentialRampToValueAtTime(gain, startTime + Math.min(0.012, duration * 0.25));
    volume.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
    oscillator.connect(volume).connect(context.destination);
    oscillator.start(startTime);
    oscillator.stop(startTime + duration + 0.02);
  }

  noise({ duration = 0.18, gain = 0.025, cutoff = 620 } = {}) {
    const context = this.ensureContext();
    if (!context) return;
    const frameCount = Math.max(1, Math.floor(context.sampleRate * duration));
    const buffer = context.createBuffer(1, frameCount, context.sampleRate);
    const channel = buffer.getChannelData(0);
    for (let index = 0; index < frameCount; index += 1) {
      const envelope = 1 - index / frameCount;
      channel[index] = (Math.random() * 2 - 1) * envelope;
    }

    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const volume = context.createGain();
    const startTime = context.currentTime;
    source.buffer = buffer;
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(cutoff, startTime);
    filter.frequency.exponentialRampToValueAtTime(Math.max(60, cutoff * 0.28), startTime + duration);
    volume.gain.setValueAtTime(gain, startTime);
    volume.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
    source.connect(filter).connect(volume).connect(context.destination);
    source.start(startTime);
    source.stop(startTime + duration + 0.02);
  }

  canPlay(channel, minimumInterval = 0) {
    const time = this.now();
    const previous = this.lastPlayed.get(channel) ?? -Infinity;
    if (time - previous < minimumInterval) return false;
    this.lastPlayed.set(channel, time);
    return true;
  }

  schedule(delay, callback) {
    const scheduler = globalThis.window?.setTimeout ?? globalThis.setTimeout;
    scheduler(callback, delay);
  }

  sequence(tones) {
    for (const { delay = 0, ...tone } of tones) {
      if (delay === 0) this.tone(tone);
      else this.schedule(delay, () => this.tone(tone));
    }
  }

  bindUi(root = globalThis.document) {
    this.unbindUi();
    if (!root?.addEventListener) return;
    this.uiRoot = root;
    this.uiPointerHandler = (event) => {
      const button = event.target?.closest?.('button');
      if (!button || button.disabled || !this.canPlay('ui-button', 32)) return;
      this.tone({ frequency: 720, endFrequency: 510, duration: 0.045, gain: 0.012, type: 'triangle' });
    };
    root.addEventListener('pointerdown', this.uiPointerHandler, { passive: true });
  }

  unbindUi() {
    if (this.uiRoot && this.uiPointerHandler) {
      this.uiRoot.removeEventListener('pointerdown', this.uiPointerHandler);
    }
    this.uiRoot = null;
    this.uiPointerHandler = null;
  }

  handleEvents(events) {
    if (!this.enabled) return;
    for (const event of events) this.handleEvent(event);
  }

  handleEvent(event) {
    switch (event.type) {
      case 'runStarted':
        this.sequence([
          { frequency: 150, endFrequency: 300, duration: 0.24, gain: 0.032, type: 'sawtooth' },
          { delay: 120, frequency: 360, endFrequency: 510, duration: 0.2, gain: 0.028, type: 'triangle' },
        ]);
        break;
      case 'waveStarted':
        if (!event.isBoss) {
          this.sequence([
            { frequency: 210, endFrequency: 290, duration: 0.1, gain: 0.02, type: 'square' },
            { delay: 80, frequency: 290, endFrequency: 390, duration: 0.13, gain: 0.023, type: 'triangle' },
          ]);
        }
        break;
      case 'waveCleared':
        this.sequence([
          { frequency: 330, endFrequency: 390, duration: 0.12, gain: 0.027, type: 'triangle' },
          { delay: 90, frequency: 440, endFrequency: 520, duration: 0.13, gain: 0.029, type: 'triangle' },
          { delay: 180, frequency: 660, endFrequency: 820, duration: 0.2, gain: 0.032, type: 'sine' },
        ]);
        break;
      case 'projectileFired': {
        const friendly = event.faction === FRIENDLY;
        if (!this.canPlay(`fire-${event.faction}`, friendly ? 46 : 72)) break;
        this.tone(friendly
          ? { frequency: 820, endFrequency: 430, duration: 0.052, gain: 0.008, type: 'triangle' }
          : { frequency: 190, endFrequency: 105, duration: 0.075, gain: 0.009, type: 'square' });
        break;
      }
      case 'impact': {
        if (!this.canPlay(`impact-${event.faction}`, event.heavy ? 0 : 48)) break;
        const friendly = event.faction === FRIENDLY;
        this.tone(friendly
          ? { frequency: event.heavy ? 440 : 310, endFrequency: 120, duration: event.heavy ? 0.18 : 0.07, gain: event.heavy ? 0.032 : 0.011, type: 'triangle' }
          : { frequency: 145, endFrequency: 62, duration: 0.1, gain: 0.014, type: 'square' });
        break;
      }
      case 'damaged':
        if (event.faction === FRIENDLY && this.canPlay('friendly-hull-damaged', 170)) {
          this.tone({ frequency: 112, endFrequency: 58, duration: 0.14, gain: 0.018, type: 'sawtooth' });
        }
        break;
      case 'shieldImpact':
        if (this.canPlay('shield-impact', 85)) {
          this.tone({ frequency: 880, endFrequency: 390, duration: 0.11, gain: 0.019, type: 'sine' });
        }
        break;
      case 'destroyed':
        if (this.canPlay(`destroyed-${event.faction}`, 74)) {
          const boss = event.role === 'boss';
          this.tone({ frequency: boss ? 84 : 175, endFrequency: boss ? 34 : 48, duration: boss ? 0.52 : 0.22, gain: boss ? 0.055 : 0.027, type: 'triangle' });
          this.noise({ duration: boss ? 0.48 : 0.18, gain: boss ? 0.055 : 0.02, cutoff: boss ? 420 : 760 });
        }
        break;
      case 'areaImpact':
        if (this.canPlay('area-impact', 140)) {
          this.tone({ frequency: 104, endFrequency: 36, duration: 0.3, gain: 0.038, type: 'sawtooth' });
          this.noise({ duration: 0.26, gain: 0.032, cutoff: 480 });
        }
        break;
      case 'breach':
        this.tone({ frequency: 88, endFrequency: 38, duration: 0.38, gain: 0.048, type: 'sawtooth' });
        this.noise({ duration: 0.34, gain: 0.04, cutoff: 360 });
        this.schedule(170, () => this.tone({ frequency: 240, endFrequency: 140, duration: 0.2, gain: 0.025, type: 'square' }));
        break;
      case 'flagshipGunStarted':
        this.sequence([
          { frequency: 118, endFrequency: 260, duration: 0.16, gain: 0.032, type: 'sawtooth' },
          { delay: 55, frequency: 410, endFrequency: 690, duration: 0.13, gain: 0.024, type: 'triangle' },
        ]);
        break;
      case 'flagshipGunPulse':
        if (this.canPlay('flagship-gun-pulse', 82)) {
          const powerPitch = Math.max(0, (event.damageMultiplier ?? 1) - 0.7) * 110;
          this.tone({
            frequency: (event.pulseIndex % 2 === 0 ? 760 : 690) + powerPitch,
            endFrequency: event.hitId ? 145 : 260,
            duration: 0.1,
            gain: event.hitId ? 0.028 + powerPitch / 22000 : 0.022,
            type: 'square',
          });
          if (event.critical) {
            this.tone({ frequency: 1260, endFrequency: 620, duration: 0.16, gain: 0.034, type: 'triangle' });
            this.noise({ duration: 0.11, gain: 0.014, cutoff: 1480 });
          } else if (event.hitId) {
            this.noise({ duration: 0.075, gain: 0.008, cutoff: 920 });
          }
        }
        break;
      case 'flagshipGunStopped':
        if (event.reason === 'depleted') {
          this.tone({ frequency: 280, endFrequency: 58, duration: 0.32, gain: 0.034, type: 'sawtooth' });
          this.noise({ duration: 0.22, gain: 0.014, cutoff: 440 });
        } else {
          this.tone({ frequency: 310, endFrequency: 170, duration: 0.13, gain: 0.018, type: 'triangle' });
        }
        break;
      case 'flagshipGunRejected':
        this.sequence([
          { frequency: 155, endFrequency: 112, duration: 0.09, gain: 0.018, type: 'square' },
          { delay: 82, frequency: 116, endFrequency: 82, duration: 0.11, gain: 0.016, type: 'square' },
        ]);
        break;
      case 'flagshipGunReady':
        this.sequence([
          { frequency: 360, endFrequency: 480, duration: 0.12, gain: 0.035, type: 'sine' },
          { delay: 90, frequency: 540, endFrequency: 720, duration: 0.14, gain: 0.038, type: 'sine' },
          { delay: 180, frequency: 760, endFrequency: 980, duration: 0.18, gain: 0.042, type: 'triangle' },
        ]);
        break;
      case 'formationChanged':
      case 'formationShipMoved':
      case 'loadoutActivated':
        this.sequence([
          { frequency: 260, endFrequency: 390, duration: 0.12, gain: 0.023, type: 'triangle' },
          { delay: 95, frequency: 390, endFrequency: 560, duration: 0.16, gain: 0.026, type: 'sine' },
        ]);
        break;
      case 'telegraphStarted':
        if (this.canPlay('telegraph-warning', 280)) {
          this.tone({ frequency: event.kind === 'blast' ? 260 : 340, endFrequency: 190, duration: 0.22, gain: 0.024, type: 'square' });
        }
        break;
      case 'telegraphEvaded':
        this.tone({ frequency: 560, endFrequency: 960, duration: 0.2, gain: 0.03, type: 'sine' });
        break;
      case 'tacticalEdgeConsumed':
        this.tone({ frequency: 480, endFrequency: 1240, duration: 0.26, gain: 0.038, type: 'triangle' });
        break;
      case 'shopOpened':
        this.tone({ frequency: 340, endFrequency: 530, duration: 0.13, gain: 0.021, type: 'triangle' });
        break;
      case 'shopClosed':
        this.tone({ frequency: 520, endFrequency: 310, duration: 0.12, gain: 0.019, type: 'triangle' });
        break;
      case 'upgradePurchased':
        this.sequence([
          { frequency: 330, endFrequency: 660, duration: 0.16, gain: 0.035, type: 'sine' },
          { delay: 95, frequency: 660, endFrequency: 920, duration: 0.17, gain: 0.031, type: 'triangle' },
        ]);
        break;
      case 'friendlyJoined':
        this.tone({ frequency: 410, endFrequency: 780, duration: 0.22, gain: 0.028, type: 'sine' });
        break;
      case 'bossWaveStarted':
        this.tone({ frequency: 70, endFrequency: 38, duration: 0.78, gain: 0.058, type: 'sawtooth' });
        this.noise({ duration: 0.5, gain: 0.025, cutoff: 280 });
        break;
      case 'bossBarrierImpact':
        if (this.canPlay('boss-barrier-impact', 95)) {
          this.tone({ frequency: 260, endFrequency: 92, duration: 0.19, gain: 0.026, type: 'square' });
        }
        break;
      case 'bossExposed':
        this.sequence([
          { frequency: 420, endFrequency: 820, duration: 0.18, gain: 0.04, type: 'square' },
          { delay: 100, frequency: 760, endFrequency: 1120, duration: 0.22, gain: 0.033, type: 'triangle' },
        ]);
        break;
      case 'bossBarrierRestored':
        this.sequence([
          { frequency: 330, endFrequency: 150, duration: 0.18, gain: 0.026, type: 'sine' },
          { delay: 110, frequency: 180, endFrequency: 72, duration: 0.22, gain: 0.023, type: 'square' },
        ]);
        break;
      case 'gameOver':
        this.tone({ frequency: 160, endFrequency: 42, duration: 0.82, gain: 0.058, type: 'triangle' });
        this.noise({ duration: 0.56, gain: 0.035, cutoff: 310 });
        break;
      case 'paused':
        this.tone({ frequency: 380, endFrequency: 190, duration: 0.15, gain: 0.018, type: 'triangle' });
        break;
      case 'resumed':
        this.tone({ frequency: 220, endFrequency: 440, duration: 0.15, gain: 0.02, type: 'triangle' });
        break;
      default:
        break;
    }
  }
}
