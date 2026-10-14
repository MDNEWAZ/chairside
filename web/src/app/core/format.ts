// One date and time format everywhere, in the clinic's time zone (design rules: "Mon, Oct 12" and "9:00 AM").

/** "2026-10-12" (a calendar date with no zone) -> "Mon, Oct 12". */
export function day(isoDate: string, withYear = false): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: withYear ? 'numeric' : undefined, timeZone: 'UTC',
  }).format(new Date(isoDate + 'T00:00:00Z'));
}

export function weekdayShort(isoDate: string): string {
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' }).format(new Date(isoDate + 'T00:00:00Z'));
}

export function monthDay(isoDate: string): string {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(isoDate + 'T00:00:00Z'));
}

/** "08:00:00" (a local clinic time) -> "8:00 AM". */
export function time(t: string): string {
  const [h, m] = t.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

/** A UTC instant shown in the clinic zone. */
export function instant(utc: string, zone: string, withDate = false): string {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric', minute: '2-digit', weekday: withDate ? 'short' : undefined, month: withDate ? 'short' : undefined, day: withDate ? 'numeric' : undefined, timeZone: zone,
  }).format(new Date(utc));
}

/** A UTC instant's clinic-local date and time, for form inputs: ["2026-10-14", "08:05"]. */
export function localParts(utc: string, zone: string): [string, string] {
  const parts = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: zone })
    .formatToParts(new Date(utc));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return [`${get('year')}-${get('month')}-${get('day')}`, `${get('hour')}:${get('minute')}`];
}

export function hours(h: number | null | undefined): string {
  return h == null ? '—' : `${Number(h.toFixed(2))} h`;
}

export function addDays(isoDate: string, n: number): string {
  const d = new Date(isoDate + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Today's date in the clinic zone. */
export function todayIn(zone: string): string {
  return localParts(new Date().toISOString(), zone)[0];
}

export function toHHmm(t: string): string {
  return t.slice(0, 5);
}

/** Compact clinic time for dense grids: "08:00:00" -> "8a", "16:30:00" -> "4:30p". Full times stay in the accessible name. */
export function compactTime(t: string): string {
  const [h, m] = t.split(':').map(Number);
  return `${((h + 11) % 12) + 1}${m ? ':' + String(m).padStart(2, '0') : ''}${h < 12 ? 'a' : 'p'}`;
}
