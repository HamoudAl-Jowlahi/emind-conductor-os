import { describe, expect, test } from 'vitest';
import { cronMatches, nextMinute } from '@/lib/cron';

/** Local time, since a cron a human wrote means their wall clock. */
const at = (s: string) => new Date(s);

describe('cronMatches — the five fields', () => {
  test('all-wildcards fires every minute', () => {
    expect(cronMatches('* * * * *', at('2026-08-20T09:07:00'))).toBe(true);
  });

  test('an exact minute+hour fires only then', () => {
    expect(cronMatches('30 9 * * *', at('2026-08-20T09:30:00'))).toBe(true);
    expect(cronMatches('30 9 * * *', at('2026-08-20T09:31:00'))).toBe(false);
    expect(cronMatches('30 9 * * *', at('2026-08-20T10:30:00'))).toBe(false);
  });

  test('step values fire on the interval', () => {
    expect(cronMatches('*/15 * * * *', at('2026-08-20T09:00:00'))).toBe(true);
    expect(cronMatches('*/15 * * * *', at('2026-08-20T09:15:00'))).toBe(true);
    expect(cronMatches('*/15 * * * *', at('2026-08-20T09:16:00'))).toBe(false);
  });

  test('ranges fire inside and not outside', () => {
    expect(cronMatches('0 9-17 * * *', at('2026-08-20T09:00:00'))).toBe(true);
    expect(cronMatches('0 9-17 * * *', at('2026-08-20T17:00:00'))).toBe(true);
    expect(cronMatches('0 9-17 * * *', at('2026-08-20T18:00:00'))).toBe(false);
  });

  test('lists fire on each listed value', () => {
    expect(cronMatches('0 8,12,18 * * *', at('2026-08-20T12:00:00'))).toBe(true);
    expect(cronMatches('0 8,12,18 * * *', at('2026-08-20T13:00:00'))).toBe(false);
  });

  test('day-of-week is honoured (2026-08-20 is a Thursday = 4)', () => {
    expect(cronMatches('0 9 * * 4', at('2026-08-20T09:00:00'))).toBe(true);
    expect(cronMatches('0 9 * * 5', at('2026-08-20T09:00:00'))).toBe(false);
    expect(cronMatches('0 9 * * 1-5', at('2026-08-20T09:00:00'))).toBe(true);
    expect(cronMatches('0 9 * * 0,6', at('2026-08-20T09:00:00'))).toBe(false);
  });

  test('day-of-month is honoured', () => {
    expect(cronMatches('0 9 20 * *', at('2026-08-20T09:00:00'))).toBe(true);
    expect(cronMatches('0 9 21 * *', at('2026-08-20T09:00:00'))).toBe(false);
  });

  test('month is honoured (August = 8, not 7)', () => {
    expect(cronMatches('0 9 * 8 *', at('2026-08-20T09:00:00'))).toBe(true);
    expect(cronMatches('0 9 * 9 *', at('2026-08-20T09:00:00'))).toBe(false);
  });

  test('a malformed expression never fires — it must not throw either', () => {
    expect(cronMatches('not a cron', at('2026-08-20T09:00:00'))).toBe(false);
    expect(cronMatches('', at('2026-08-20T09:00:00'))).toBe(false);
    expect(cronMatches('* * *', at('2026-08-20T09:00:00'))).toBe(false);
  });

  test('seconds are ignored — a cron fires for the whole minute', () => {
    expect(cronMatches('30 9 * * *', at('2026-08-20T09:30:59'))).toBe(true);
  });
});

describe('nextMinute — the de-duplication key', () => {
  test('truncates to the minute so one cron fires once per minute', () => {
    expect(nextMinute(at('2026-08-20T09:30:11'))).toBe(nextMinute(at('2026-08-20T09:30:59')));
    expect(nextMinute(at('2026-08-20T09:30:00'))).not.toBe(nextMinute(at('2026-08-20T09:31:00')));
  });
});
