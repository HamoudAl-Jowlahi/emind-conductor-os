import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { DEFAULT_THEME, THEMES, THEME_META, THEME_STORAGE_KEY, THEME_INIT_SCRIPT, isTheme, nextTheme, resolveInitialTheme } from '@/lib/theme';

describe('theme registry', () => {
  test('seven pickable themes, emind first as the default identity', () => {
    expect(DEFAULT_THEME).toBe('emind');
    expect(THEMES[0]).toBe(DEFAULT_THEME);
    expect(THEMES).toEqual(['emind', 'mono', 'mono-light', 'dark', 'light', 'midnight', 'ember']);
    expect(new Set(THEMES).size).toBe(THEMES.length);
    expect(THEME_STORAGE_KEY).toBe('alex-theme');
  });

  test('the eMind theme is Monolith plus the brand violet — status colors untouched', () => {
    const css = readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8');
    const block = css.slice(css.indexOf("data-theme='emind'"));
    expect(block).toContain('--accent: #7c5cff');
    // identity color must never displace the status trio
    expect(block).toContain('--ok: #2fd36f');
    expect(block).toContain('--warn: #ffb000');
    expect(block).toContain('--err: #ff2d3f');
    expect(THEME_META.emind.swatch[1]).toBe('#7c5cff');
  });

  test('every theme carries picker metadata: name, blurb, 3 swatch colors', () => {
    for (const t of THEMES) {
      const meta = THEME_META[t];
      expect(meta.name.length, t).toBeGreaterThan(0);
      expect(meta.blurb.length, t).toBeGreaterThan(0);
      expect(meta.swatch).toHaveLength(3);
      for (const c of meta.swatch) expect(c, `${t} swatch`).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  test('isTheme guards arbitrary strings', () => {
    expect(isTheme('dark')).toBe(true);
    expect(isTheme('midnight')).toBe(true);
    expect(isTheme('sepia')).toBe(false);
    expect(isTheme(null)).toBe(false);
  });

  test('resolveInitialTheme honors any valid stored value, else falls back to emind', () => {
    expect(resolveInitialTheme('ember')).toBe('ember');
    expect(resolveInitialTheme('dark')).toBe('dark');
    expect(resolveInitialTheme(null)).toBe('emind');
    expect(resolveInitialTheme('garbage')).toBe('emind');
  });

  test('nextTheme cycles the whole ring', () => {
    const seen: string[] = [];
    let t: (typeof THEMES)[number] = THEMES[0];
    for (let i = 0; i < THEMES.length; i++) {
      seen.push(t);
      t = nextTheme(t);
    }
    expect(seen).toEqual([...THEMES]);
    expect(t).toBe(THEMES[0]); // full circle
  });

  test('the pre-paint init script accepts every registered theme id and falls back to emind', () => {
    for (const t of THEMES) expect(THEME_INIT_SCRIPT).toContain(t);
    expect(THEME_INIT_SCRIPT).toContain(THEME_STORAGE_KEY);
    expect(THEME_INIT_SCRIPT).toContain(`t="emind"`);
    expect(THEME_INIT_SCRIPT).not.toContain(`t="dark"`);
  });

  test('globals.css groups the bare :root with emind, so no-JS loads default to the brand theme', () => {
    const css = readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8');
    expect(css).toMatch(/:root,\s*\n:root\[data-theme='emind'\]/);
    expect(css).not.toMatch(/:root,\s*\n:root\[data-theme='mono'\]/);
    expect(css).not.toMatch(/:root,\s*\n:root\[data-theme='dark'\]/);
  });

  test('every registered theme has its own token block in app/globals.css', () => {
    const css = readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8');
    for (const t of THEMES) expect(css, t).toContain(`data-theme='${t}'`);
  });
});
