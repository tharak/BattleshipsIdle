import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('flagship vitals HUD', () => {
  it('shows only health and shield bars while retaining their fill elements', () => {
    const markup = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

    expect(markup).toContain('id="flagship-hull-fill"');
    expect(markup).toContain('id="flagship-shield-fill"');
    expect(markup).not.toContain('id="flagship-hull-value"');
    expect(markup).not.toContain('id="flagship-shield-value"');
    expect(markup).not.toContain('<span>HP</span>');
    expect(markup).not.toContain('<span>SH</span>');
  });
});
