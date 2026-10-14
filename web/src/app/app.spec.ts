import { addDays, day, localParts, time } from './core/format';

// The formatters carry the "one format, clinic time zone" design rule, so they are tested directly.
describe('format', () => {
  it('formats calendar dates without shifting the day', () => {
    expect(day('2026-10-19')).toBe('Mon, Oct 19');
    expect(day('2026-12-31', true)).toBe('Thu, Dec 31, 2026');
  });

  it('formats clinic times as 12-hour', () => {
    expect(time('08:00:00')).toBe('8:00 AM');
    expect(time('12:30:00')).toBe('12:30 PM');
    expect(time('16:30:00')).toBe('4:30 PM');
    expect(time('00:15:00')).toBe('12:15 AM');
  });

  it('adds days across month ends', () => {
    expect(addDays('2026-10-30', 3)).toBe('2026-11-02');
  });

  it('converts a UTC instant to clinic-local parts, including daylight saving', () => {
    expect(localParts('2026-07-01T12:00:00Z', 'America/New_York')).toEqual(['2026-07-01', '08:00']);
    expect(localParts('2026-12-01T13:00:00Z', 'America/New_York')).toEqual(['2026-12-01', '08:00']);
    expect(localParts('2026-10-15T02:00:00Z', 'America/New_York')).toEqual(['2026-10-14', '22:00']);
  });
});
