import {
  createStarterLoadouts,
  normalizeFormationLoadouts,
} from '../formations/FormationSystem.js';

// Keep the established storage key so version-one players can be migrated in place.
const STORAGE_KEY = 'voidline-command-save-v1';
const SAVE_VERSION = 2;
const MAX_OFFLINE_HOURS = 8;
const MIN_OFFLINE_SECONDS = 60;

export function createDefaultSave(now = Date.now()) {
  return {
    version: SAVE_VERSION,
    currency: 0,
    upgrades: {},
    purchasedShips: { escort: 0, lancer: 0, guardian: 0 },
    highestWave: 0,
    totalDestroyed: 0,
    formationLoadouts: createStarterLoadouts('line'),
    activeLoadoutIndex: 0,
    lastSeen: now,
    onboardingComplete: false,
    settings: { sound: true, screenShake: true },
  };
}

export function migrateSave(source, now = Date.now()) {
  const defaults = createDefaultSave(now);
  const parsed = source && typeof source === 'object' ? source : {};
  const legacyFormation = typeof parsed.selectedFormation === 'string'
    ? parsed.selectedFormation
    : 'line';
  const legacy = Number(parsed.version || 1) < SAVE_VERSION;
  const upgrades = parsed.upgrades && typeof parsed.upgrades === 'object'
    ? { ...parsed.upgrades }
    : {};
  if (upgrades.commandNetwork === undefined && upgrades.formationMastery !== undefined) {
    upgrades.commandNetwork = upgrades.formationMastery;
  }
  delete upgrades.formationMastery;

  const formationLoadouts = legacy
    ? createStarterLoadouts(legacyFormation)
    : normalizeFormationLoadouts(parsed.formationLoadouts, legacyFormation);
  const activeLoadoutIndex = legacy
    ? 0
    : Math.max(0, Math.min(2, Math.floor(Number(parsed.activeLoadoutIndex) || 0)));

  return {
    ...defaults,
    ...parsed,
    version: SAVE_VERSION,
    upgrades,
    purchasedShips: { ...defaults.purchasedShips, ...(parsed.purchasedShips ?? {}) },
    settings: { ...defaults.settings, ...(parsed.settings ?? {}) },
    formationLoadouts,
    activeLoadoutIndex,
  };
}

export function calculateOfflineEarnings(state, now = Date.now()) {
  const elapsedSeconds = Math.max(0, (now - Number(state.lastSeen || now)) / 1000);
  if (elapsedSeconds < MIN_OFFLINE_SECONDS) {
    return { earned: 0, elapsedSeconds, creditedSeconds: 0, capped: false };
  }

  const offlineLevel = Math.max(0, Number(state.upgrades?.offlineEarnings || 0));
  const capHours = Math.min(MAX_OFFLINE_HOURS, 4 + offlineLevel * 0.4);
  const creditedSeconds = Math.min(elapsedSeconds, capHours * 3600);
  const basePerHour = 42 + Math.max(0, Number(state.highestWave || 0)) * 11;
  const rateMultiplier = 1 + offlineLevel * 0.25;
  const earned = Math.floor((creditedSeconds / 3600) * basePerHour * rateMultiplier);

  return {
    earned,
    elapsedSeconds,
    creditedSeconds,
    capped: elapsedSeconds > creditedSeconds,
  };
}

export class PersistenceStore {
  constructor(storage, { now = () => Date.now() } = {}) {
    this.storage = storage;
    this.now = now;
  }

  load() {
    const now = this.now();
    let rawState = {};
    try {
      const raw = this.storage?.getItem(STORAGE_KEY);
      if (raw) rawState = JSON.parse(raw);
    } catch {
      rawState = {};
    }

    const state = migrateSave(rawState, now);
    const offline = calculateOfflineEarnings(state, now);
    state.currency = Math.max(0, Number(state.currency || 0)) + offline.earned;
    state.lastSeen = now;
    this.save(state);
    return { state, offline };
  }

  save(state) {
    const payload = {
      ...migrateSave(state, this.now()),
      version: SAVE_VERSION,
      lastSeen: this.now(),
    };
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // Storage can be unavailable in privacy modes; gameplay remains fully in-memory.
    }
    return payload;
  }

  clear() {
    try {
      this.storage?.removeItem(STORAGE_KEY);
    } catch {
      // Storage can be unavailable; the caller still reloads into a fresh memory state.
    }
  }
}
