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

  it('exposes accessible loadouts, geometry strengths, templates, and Tactical Edge', () => {
    const markup = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

    expect(markup.match(/data-loadout=/g)).toHaveLength(3);
    expect(markup).toContain('id="spread-strength"');
    expect(markup).toContain('id="cohesion-strength"');
    expect(markup).toContain('id="screening-strength"');
    expect(markup).toContain('id="formation-template"');
    expect(markup).toContain('aria-label="Tactical Edge 0 of 3"');
    expect(markup).toContain('lower fleet zone');
    expect(styles).toContain('@media (max-width: 720px)');
    expect(styles).toContain('grid-template-areas:');
  });
});
