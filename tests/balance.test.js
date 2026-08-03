import { describe, expect, it } from 'vitest';
import {
  ARENA,
  ENEMIES,
  FLEET,
  WAVE_FLOW,
  getEnemyStats,
  getWaveEnemyCount,
} from '../src/config/balance.js';

describe('wave balance', () => {
  it('adds enemies gradually and respects the cap', () => {
    expect(getWaveEnemyCount(1)).toBe(5);
    expect(getWaveEnemyCount(2)).toBe(5);
    expect(getWaveEnemyCount(3)).toBe(6);
    expect(getWaveEnemyCount(999)).toBe(18);
  });

  it('scales durability, pressure, damage, and rewards with wave', () => {
    const first = getEnemyStats(1);
    const later = getEnemyStats(8);

    expect(later.maxHealth).toBeGreaterThan(first.maxHealth);
    expect(later.speed).toBeGreaterThan(first.speed);
    expect(later.damage).toBeGreaterThan(first.damage);
    expect(later.fireInterval).toBeLessThan(first.fireInterval);
    expect(later.reward).toBeGreaterThan(first.reward);
  });

  it('limits weapons to half the battlefield and centralizes the fleet approach rules', () => {
    expect(FLEET.effectiveRange).toBe(ARENA.height / 2);
    expect(ENEMIES.effectiveRange).toBe(ARENA.height / 2);
    expect(WAVE_FLOW.friendlyAdvanceDistance).toBeGreaterThan(0);
    expect(WAVE_FLOW.enemyAdvanceDistance).toBeGreaterThan(0);
    expect(WAVE_FLOW.flagshipDashSpeed).toBeGreaterThan(WAVE_FLOW.enemyApproachSpeed);
  });
});
