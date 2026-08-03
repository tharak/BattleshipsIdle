export const ENEMY_TYPE_ORDER = Object.freeze(['raider', 'skirmisher', 'bulwark', 'artillery']);

export const ENEMY_TYPES = Object.freeze({
  raider: Object.freeze({
    id: 'raider', name: 'Raider', unlockWave: 1, health: 1, speed: 1, damage: 1,
    fireInterval: 1, reward: 1, drift: 1, attackType: 'bolt', scale: 1,
  }),
  skirmisher: Object.freeze({
    id: 'skirmisher', name: 'Skirmisher', unlockWave: 2, health: 0.7, speed: 1.48, damage: 0.82,
    fireInterval: 0.8, reward: 1.15, drift: 2.4, attackType: 'bolt', majorAttack: 'skirmisher', scale: 0.82,
  }),
  bulwark: Object.freeze({
    id: 'bulwark', name: 'Bulwark', unlockWave: 3, health: 2.05, speed: 0.67, damage: 1.3,
    fireInterval: 1.35, reward: 1.85, drift: 0.45, attackType: 'bolt', majorAttack: 'bulwark', scale: 1.28,
  }),
  artillery: Object.freeze({
    id: 'artillery', name: 'Artillery', unlockWave: 4, health: 1.08, speed: 0.76, damage: 1.2,
    fireInterval: 1.5, reward: 1.7, drift: 0.72, attackType: 'bolt', majorAttack: 'artillery', scale: 1.08,
  }),
});

export const ELITE = Object.freeze({
  firstWave: 3,
  everyWaves: 3,
  health: 1.7,
  damage: 1.32,
  speed: 1.08,
  reward: 2.45,
});

export const BOSS = Object.freeze({
  everyWaves: 5,
  name: 'Rift bastion',
  baseHealth: 1150,
  healthGrowth: 1.72,
  speed: 1.12,
  damage: 24,
  damageGrowth: 1.2,
  fireInterval: 1.28,
  reward: 220,
  barrierReduction: 0.84,
  exposureDuration: 3.8,
  areaRadius: 13,
});

export function isBossWave(wave) {
  return wave > 0 && wave % BOSS.everyWaves === 0;
}

export function getAvailableEnemyTypes(wave) {
  return ENEMY_TYPE_ORDER.filter((id) => ENEMY_TYPES[id].unlockWave <= wave);
}
