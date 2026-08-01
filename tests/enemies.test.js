import { describe, expect, it } from 'vitest';
import { BOSS, getAvailableEnemyTypes, isBossWave } from '../src/config/enemies.js';

describe('enemy progression', () => {
  it('introduces enemy roles gradually', () => {
    expect(getAvailableEnemyTypes(1)).toEqual(['raider']);
    expect(getAvailableEnemyTypes(2)).toEqual(['raider', 'skirmisher']);
    expect(getAvailableEnemyTypes(4)).toEqual(['raider', 'skirmisher', 'bulwark', 'artillery']);
  });

  it('schedules recurring active-play boss barriers', () => {
    expect(isBossWave(BOSS.everyWaves)).toBe(true);
    expect(isBossWave(BOSS.everyWaves - 1)).toBe(false);
    expect(BOSS.barrierReduction).toBeGreaterThan(0.75);
  });
});
