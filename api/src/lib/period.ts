// Calendar periods for the weekly scratch game, in the business's time zone.
// Bogota is UTC-5 with no DST today, but nothing here assumes a fixed offset:
// wall-clock parts come from Intl and local midnights are converted back to
// UTC through the zone's offset at that instant.

export const GAME_TIME_ZONE = 'America/Bogota';

const DAY_MS = 24 * 60 * 60 * 1000;

const formatters = new Map<string, Intl.DateTimeFormat>();
const formatterFor = (timeZone: string) => {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, f);
  }
  return f;
};

interface WallClock {
  year: number;
  month: number; // 1..12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** Wall-clock date/time of `date` in `timeZone`. */
const wallClock = (date: Date, timeZone: string): WallClock => {
  const parts: Record<string, number> = {};
  for (const p of formatterFor(timeZone).formatToParts(date)) {
    if (p.type !== 'literal') parts[p.type] = Number(p.value);
  }
  return {
    year: parts['year']!,
    month: parts['month']!,
    day: parts['day']!,
    hour: parts['hour']! % 24,
    minute: parts['minute']!,
    second: parts['second']!,
  };
};

/** Offset (ms) to add to UTC to get wall-clock time in `timeZone` at `date`. */
const zoneOffsetMs = (date: Date, timeZone: string): number => {
  const w = wallClock(date, timeZone);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
};

/** The UTC instant of local 00:00 on year-month-day in `timeZone`. */
const zonedMidnight = (year: number, month: number, day: number, timeZone: string): Date => {
  const naive = Date.UTC(year, month - 1, day);
  // Two passes settle the offset even if it changes around that midnight.
  let t = naive - zoneOffsetMs(new Date(naive), timeZone);
  t = naive - zoneOffsetMs(new Date(t), timeZone);
  return new Date(t);
};

/** Local calendar day of `date` as a UTC-midnight Date (for pure date math). */
const localDay = (date: Date, timeZone: string): Date => {
  const w = wallClock(date, timeZone);
  return new Date(Date.UTC(w.year, w.month - 1, w.day));
};

/** 0 = Monday … 6 = Sunday. */
const isoWeekday = (day: Date) => (day.getUTCDay() + 6) % 7;

/** ISO-8601 week key, e.g. '2026-W44'. Weeks start Monday 00:00 local time. */
export const isoWeekKey = (date: Date, timeZone = GAME_TIME_ZONE): string => {
  const day = localDay(date, timeZone);
  // The ISO year is the year of the week's Thursday.
  const thursday = new Date(day.getTime() + (3 - isoWeekday(day)) * DAY_MS);
  const isoYear = thursday.getUTCFullYear();
  const week = Math.floor((thursday.getTime() - Date.UTC(isoYear, 0, 1)) / DAY_MS / 7) + 1;
  return `${isoYear}-W${String(week).padStart(2, '0')}`;
};

/** Next Monday 00:00 local time (strictly after `date`'s week start). */
export const nextWeekStart = (date: Date, timeZone = GAME_TIME_ZONE): Date => {
  const day = localDay(date, timeZone);
  const monday = new Date(day.getTime() + (7 - isoWeekday(day)) * DAY_MS);
  return zonedMidnight(monday.getUTCFullYear(), monday.getUTCMonth() + 1, monday.getUTCDate(), timeZone);
};

/** First day of `date`'s local month at 00:00 local time. */
export const monthStart = (date: Date, timeZone = GAME_TIME_ZONE): Date => {
  const w = wallClock(date, timeZone);
  return zonedMidnight(w.year, w.month, 1, timeZone);
};
