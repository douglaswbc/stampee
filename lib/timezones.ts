const FALLBACK_TIME_ZONES = [
  'Africa/Cairo', 'Africa/Johannesburg', 'America/Anchorage', 'America/Argentina/Buenos_Aires',
  'America/Bogota', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'America/Mexico_City', 'America/New_York', 'America/Phoenix', 'America/Santiago',
  'America/Sao_Paulo', 'America/Toronto', 'America/Vancouver', 'Asia/Bangkok',
  'Asia/Dubai', 'Asia/Hong_Kong', 'Asia/Jakarta', 'Asia/Kolkata', 'Asia/Seoul',
  'Asia/Shanghai', 'Asia/Singapore', 'Asia/Tokyo', 'Australia/Melbourne', 'Australia/Sydney',
  'Europe/Amsterdam', 'Europe/Berlin', 'Europe/Lisbon', 'Europe/London', 'Europe/Madrid',
  'Europe/Moscow', 'Pacific/Auckland', 'UTC',
];

type TimeZoneIntl = typeof Intl & {
  supportedValuesOf?: (key: 'timeZone') => string[];
};

export const getBrowserTimeZone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
};

const formatterFor = (timeZone: string) => new Intl.DateTimeFormat('en-GB', {
  timeZone,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

const datePartsInTimeZone = (date: Date, timeZone: string) => {
  const parts = formatterFor(timeZone).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
  };
};

const wallTimeEpoch = (parts: ReturnType<typeof datePartsInTimeZone>) => Date.UTC(
  parts.year,
  parts.month - 1,
  parts.day,
  parts.hour,
  parts.minute,
  parts.second,
);

const timeZoneOffsetMinutes = (timeZone: string, instant: number): number => {
  const minute = Math.floor(instant / 60_000) * 60_000;
  return (wallTimeEpoch(datePartsInTimeZone(new Date(minute), timeZone)) - minute) / 60_000;
};

const offsetLabel = (timeZone: string): string => {
  try {
    const offset = timeZoneOffsetMinutes(timeZone, Date.now());
    const sign = offset >= 0 ? '+' : '-';
    const absolute = Math.abs(offset);
    return `UTC${sign}${String(Math.floor(absolute / 60)).padStart(2, '0')}:${String(absolute % 60).padStart(2, '0')}`;
  } catch {
    return 'UTC';
  }
};

export const getSupportedTimeZones = (): string[] => {
  let zones = FALLBACK_TIME_ZONES;
  try {
    const supportedValuesOf = (Intl as TimeZoneIntl).supportedValuesOf;
    if (supportedValuesOf) zones = supportedValuesOf('timeZone');
  } catch {
    // Keep the common-zone list for older browser engines.
  }

  return [...new Set(['UTC', ...zones, getBrowserTimeZone()])].sort((left, right) => left.localeCompare(right));
};

export const getTimeZoneOptionLabel = (timeZone: string): string => `${timeZone} (${offsetLabel(timeZone)})`;

export const formatDateTimeLocal = (instant: Date | string, timeZone: string): string => {
  const date = instant instanceof Date ? instant : new Date(instant);
  if (!Number.isFinite(date.getTime())) return '';
  try {
    const parts = datePartsInTimeZone(date, timeZone);
    return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}T${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`;
  } catch {
    return formatDateTimeLocal(date, getBrowserTimeZone());
  }
};

export const parseDateTimeLocal = (value: string, timeZone: string): Date | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;

  const [, yearText, monthText, dayText, hourText, minuteText] = match;
  const target = {
    year: Number(yearText),
    month: Number(monthText),
    day: Number(dayText),
    hour: Number(hourText),
    minute: Number(minuteText),
    second: 0,
  };
  const targetEpoch = wallTimeEpoch(target);
  const check = new Date(targetEpoch);
  if (check.getUTCFullYear() !== target.year || check.getUTCMonth() + 1 !== target.month
    || check.getUTCDate() !== target.day || target.hour > 23 || target.minute > 59) return null;

  try {
    let candidate = targetEpoch;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const rendered = datePartsInTimeZone(new Date(candidate), timeZone);
      const adjustment = targetEpoch - wallTimeEpoch(rendered);
      if (adjustment === 0) break;
      candidate += adjustment;
    }
    const resolved = datePartsInTimeZone(new Date(candidate), timeZone);
    if (resolved.year !== target.year || resolved.month !== target.month || resolved.day !== target.day
      || resolved.hour !== target.hour || resolved.minute !== target.minute) return null;
    return new Date(candidate);
  } catch {
    return null;
  }
};

export const formatDateInTimeZone = (instant: Date | string, locale: string, timeZone: string): string => {
  const date = instant instanceof Date ? instant : new Date(instant);
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(date);
  } catch {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: getBrowserTimeZone() }).format(date);
  }
};
