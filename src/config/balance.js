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
  lancerHealth: 78,
  guardianHealth: 158,
  commandDamage: 17,
  escortDamage: 10,
  lancerDamage: 11,
  guardianDamage: 7.5,
  commandFireInterval: 0.58,
  escortFireInterval: 0.82,
  lancerFireInterval: 0.56,
  guardianFireInterval: 1.02,
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
  burstStartDamageMultiplier: 0.7,
  burstEndDamageMultiplier: 1.45,
  criticalStartChance: 0.05,
  criticalEndChance: 0.4,
  criticalDamageMultiplier: 1.5,
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
  cooldown: 2.6,
  baseManeuverSpeed: 22,
  maneuverSpeedPerLevel: 0.045,
  movingIncomingDamage: 1.14,
  movingAutoDamage: 0.78,
});

export const FORMATION_EDITOR = Object.freeze({
  loadoutCount: 3,
  gridSize: 5,
  minimumSeparation: 6,
  shipPickRadius: 6.5,
  horizontalPadding: 5,
  basePlacementHalfWidth: 35,
  placementHalfWidthPerLevel: 0.75,
  fleetZoneTopRatio: 0.25,
  fleetZoneBottomPadding: 18,
});

export const GEOMETRY_BONUSES = Object.freeze({
  baseCapRatio: 0.75,
  rangeMaximum: 0.18,
  sideDamageMaximum: 0.24,
  fireRateMaximum: 0.1,
  flagshipDamageMaximum: 0.35,
  screeningMaximum: 0.3,
  cohesionIdealRadius: 7,
  cohesionFalloffRadius: 25,
  screeningRadius: 30,
  screeningFullWeight: 2.2,
  sideTargetRatio: 0.42,
});

export const TACTICAL_EDGE = Object.freeze({
  maximumStacks: 3,
  damagePerStack: 0.12,
  criticalChancePerStack: 0.08,
});

export const TELEGRAPH_ATTACKS = Object.freeze({
  initialDelay: 2.6,
  repeatDelay: 5.8,
  repeatJitter: 1.4,
  artillery: Object.freeze({ kind: 'blast', warning: 1.65, radius: 11, damageMultiplier: 1.55 }),
  skirmisher: Object.freeze({ kind: 'lane', warning: 1.35, width: 8, damageMultiplier: 1.35 }),
  bulwark: Object.freeze({ kind: 'focus', warning: 1.8, width: 4.8, damageMultiplier: 1.8 }),
  boss: Object.freeze({ warning: 1.5, damageMultiplier: 1.55 }),
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
    mechanic: 'Wide horizontal spread',
  }),
  wedge: Object.freeze({
    id: 'wedge',
    name: 'Wedge',
    shortName: 'Wedge',
    description: 'Forward pressure',
    mechanic: 'Layered forward pressure',
  }),
  defensiveArc: Object.freeze({
    id: 'defensiveArc',
    name: 'Defensive arc',
    shortName: 'Arc',
    description: 'Command shelter',
    mechanic: 'Flagship screening',
  }),
  splitWings: Object.freeze({
    id: 'splitWings',
    name: 'Split wings',
    shortName: 'Wings',
    description: 'Flank hunters',
    mechanic: 'Separated maneuver wings',
  }),
  denseColumn: Object.freeze({
    id: 'denseColumn',
    name: 'Dense column',
    shortName: 'Column',
    description: 'Synchronized cannon',
    mechanic: 'High-cohesion gun line',
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
