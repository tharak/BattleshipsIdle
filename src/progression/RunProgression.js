export class RunProgression {
  constructor() {
    this.reset();
  }

  reset() {
    this.salvage = 0;
    this.destroyedEnemies = 0;
    this.highestWave = 0;
  }

  recordEnemyDestroyed(reward) {
    this.destroyedEnemies += 1;
    this.salvage += Math.max(0, Math.round(reward));
  }

  recordWaveCleared(wave, reward) {
    this.highestWave = Math.max(this.highestWave, wave);
    this.salvage += Math.max(0, Math.round(reward));
  }

  snapshot() {
    return {
      salvage: this.salvage,
      destroyedEnemies: this.destroyedEnemies,
      highestWave: this.highestWave,
    };
  }
}
