export const ARENA = Object.freeze({
  width: 100,
  height: 150,
  minX: -48,
  maxX: 48,
  minY: -73,
  maxY: 73,
  commandY: -55,
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
    { role: 'escort', x: -33, y: -45 },
    { role: 'escort', x: -22, y: -48 },
    { role: 'escort', x: -11, y: -50 },
    { role: 'command', x: 0, y: -56 },
    { role: 'escort', x: 11, y: -50 },
    { role: 'escort', x: 22, y: -48 },
    { role: 'escort', x: 33, y: -45 },
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

export const FLAGSHIP_GUN = Object.freeze({
  firingDuration: 2.4,
  fullRecharge: 5.8,
  pulseInterval: 0.12,
  damagePerSecond: 90,
  shotHalfWidth: 0.78,
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

export const FORMATION_CHANGE = Object.freeze({
  duration: 1.15,
  cooldown: 2.6,
  movingIncomingDamage: 1.14,
  movingAutoDamage: 0.78,
});

export const FORMATION_ORDER = Object.freeze([
  'line',
  'wedge',
  'defensiveArc',
  'splitWings',
  'denseColumn',
]);

export const FORMATIONS = Object.freeze({
  line: Object.freeze({
    id: 'line',
    name: 'Line',
    shortName: 'Line',
    description: 'Broad coverage',
    mechanic: '+12% range',
    autoDamage: 1,
    fireRate: 1,
    range: 1.12,
    incomingDamage: 1,
    gunDamage: 1,
    gunWidth: 1,
  }),
  wedge: Object.freeze({
    id: 'wedge',
    name: 'Wedge',
    shortName: 'Wedge',
    description: 'Forward pressure',
    mechanic: '+18% auto damage',
    autoDamage: 1.18,
    fireRate: 1.04,
    range: 0.95,
    incomingDamage: 1.08,
    gunDamage: 1.08,
    gunWidth: 0.94,
  }),
  defensiveArc: Object.freeze({
    id: 'defensiveArc',
    name: 'Defensive arc',
    shortName: 'Arc',
    description: 'Command shelter',
    mechanic: '-32% incoming damage',
    autoDamage: 0.87,
    fireRate: 0.92,
    range: 0.96,
    incomingDamage: 0.68,
    gunDamage: 0.9,
    gunWidth: 1.06,
  }),
  splitWings: Object.freeze({
    id: 'splitWings',
    name: 'Split wings',
    shortName: 'Wings',
    description: 'Flank hunters',
    mechanic: '+48% side damage',
    autoDamage: 0.9,
    fireRate: 1.02,
    range: 1.08,
    incomingDamage: 1.05,
    gunDamage: 1.02,
    gunWidth: 1.08,
    sideDamage: 1.48,
    centerDamage: 0.82,
  }),
  denseColumn: Object.freeze({
    id: 'denseColumn',
    name: 'Dense column',
    shortName: 'Column',
    description: 'Synchronized cannon',
    mechanic: '+42% flagship gun damage',
    autoDamage: 1.08,
    fireRate: 1.06,
    range: 0.9,
    incomingDamage: 1.28,
    gunDamage: 1.42,
    gunWidth: 0.76,
  }),
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
