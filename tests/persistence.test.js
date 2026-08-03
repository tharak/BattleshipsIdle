import { describe, expect, it } from 'vitest';
import {
  PersistenceStore,
  calculateOfflineEarnings,
  createDefaultSave,
  migrateSave,
} from '../src/persistence/PersistenceStore.js';

class MemoryStorage {
  constructor(value = null) {
    this.value = value;
  }

  getItem() {
    return this.value;
  }

  setItem(_key, value) {
    this.value = value;
  }
}

describe('offline progression', () => {
  it('credits capped, upgrade-scaled earnings', () => {
    const now = Date.UTC(2026, 7, 1, 12);
    const state = {
      ...createDefaultSave(now - 2 * 3600 * 1000),
      lastSeen: now - 2 * 3600 * 1000,
      highestWave: 4,
      upgrades: { offlineEarnings: 2 },
    };

    expect(calculateOfflineEarnings(state, now)).toMatchObject({
      earned: 258,
      creditedSeconds: 7200,
      capped: false,
    });
  });

  it('caps long absences so offline play cannot replace active command', () => {
    const now = Date.UTC(2026, 7, 2);
    const state = {
      ...createDefaultSave(now - 48 * 3600 * 1000),
      lastSeen: now - 48 * 3600 * 1000,
    };
    const result = calculateOfflineEarnings(state, now);

    expect(result.capped).toBe(true);
    expect(result.creditedSeconds).toBe(4 * 3600);
  });

  it('loads, credits, and resaves local progression safely', () => {
    const now = Date.UTC(2026, 7, 1, 12);
    const storage = new MemoryStorage(JSON.stringify({
      ...createDefaultSave(now - 3600 * 1000),
      currency: 25,
      highestWave: 2,
      lastSeen: now - 3600 * 1000,
    }));
    const store = new PersistenceStore(storage, { now: () => now });
    const { state, offline } = store.load();

    expect(offline.earned).toBeGreaterThan(0);
    expect(state.currency).toBe(25 + offline.earned);
    expect(JSON.parse(storage.value).lastSeen).toBe(now);
    expect(JSON.parse(storage.value).version).toBe(2);
  });

  it('migrates a legacy formation and doctrine levels into version two', () => {
    const migrated = migrateSave({
      version: 1,
      selectedFormation: 'splitWings',
      upgrades: { formationMastery: 3 },
    });

    expect(migrated.version).toBe(2);
    expect(migrated.activeLoadoutIndex).toBe(0);
    expect(migrated.formationLoadouts).toHaveLength(3);
    expect(migrated.formationLoadouts[0].templateId).toBe('splitWings');
    expect(migrated.formationLoadouts[1].templateId).not.toBe('splitWings');
    expect(migrated.upgrades).toMatchObject({ commandNetwork: 3 });
    expect(migrated.upgrades.formationMastery).toBeUndefined();
  });
});
