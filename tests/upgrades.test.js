import { describe, expect, it } from 'vitest';
import { getUpgradeCost } from '../src/config/upgrades.js';
import { UpgradeSystem } from '../src/progression/UpgradeSystem.js';

describe('UpgradeSystem', () => {
  it('increases costs progressively and reports effects', () => {
    expect(getUpgradeCost('shipDamage', 1)).toBeGreaterThan(getUpgradeCost('shipDamage', 0));
    const system = new UpgradeSystem();
    const damage = system.snapshot().find(({ id }) => id === 'shipDamage');

    expect(damage.currentEffect).toContain('+0%');
    expect(damage.nextEffect).toContain('+12%');
  });

  it('rejects unaffordable upgrades and applies purchased multipliers', () => {
    const system = new UpgradeSystem();
    expect(system.purchase('shipDamage', 0)).toMatchObject({ purchased: false, reason: 'insufficient' });

    const result = system.purchase('shipDamage', 100);
    expect(result.purchased).toBe(true);
    expect(system.shipDamageMultiplier).toBeCloseTo(1.12);
    expect(result.currency).toBe(45);
  });

  it('sanitizes loaded levels to their allowed ranges', () => {
    const system = new UpgradeSystem({ shipDamage: 999, fleetSize: -4, shieldStrength: 2.9 });
    expect(system.getLevel('shipDamage')).toBe(20);
    expect(system.getLevel('fleetSize')).toBe(0);
    expect(system.getLevel('shieldStrength')).toBe(2);
  });

  it('keeps autonomous gunnery as a single expensive end-game unlock', () => {
    const system = new UpgradeSystem();

    expect(getUpgradeCost('automatedGunnery', 0)).toBe(250000);
    expect(system.purchase('automatedGunnery', 249999)).toMatchObject({ purchased: false, reason: 'insufficient' });
    expect(system.purchase('automatedGunnery', 250000)).toMatchObject({ purchased: true, currency: 0 });
    expect(system.automatedGunnery).toBe(true);
    expect(system.getCost('automatedGunnery')).toBeNull();
  });
});
