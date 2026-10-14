namespace DentalStaff.Domain.Rules;

/// <summary>
/// Counts leave days per docs/decisions.md D2: a day counts when the person works it (published
/// shift, else work pattern), never on a closed day, and half days count 0.5.
/// </summary>
public static class LeaveDayCounter
{
    public static decimal Count(
        DateOnly start,
        DateOnly end,
        bool firstDayHalf,
        bool lastDayHalf,
        Func<DateOnly, bool> worksOn,
        Func<DateOnly, bool> isClosed)
    {
        if (end < start) throw new ArgumentException("End date must be on or after the start date.");

        decimal total = 0;
        for (var date = start; date <= end; date = date.AddDays(1))
        {
            if (isClosed(date) || !worksOn(date)) continue;

            var isHalf = (date == start && firstDayHalf) || (date == end && lastDayHalf);
            total += isHalf ? 0.5m : 1m;
        }
        return total;
    }
}
