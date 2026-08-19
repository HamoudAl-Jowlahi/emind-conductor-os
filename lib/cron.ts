/**
 * Cron schedule helpers for agent jobs. Definitions live in SQLite; parsing
 * and description live here, and lib/scheduler.ts fires them.
 */
const FIELD_RE = /^(\*|[0-9*/,-]+)$/;

export function isValidCron(expr: string): boolean {
  const fields = expr.trim().split(/\s+/);
  return fields.length === 5 && fields.every((f) => FIELD_RE.test(f) && !/[a-z]/i.test(f));
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function dowLabel(field: string): string | null {
  if (field === '*') return 'daily';
  const range = field.match(/^(\d)-(\d)$/);
  if (range) {
    const [a, b] = [Number(range[1]), Number(range[2])];
    if (a <= 6 && b <= 6) return `${DOW[a]}–${DOW[b]}`;
  }
  if (/^\d$/.test(field) && Number(field) <= 6) return DOW[Number(field)];
  return field; // comma lists etc. shown raw
}

/** Human-readable summary, or null if the expression is not 5 valid fields. */
export function describeCron(expr: string): string | null {
  if (!isValidCron(expr)) return null;
  const [min, hour, , , dow] = expr.trim().split(/\s+/);

  const every = min.match(/^\*\/(\d+)$/);
  if (every && hour === '*') return `every ${every[1]} min`;

  if (/^\d+$/.test(min) && hour === '*') return `hourly at :${min.padStart(2, '0')}`;

  if (/^\d+$/.test(min) && /^\d+$/.test(hour)) {
    const time = `${hour.padStart(2, '0')}:${min.padStart(2, '0')}`;
    return `at ${time}, ${dowLabel(dow)}`;
  }

  return `cron ${expr}`;
}

/* ── Matching ──────────────────────────────────────────────────────────────
 * `isValidCron` and `describeCron` above only ever had to read a schedule.
 * These two decide whether one FIRES, which is what the runner needs.
 *
 * Standard five fields: minute hour day-of-month month day-of-week.
 * Each supports `*`, a number, a range `a-b`, a step (slash-n), and comma lists of
 * those. Times are read in LOCAL time, because a schedule a person typed means
 * their wall clock, not UTC.
 */

const RANGES: [number, number][] = [
  [0, 59], // minute
  [0, 23], // hour
  [1, 31], // day of month
  [1, 12], // month
  [0, 6], // day of week, Sunday = 0
];

/** Does one field accept `value`? Unparseable pieces simply do not match. */
function fieldMatches(field: string, value: number, min: number, max: number): boolean {
  return field.split(',').some((part) => {
    if (part === '*') return true;

    const step = part.match(/^\*\/(\d+)$/);
    if (step) {
      const n = Number(step[1]);
      return n > 0 && (value - min) % n === 0;
    }

    const stepped = part.match(/^(\d+)-(\d+)\/(\d+)$/);
    if (stepped) {
      const [a, b, n] = [Number(stepped[1]), Number(stepped[2]), Number(stepped[3])];
      return n > 0 && value >= a && value <= b && (value - a) % n === 0;
    }

    const range = part.match(/^(\d+)-(\d+)$/);
    if (range) {
      const [a, b] = [Number(range[1]), Number(range[2])];
      return a >= min && b <= max && value >= a && value <= b;
    }

    if (/^\d+$/.test(part)) return Number(part) === value;

    return false;
  });
}

/**
 * True when `expr` fires during the minute containing `date`. Seconds are
 * ignored: cron granularity is one minute, so 09:30:00 and 09:30:59 are the
 * same tick.
 */
export function cronMatches(expr: string, date: Date = new Date()): boolean {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) return false;

  const values = [
    date.getMinutes(),
    date.getHours(),
    date.getDate(),
    date.getMonth() + 1, // JS months are 0-based; cron months are not
    date.getDay(),
  ];

  return fields.every((f, i) => fieldMatches(f, values[i], RANGES[i][0], RANGES[i][1]));
}

/**
 * The minute a moment belongs to, as a stable key. The runner stores this
 * after firing so a tick that lands twice inside the same minute — two ticks,
 * a restart, a slow run — cannot fire the same schedule twice.
 */
export function nextMinute(date: Date = new Date()): string {
  const d = new Date(date);
  d.setSeconds(0, 0);
  return d.toISOString();
}
