import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

/**
 * Branding: the sidebar reads EMIND with the "em" monogram — the mark only,
 * the wordmark rides beside it; no raster emblem in the app chrome. The mark
 * inherits the theme accent rather than hard-coding a brand hex, so every
 * colorway re-inks it for free.
 */
describe('eMind mark branding', () => {
  test('the mark is the single-stroke em monogram, themed by currentColor', () => {
    const mark = read('components/EmindMark.tsx');
    // open bowl running on into the m: valley, apex, stem
    expect(mark).toContain('M76 91 A32 32 0 1 1 68 40 L128 88 L178 27 L178 115');
    expect(mark).toContain('M20 68 H84'); // crossbar of the e
    expect(mark).toContain("color = 'currentColor'");
    expect(mark).toMatch(/strokeLinecap="round"/);
    // no baked-in brand hex — the accent token owns the color
    expect(mark).not.toMatch(/#[0-9a-f]{6}/i);
  });

  test('the sidebar brands with the mark, no raster emblem', () => {
    const sidebar = read('components/Sidebar.tsx');
    expect(sidebar).toContain('EmindMark');
    expect(sidebar).toContain('EMIND');
    expect(sidebar).toContain('Conductor OS');
    expect(sidebar).not.toMatch(/emblem|\.png/i);
    // the mark renders no text at all — the logo is the only lockup element
    expect(read('components/EmindMark.tsx')).not.toMatch(/<text/);
  });

  test('the retired Founder OS ring mark is gone', () => {
    expect(() => read('components/OsMark.tsx')).toThrow();
  });
});
