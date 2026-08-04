export const UPGRADE_ORDER = Object.freeze([
  'shipDamage',
  'autoFireRate',
  'volleyDamage',
  'volleyCooldown',
  'fleetSize',
  'deploymentCapacity',
  'durability',
  'shieldStrength',
  'resourceGeneration',
  'offlineEarnings',
  'commandNetwork',
  'automatedGunnery',
]);

export const UPGRADE_DEFINITIONS = Object.freeze({
  shipDamage: Object.freeze({
    id: 'shipDamage', name: 'Ship damage', icon: '✦', maxLevel: 20, baseCost: 55, costGrowth: 1.52,
    describe: (level) => `+${level * 12}% weapon damage`,
  }),
  autoFireRate: Object.freeze({
    id: 'autoFireRate', name: 'Automatic fire rate', icon: '⌁', maxLevel: 16, baseCost: 70, costGrowth: 1.56,
    describe: (level) => `+${level * 8}% firing speed`,
  }),
  volleyDamage: Object.freeze({
    id: 'volleyDamage', name: 'Flagship gun damage', icon: '◎', maxLevel: 16, baseCost: 85, costGrowth: 1.58,
    describe: (level) => `+${level * 18}% cannon damage`,
  }),
  volleyCooldown: Object.freeze({
    id: 'volleyCooldown', name: 'Gun cooling', icon: '◴', maxLevel: 8, baseCost: 110, costGrowth: 1.68,
    describe: (level) => `${level * 5}% faster gun cooling`,
  }),
  fleetSize: Object.freeze({
    id: 'fleetSize', name: 'Fleet size', icon: '⋔', maxLevel: 5, baseCost: 180, costGrowth: 2.05,
    describe: (level) => {
      const unlock = level === 1 ? ' · Lancer unlocked' : level === 2 ? ' · Guardian unlocked' : '';
      return `${7 + level} active ships${unlock}`;
    },
  }),
  deploymentCapacity: Object.freeze({
    id: 'deploymentCapacity', name: 'Deployment capacity', icon: '⌗', maxLevel: 8, baseCost: 140, costGrowth: 1.7,
    describe: (level) => `${4 + level} deployments per wave`,
  }),
  durability: Object.freeze({
    id: 'durability', name: 'Ship durability', icon: '⬡', maxLevel: 16, baseCost: 75, costGrowth: 1.56,
    describe: (level) => `+${level * 14}% hull strength`,
  }),
  shieldStrength: Object.freeze({
    id: 'shieldStrength', name: 'Shield strength', icon: '◈', maxLevel: 12, baseCost: 120, costGrowth: 1.62,
    describe: (level) => level === 0 ? 'No fleet shields' : `${24 + level * 14} escort shield`,
  }),
  resourceGeneration: Object.freeze({
    id: 'resourceGeneration', name: 'Resource generation', icon: '◇', maxLevel: 14, baseCost: 90, costGrowth: 1.57,
    describe: (level) => `+${level * 12}% salvage yield`,
  }),
  offlineEarnings: Object.freeze({
    id: 'offlineEarnings', name: 'Offline earnings', icon: '◌', maxLevel: 10, baseCost: 95, costGrowth: 1.6,
    describe: (level) => `+${level * 25}% offline yield`,
  }),
  commandNetwork: Object.freeze({
    id: 'commandNetwork', name: 'Command network', icon: '⌘', maxLevel: 12, baseCost: 125, costGrowth: 1.64,
    describe: (level) => {
      const loadouts = 1 + (level >= 1 ? 1 : 0) + (level >= 3 ? 1 : 0);
      return `${loadouts} loadout${loadouts === 1 ? '' : 's'} · +${level * 4.5}% maneuver · +${(level * 0.75).toFixed(level % 4 === 0 ? 0 : 2)} placement`;
    },
  }),
  automatedGunnery: Object.freeze({
    id: 'automatedGunnery', name: 'Autonomous gunnery', icon: '◉', maxLevel: 1, baseCost: 250000, costGrowth: 1,
    describe: (level) => level === 0 ? 'Manual flagship targeting' : 'Automatic priority targeting',
  }),
});

export function getUpgradeCost(id, level) {
  const definition = UPGRADE_DEFINITIONS[id];
  if (!definition || level >= definition.maxLevel) return null;
  return Math.ceil((definition.baseCost * definition.costGrowth ** level) / 5) * 5;
}
