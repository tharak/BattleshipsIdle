import {
  UPGRADE_DEFINITIONS,
  UPGRADE_ORDER,
  getUpgradeCost,
} from '../config/upgrades.js';

export class UpgradeSystem {
  constructor(levels = {}) {
    this.levels = Object.fromEntries(
      UPGRADE_ORDER.map((id) => {
        const value = Number.isFinite(levels[id]) ? Math.floor(levels[id]) : 0;
        return [id, Math.max(0, Math.min(UPGRADE_DEFINITIONS[id].maxLevel, value))];
      }),
    );
  }

  getLevel(id) {
    return this.levels[id] ?? 0;
  }

  getCost(id) {
    return getUpgradeCost(id, this.getLevel(id));
  }

  purchase(id, currency) {
    const cost = this.getCost(id);
    if (cost === null) return { purchased: false, reason: 'max-level', currency };
    if (currency < cost) return { purchased: false, reason: 'insufficient', currency, cost };
    this.levels[id] += 1;
    return { purchased: true, id, level: this.levels[id], cost, currency: currency - cost };
  }

  get shipDamageMultiplier() {
    return 1 + this.getLevel('shipDamage') * 0.12;
  }

  get autoFireRateMultiplier() {
    return 1 + this.getLevel('autoFireRate') * 0.08;
  }

  get volleyDamageMultiplier() {
    return 1 + this.getLevel('volleyDamage') * 0.18;
  }

  get volleyCooldownMultiplier() {
    return 1 - this.getLevel('volleyCooldown') * 0.05;
  }

  get durabilityMultiplier() {
    return 1 + this.getLevel('durability') * 0.14;
  }

  get resourceMultiplier() {
    return 1 + this.getLevel('resourceGeneration') * 0.12;
  }

  get formationMasteryMultiplier() {
    return 1 + this.getLevel('formationMastery') * 0.05;
  }

  get fleetSize() {
    return 7 + this.getLevel('fleetSize');
  }

  getShieldFor(role) {
    const level = this.getLevel('shieldStrength');
    if (level === 0) return 0;
    const escortShield = 24 + level * 14;
    if (role === 'command') return Math.round(escortShield * 2.45);
    if (role === 'guardian') return Math.round(escortShield * 1.65);
    return escortShield;
  }

  snapshot() {
    return UPGRADE_ORDER.map((id) => {
      const definition = UPGRADE_DEFINITIONS[id];
      const level = this.getLevel(id);
      const cost = this.getCost(id);
      return {
        id,
        name: definition.name,
        icon: definition.icon,
        level,
        maxLevel: definition.maxLevel,
        currentEffect: definition.describe(level),
        nextEffect: cost === null ? 'Maximum level' : definition.describe(level + 1),
        cost,
      };
    });
  }

  exportLevels() {
    return { ...this.levels };
  }
}
