namespace DentalStaff.Domain.Rules;

/// <summary>Converts between UTC instants and the clinic's single time zone, and finds workweek starts.</summary>
public sealed class ClinicCalendar(string timeZoneId, DayOfWeek workweekStart)
{
    private readonly TimeZoneInfo _zone = TimeZoneInfo.FindSystemTimeZoneById(timeZoneId);

    public DayOfWeek WorkweekStart { get; } = workweekStart;

    public DateTime ToLocal(DateTime utc) => TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(utc, DateTimeKind.Utc), _zone);

    /// <summary>
    /// Clinic-local date and time to UTC. A time skipped by a daylight-saving jump does not exist and throws
    /// <see cref="NonexistentLocalTimeException"/>; a repeated (ambiguous) time is read as the first, daylight occurrence.
    /// </summary>
    public DateTime ToUtc(DateOnly date, TimeOnly time)
    {
        var local = date.ToDateTime(time, DateTimeKind.Unspecified);
        if (_zone.IsInvalidTime(local)) throw new NonexistentLocalTimeException(date, time);
        if (_zone.IsAmbiguousTime(local))
        {
            var daylight = _zone.GetAmbiguousTimeOffsets(local).Max();
            return DateTime.SpecifyKind(local - daylight, DateTimeKind.Utc);
        }
        return TimeZoneInfo.ConvertTimeToUtc(local, _zone);
    }

    public DateOnly Today(DateTime utcNow) => DateOnly.FromDateTime(ToLocal(utcNow));

    public DateOnly WeekStartFor(DateOnly date)
    {
        var diff = ((int)date.DayOfWeek - (int)WorkweekStart + 7) % 7;
        return date.AddDays(-diff);
    }

    public static bool IsValidZone(string timeZoneId) =>
        TimeZoneInfo.TryFindSystemTimeZoneById(timeZoneId, out _);
}

public sealed class NonexistentLocalTimeException(DateOnly date, TimeOnly time)
    : Exception($"{time:HH:mm} does not exist on {date:yyyy-MM-dd}: the clocks moved forward.");

/// <summary>US federal holidays, used to prefill a clinic's closed days.</summary>
public static class UsFederalHolidays
{
    public static IEnumerable<(DateOnly Date, string Name)> For(int year)
    {
        yield return (Observed(new DateOnly(year, 1, 1)), "New Year's Day");
        yield return (Nth(year, 1, DayOfWeek.Monday, 3), "Martin Luther King Jr. Day");
        yield return (Nth(year, 2, DayOfWeek.Monday, 3), "Washington's Birthday");
        yield return (Last(year, 5, DayOfWeek.Monday), "Memorial Day");
        yield return (Observed(new DateOnly(year, 6, 19)), "Juneteenth");
        yield return (Observed(new DateOnly(year, 7, 4)), "Independence Day");
        yield return (Nth(year, 9, DayOfWeek.Monday, 1), "Labor Day");
        yield return (Nth(year, 10, DayOfWeek.Monday, 2), "Columbus Day");
        yield return (Observed(new DateOnly(year, 11, 11)), "Veterans Day");
        yield return (Nth(year, 11, DayOfWeek.Thursday, 4), "Thanksgiving Day");
        yield return (Observed(new DateOnly(year, 12, 25)), "Christmas Day");
    }

    private static DateOnly Nth(int year, int month, DayOfWeek day, int n)
    {
        var first = new DateOnly(year, month, 1);
        var offset = ((int)day - (int)first.DayOfWeek + 7) % 7;
        return first.AddDays(offset + 7 * (n - 1));
    }

    private static DateOnly Last(int year, int month, DayOfWeek day)
    {
        var last = new DateOnly(year, month, DateTime.DaysInMonth(year, month));
        return last.AddDays(-(((int)last.DayOfWeek - (int)day + 7) % 7));
    }

    // A holiday on Saturday is observed Friday; on Sunday, Monday.
    private static DateOnly Observed(DateOnly date) => date.DayOfWeek switch
    {
        DayOfWeek.Saturday => date.AddDays(-1),
        DayOfWeek.Sunday => date.AddDays(1),
        _ => date,
    };
}
