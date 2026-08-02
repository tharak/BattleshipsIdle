import { describe, expect, it } from 'vitest';
import { formatDamageAmount } from '../src/rendering/GameRenderer.js';

describe('damage number formatting', () => {
  it('keeps tiny hits visible and rounds larger damage for fast reading', () => {
    expect(formatDamageAmount(0.04)).toBe('1');
    expect(formatDamageAmount(7.6)).toBe('8');
    expect(formatDamageAmount(1234.4)).toBe('1,234');
  });
});
