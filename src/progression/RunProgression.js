import { UpgradeSystem } from './UpgradeSystem.js';

export class RunProgression {
  constructor({ state = {}, onChange = () => {} } = {}) {
    this.currency = Math.max(0, Number(state.currency || 0));
    this.lifetimeHighestWave = Math.max(0, Number(state.highestWave || 0));
    this.totalDestroyed = Math.max(0, Number(state.totalDestroyed || 0));
    this.upgrades = new UpgradeSystem(state.upgrades);
    this.onChange = onChange;
    this.resetRun();
  }

  resetRun() {
    this.runSalvage = 0;
    this.destroyedEnemies = 0;
  }

  recordEnemyDestroyed(reward) {
    const adjustedReward = Math.max(0, Math.round(reward * this.upgrades.resourceMultiplier));
    this.destroyedEnemies += 1;
    this.totalDestroyed += 1;
    this.runSalvage += adjustedReward;
    this.currency += adjustedReward;
    this.onChange();
    return adjustedReward;
  }

  recordWaveCleared(wave, reward) {
    const adjustedReward = Math.max(0, Math.round(reward * this.upgrades.resourceMultiplier));
    this.lifetimeHighestWave = Math.max(this.lifetimeHighestWave, wave);
    this.runSalvage += adjustedReward;
    this.currency += adjustedReward;
    this.onChange();
    return adjustedReward;
  }

  purchaseUpgrade(id) {
    const result = this.upgrades.purchase(id, this.currency);
    if (!result.purchased) return result;
    this.currency = result.currency;
    this.onChange();
    return result;
  }

  resetUpgrades() {
    const refund = this.upgrades.reset();
    if (refund <= 0) return { reset: false, reason: 'no-upgrades', refund: 0, currency: this.currency };
    this.currency += refund;
    this.onChange();
    return { reset: true, refund, currency: this.currency };
  }

  snapshot() {
    return {
      salvage: this.currency,
      currency: this.currency,
      runSalvage: this.runSalvage,
      destroyedEnemies: this.destroyedEnemies,
      highestWave: this.lifetimeHighestWave,
      totalDestroyed: this.totalDestroyed,
      upgrades: this.upgrades.snapshot(),
    };
  }

  exportState() {
    return {
      currency: this.currency,
      highestWave: this.lifetimeHighestWave,
      totalDestroyed: this.totalDestroyed,
      upgrades: this.upgrades.exportLevels(),
    };
  }
}
