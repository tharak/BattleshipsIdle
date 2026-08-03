import { describe, expect, it } from 'vitest';
import { FORMATION_CHANGE, FORMATION_EDITOR } from '../src/config/balance.js';
import { FormationSystem, getStarterTemplatePositions } from '../src/formations/FormationSystem.js';

function fleet() {
  return Array.from({ length: 7 }, (_, slot) => ({
    id: `ship-${slot}`,
    slot,
    role: slot === 3 ? 'command' : 'escort',
    x: 0,
    y: -50,
    alive: true,
  }));
}

describe('FormationSystem', () => {
  it('preserves five editable, separated starter templates', () => {
    const system = new FormationSystem();
    const line = system.getPositions(7, 'line');
    const wedge = system.getPositions(7, 'wedge');
    const arc = system.getPositions(7, 'defensiveArc');
    const wings = system.getPositions(7, 'splitWings');
    const column = system.getPositions(7, 'denseColumn');

    expect(new Set([line, wedge, arc, wings, column].map(JSON.stringify)).size).toBe(5);
    expect(arc[3].y).toBe(Math.min(...arc.map(({ y }) => y)));
    expect(wings[0].y).toBe(wings[2].y);
    expect(Math.max(...column.map(({ x }) => Math.abs(x)))).toBeLessThan(12);
    for (const layout of [line, wedge, arc, wings, column]) {
      for (let left = 0; left < layout.length; left += 1) {
        for (let right = left + 1; right < layout.length; right += 1) {
          expect(Math.hypot(layout[left].x - layout[right].x, layout[left].y - layout[right].y))
            .toBeGreaterThanOrEqual(FORMATION_EDITOR.minimumSeparation);
        }
      }
    }
  });

  it('places newly unlocked role ships in a visible mirrored row', () => {
    const expandedLine = getStarterTemplatePositions('line', 9);

    expect(expandedLine[7]).toMatchObject({ x: -30, y: -45 });
    expect(expandedLine[8]).toMatchObject({ x: 30, y: -45 });
  });

  it('snaps to a five-unit grid and rejects boundaries and overlap', () => {
    const system = new FormationSystem();
    const ships = fleet();
    system.applyInitialPositions(ships);

    expect(system.previewPlacement(0, -27.6, -51.9, ships)).toMatchObject({
      candidate: { x: -30, y: -50 },
      valid: true,
    });
    expect(system.previewPlacement(0, 15, -40, ships)).toMatchObject({ valid: false, reason: 'overlap' });
    expect(system.previewPlacement(0, 100, -50, ships)).toMatchObject({ valid: false, reason: 'outside-fleet-zone' });
  });

  it('expands placement range with Command Network levels', () => {
    const base = new FormationSystem({ commandNetworkLevel: 0 });
    const upgraded = new FormationSystem({ commandNetworkLevel: 12 });
    expect(upgraded.getPlacementBounds().maxX).toBeGreaterThan(base.getPlacementBounds().maxX);
    expect(upgraded.snapshot(fleet()).maneuverSpeed).toBeGreaterThan(base.snapshot(fleet()).maneuverSpeed);
  });

  it('moves the flagship physically after a valid custom edit', () => {
    const system = new FormationSystem();
    const ships = fleet();
    system.applyInitialPositions(ships);
    const flagship = ships.find(({ role }) => role === 'command');
    const originalY = flagship.y;

    system.previewPlacement(flagship.slot, 0, -50, ships);
    const result = system.commitPlacement(ships);
    system.update(ships, 0.2);

    expect(result.changed).toBe(true);
    expect(flagship.y).toBeGreaterThan(originalY);
    expect(flagship.y).toBeLessThan(flagship.targetY);
    expect(system.activeLoadout.templateId).toBeNull();
  });

  it('derives opposed strengths from current geometry', () => {
    const wide = new FormationSystem('line');
    const dense = new FormationSystem('denseColumn');
    const wideShips = fleet();
    const denseShips = fleet();
    wide.applyInitialPositions(wideShips);
    dense.applyInitialPositions(denseShips);

    const wideSnapshot = wide.snapshot(wideShips);
    const denseSnapshot = dense.snapshot(denseShips);
    expect(wideSnapshot.geometry.horizontalSpread).toBeGreaterThan(denseSnapshot.geometry.horizontalSpread);
    expect(wideSnapshot.modifiers.rangeBonus).toBeGreaterThan(denseSnapshot.modifiers.rangeBonus);
    expect(denseSnapshot.geometry.cohesion).toBeGreaterThan(wideSnapshot.geometry.cohesion);
    expect(denseSnapshot.modifiers.flagshipDamageBonus).toBeGreaterThan(wideSnapshot.modifiers.flagshipDamageBonus);
    expect(denseSnapshot.modifiers.flagshipDamageReduction).toBeGreaterThan(0);
  });

  it('animates templates and enforces the loadout combat cooldown', () => {
    const system = new FormationSystem({ commandNetworkLevel: 3 });
    const ships = fleet();
    system.applyInitialPositions(ships);
    const startX = ships[0].x;

    const result = system.applyTemplate('denseColumn', ships);
    system.update(ships, 0.5);

    expect(result.changed).toBe(true);
    expect(ships[0].x).not.toBe(startX);
    expect(ships[0].x).not.toBe(ships[0].targetX);
    expect(system.activateLoadout(1, ships)).toMatchObject({ changed: false, reason: 'cooldown' });
    system.update(ships, FORMATION_CHANGE.cooldown);
    expect(system.activateLoadout(1, ships).changed).toBe(true);
  });

  it('uses horizontal spread for side-target damage without fixed template packages', () => {
    const system = new FormationSystem('splitWings');
    const ships = fleet();
    system.applyInitialPositions(ships);
    expect(system.getAutoDamageMultiplier({ x: 30 }, ships)).toBeGreaterThan(
      system.getAutoDamageMultiplier({ x: 0 }, ships),
    );
  });
});
