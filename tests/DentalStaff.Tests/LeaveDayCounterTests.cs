using DentalStaff.Domain.Rules;

namespace DentalStaff.Tests;

public class LeaveDayCounterTests
{
    // Mon 2026-10-19 .. Sun 2026-10-25
    private static readonly DateOnly Mon = new(2026, 10, 19);

    private static bool Weekdays(DateOnly d) => d.DayOfWeek is not (DayOfWeek.Saturday or DayOfWeek.Sunday);
    private static bool NeverClosed(DateOnly _) => false;

    [Fact]
    public void Full_week_counts_only_working_days()
    {
        Assert.Equal(5m, LeaveDayCounter.Count(Mon, Mon.AddDays(6), false, false, Weekdays, NeverClosed));
    }

    [Fact]
    public void Part_time_pattern_counts_only_pattern_days()
    {
        bool MonWedThu(DateOnly d) => d.DayOfWeek is DayOfWeek.Monday or DayOfWeek.Wednesday or DayOfWeek.Thursday;
        Assert.Equal(3m, LeaveDayCounter.Count(Mon, Mon.AddDays(6), false, false, MonWedThu, NeverClosed));
    }

    [Fact]
    public void Closed_day_is_not_deducted()
    {
        Assert.Equal(4m, LeaveDayCounter.Count(Mon, Mon.AddDays(4), false, false, Weekdays, d => d == Mon.AddDays(2)));
    }

    [Fact]
    public void Half_days_on_first_and_last_day_count_half()
    {
        Assert.Equal(2m, LeaveDayCounter.Count(Mon, Mon.AddDays(2), true, true, Weekdays, NeverClosed));
    }

    [Fact]
    public void Single_half_day_counts_half()
    {
        Assert.Equal(0.5m, LeaveDayCounter.Count(Mon, Mon, true, false, Weekdays, NeverClosed));
    }

    [Fact]
    public void Half_day_on_a_non_working_day_counts_nothing()
    {
        var sat = Mon.AddDays(5);
        Assert.Equal(0m, LeaveDayCounter.Count(sat, sat, true, false, Weekdays, NeverClosed));
    }

    [Fact]
    public void End_before_start_is_rejected()
    {
        Assert.Throws<ArgumentException>(() => LeaveDayCounter.Count(Mon, Mon.AddDays(-1), false, false, Weekdays, NeverClosed));
    }
}
