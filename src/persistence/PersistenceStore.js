const STORAGE_KEY = 'voidline-command-save-v1';
const MAX_OFFLINE_HOURS = 8;
const MIN_OFFLINE_SECONDS = 60;

export function createDefaultSave(now = Date.now()) {
  return {
    version: 1,
    currency: 0,
    upgrades: {},
    highestWave: 0,
    totalDestroyed: 0,
    selectedFormation: 'line',
    lastSeen: now,
    onboardingComplete: false,
    settings: { sound: true, screenShake: true },
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
    let state = createDefaultSave(now);
    try {
      const raw = this.storage?.getItem(STORAGE_KEY);
      if (raw) state = { ...state, ...JSON.parse(raw) };
    } catch {
      state = createDefaultSave(now);
    }

    state.upgrades = state.upgrades && typeof state.upgrades === 'object' ? state.upgrades : {};
    state.settings = { ...createDefaultSave(now).settings, ...(state.settings ?? {}) };
    const offline = calculateOfflineEarnings(state, now);
    state.currency = Math.max(0, Number(state.currency || 0)) + offline.earned;
    state.lastSeen = now;
    this.save(state);
    return { state, offline };
  }

  save(state) {
    const payload = { ...state, version: 1, lastSeen: this.now() };
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // Storage can be unavailable in privacy modes; gameplay remains fully in-memory.
    }
    return payload;
  }
}
