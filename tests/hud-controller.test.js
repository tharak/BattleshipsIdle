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

  it('provides a centered accessible control for readiness and flagship advancement', () => {
    const markup = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

    expect(markup).toContain('id="wave-intel"');
    expect(markup).toContain('id="enemy-formation-name"');
    expect(markup).toContain('id="wave-action-button"');
    expect(markup).toContain('id="wave-action-hint"');
    expect(styles).toContain('.wave-action');
    expect(styles).toContain('top: 50%');
    expect(styles).toContain('.wave-action[data-mode="advance"]');
  });
});
