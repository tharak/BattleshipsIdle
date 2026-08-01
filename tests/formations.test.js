import { describe, expect, it } from 'vitest';
import { FormationSystem } from '../src/formations/FormationSystem.js';

function fleet() {
  return Array.from({ length: 7 }, (_, slot) => ({ slot, x: slot * 2, y: -50 }));
}

describe('FormationSystem', () => {
  it('provides distinct seven-ship layouts', () => {
    const system = new FormationSystem();
    const line = system.getPositions(7, 'line');
    const wedge = system.getPositions(7, 'wedge');
    const arc = system.getPositions(7, 'defensiveArc');
    const wings = system.getPositions(7, 'splitWings');
    const column = system.getPositions(7, 'denseColumn');

    expect(wedge).not.toEqual(line);
    expect(arc).not.toEqual(wedge);
    expect(arc[0].y).toBeGreaterThan(arc[2].y);
    expect(arc[3].y).toBe(Math.min(...arc.map(({ y }) => y)));
    expect(Math.max(...wings.map(({ x }) => Math.abs(x)))).toBeGreaterThan(35);
    expect(wings[0].y).toBe(wings[2].y);
    expect(wings[1].y).toBeLessThan(wings[0].y);
    expect(wings[3].y).toBe(Math.min(...wings.map(({ y }) => y)));
    expect(Math.max(...column.map(({ x }) => Math.abs(x)))).toBeLessThan(6);
  });

  it('animates ships toward new slots and enforces a combat cooldown', () => {
    const system = new FormationSystem();
    const ships = fleet();
    system.applyInitialPositions(ships);
    const startX = ships[0].x;

    const result = system.changeTo('denseColumn', ships);
    system.update(ships, 0.5);

    expect(result.changed).toBe(true);
    expect(ships[0].x).not.toBe(startX);
    expect(ships[0].x).not.toBe(ships[0].targetX);
    expect(system.changeTo('wedge', ships)).toMatchObject({ changed: false, reason: 'cooldown' });
  });

  it('gives split wings a real flank damage preference', () => {
    const system = new FormationSystem('splitWings');
    expect(system.getAutoDamageMultiplier({ x: 30 })).toBeGreaterThan(
      system.getAutoDamageMultiplier({ x: 0 }),
    );
  });
});
