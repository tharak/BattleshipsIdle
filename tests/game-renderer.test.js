import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { RENDER_COLORS, RENDERING } from '../src/config/rendering.js';
import { formatDamageAmount } from '../src/rendering/GameRenderer.js';

describe('damage number formatting', () => {
  it('keeps tiny hits visible and rounds larger damage for fast reading', () => {
    expect(formatDamageAmount(0.04)).toBe('1');
    expect(formatDamageAmount(7.6)).toBe('8');
    expect(formatDamageAmount(1234.4)).toBe('1,234');
  });

  it('keeps presentation tuning in a deeply frozen rendering config', () => {
    expect(Object.isFrozen(RENDER_COLORS)).toBe(true);
    expect(Object.isFrozen(RENDER_COLORS.damageText)).toBe(true);
    expect(Object.isFrozen(RENDERING)).toBe(true);
    expect(Object.isFrozen(RENDERING.damageNumber.laneOffsets)).toBe(true);
    expect(RENDERING.damageNumber.criticalWidth).toBeGreaterThan(RENDERING.damageNumber.width);
    expect(RENDER_COLORS.damageText.critical).not.toBe(RENDER_COLORS.damageText.enemy);
  });

  it('does not embed raw color literals in the renderer implementation', () => {
    const rendererPath = fileURLToPath(new URL('../src/rendering/GameRenderer.js', import.meta.url));
    const source = readFileSync(rendererPath, 'utf8');

    expect(source).not.toMatch(/0x[\da-f]+|#[\da-f]{3,8}/i);
  });

  it('reuses hull contours for scalable shields and hostile status effects', () => {
    const rendererPath = fileURLToPath(new URL('../src/rendering/GameRenderer.js', import.meta.url));
    const source = readFileSync(rendererPath, 'utf8');

    expect(source).toContain('function createHullContour');
    expect(source).toContain('createHullContour(shapePoints, contourMaterial, contourConfig)');
    expect(source).toContain('new THREE.LineLoop');
    expect(source).not.toContain('shieldRing');
    expect(source).not.toContain('shieldGlowMaterial');
    expect(source).not.toContain('haloGeometry');
    expect(RENDERING.ships.shieldOutline).not.toHaveProperty('glowScale');
    expect(RENDERING.entityAnimation.shieldEnergyScale).toBeGreaterThan(0.1);
  });

  it('defines a complete layered visual profile for every ship archetype', () => {
    const archetypes = [
      'escort',
      'lancer',
      'guardian',
      'command',
      'raider',
      'skirmisher',
      'bulwark',
      'artillery',
      'boss',
    ];

    for (const archetype of archetypes) {
      const profile = RENDERING.ships.profiles[archetype];
      expect(RENDERING.ships.shapes[archetype].length).toBeGreaterThanOrEqual(8);
      expect(profile.engineX.length).toBeGreaterThanOrEqual(2);
      expect(profile.armorScale).toHaveLength(3);
      expect(profile.cockpitScale).toHaveLength(3);
    }
    expect(Object.isFrozen(RENDERING.ships.profiles.command)).toBe(true);
  });

  it('gives each friendly combat role unmistakable model hardware', () => {
    const hardware = RENDERING.ships.roleHardware;

    expect(hardware.escort.barrelPositions).toHaveLength(2);
    expect(hardware.lancer.railPositions).toHaveLength(2);
    expect(hardware.lancer.railSize[1]).toBeGreaterThan(hardware.escort.barrelSize[1]);
    expect(hardware.guardian.prowPoints).toHaveLength(6);
    expect(hardware.guardian.bracePositions).toHaveLength(2);
    expect(RENDER_COLORS.lancer).not.toBe(RENDER_COLORS.friendly);
    expect(RENDER_COLORS.guardian).not.toBe(RENDER_COLORS.friendly);
  });

  it('renders the clear flagship route and dash as configured battlefield feedback', () => {
    const rendererPath = fileURLToPath(new URL('../src/rendering/GameRenderer.js', import.meta.url));
    const source = readFileSync(rendererPath, 'utf8');

    expect(source).toContain('createAdvancePath()');
    expect(source).toContain('syncAdvancePath(snapshot, deltaSeconds)');
    expect(source).toContain("event.type === 'flagshipAdvanceStarted'");
    expect(RENDERING.advancePath.dashSize).toBeGreaterThan(RENDERING.advancePath.gapSize);
    expect(RENDERING.entityAnimation.dashEngineLength).toBeGreaterThan(1);
  });
});
