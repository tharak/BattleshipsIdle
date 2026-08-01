export const ARENA = Object.freeze({
  width: 100,
  height: 150,
  minX: -48,
  maxX: 48,
  minY: -73,
  maxY: 73,
  commandY: -63,
  defenseLineY: -68,
});

export const FLEET = Object.freeze({
  commandHealth: 320,
  escortHealth: 100,
  commandDamage: 17,
  escortDamage: 10,
  commandFireInterval: 0.58,
  escortFireInterval: 0.82,
  projectileSpeed: 104,
  projectileLifetime: 2.2,
  effectiveRange: 128,
  positions: [
    { role: 'escort', x: -33, y: -52 },
    { role: 'escort', x: -22, y: -55 },
    { role: 'escort', x: -11, y: -57 },
    { role: 'command', x: 0, y: -63 },
    { role: 'escort', x: 11, y: -57 },
    { role: 'escort', x: 22, y: -55 },
    { role: 'escort', x: 33, y: -52 },
  ],
});

export const ENEMIES = Object.freeze({
  baseHealth: 105,
  healthGrowth: 1.18,
  baseSpeed: 3.2,
  speedPerWave: 0.13,
  baseDamage: 8,
  damageGrowth: 1.105,
  baseFireInterval: 2.35,
  minFireInterval: 1.05,
  projectileSpeed: 40,
  projectileLifetime: 4.2,
  fireThresholdY: 65,
  breachDamageMultiplier: 3.2,
  baseReward: 7,
  rewardGrowth: 1.09,
});

export const VOLLEY = Object.freeze({
  cooldown: 5.8,
  radius: 15,
  innerRadius: 4.8,
  damage: 75,
  precisionMultiplier: 1.55,
});

export const WAVES = Object.freeze({
  startingEnemies: 5,
  extraEnemyEvery: 2,
  maxEnemies: 18,
  intermission: 2.25,
  clearRewardBase: 12,
  spawnTopMin: 48,
  spawnTopMax: 69,
});

export const SIMULATION = Object.freeze({
  maxDelta: 0.05,
  collisionRadius: 2.1,
  projectileHitRadius: 2.45,
});

export function getWaveEnemyCount(wave) {
  return Math.min(
    WAVES.maxEnemies,
    WAVES.startingEnemies + Math.floor(Math.max(0, wave - 1) / WAVES.extraEnemyEvery),
  );
}

export function getEnemyStats(wave) {
  const tier = Math.max(0, wave - 1);
  return {
    maxHealth: Math.round(ENEMIES.baseHealth * ENEMIES.healthGrowth ** tier),
    speed: ENEMIES.baseSpeed + tier * ENEMIES.speedPerWave,
    damage: Math.round(ENEMIES.baseDamage * ENEMIES.damageGrowth ** tier),
    fireInterval: Math.max(
      ENEMIES.minFireInterval,
      ENEMIES.baseFireInterval - tier * 0.045,
    ),
    reward: Math.round(ENEMIES.baseReward * ENEMIES.rewardGrowth ** tier),
  };
}
