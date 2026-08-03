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
});
