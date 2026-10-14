using DentalStaff.Domain.Rules;

namespace DentalStaff.Tests;

public class CalendarTests
{
    [Theory]
    [InlineData(2026, 11, 26, "Thanksgiving Day")]
    [InlineData(2026, 5, 25, "Memorial Day")]
    [InlineData(2026, 7, 3, "Independence Day")] // July 4 2026 is a Saturday: observed Friday
    [InlineData(2027, 12, 24, "Christmas Day")]   // Dec 25 2027 is a Saturday
    public void Federal_holidays_use_observed_dates(int y, int m, int d, string name)
    {
        Assert.Contains(UsFederalHolidays.For(y), h => h.Date == new DateOnly(y, m, d) && h.Name == name);
    }

    [Fact]
    public void Week_start_follows_the_clinic_setting()
    {
        var wed = new DateOnly(2026, 10, 14);
        Assert.Equal(new DateOnly(2026, 10, 12), new ClinicCalendar("America/New_York", DayOfWeek.Monday).WeekStartFor(wed));
        Assert.Equal(new DateOnly(2026, 10, 11), new ClinicCalendar("America/New_York", DayOfWeek.Sunday).WeekStartFor(wed));
    }

    [Fact]
    public void Local_times_convert_through_daylight_saving()
    {
        var cal = new ClinicCalendar("America/New_York", DayOfWeek.Monday);
        Assert.Equal(new DateTime(2026, 7, 1, 12, 0, 0), cal.ToUtc(new DateOnly(2026, 7, 1), new TimeOnly(8, 0)));  // EDT, UTC-4
        Assert.Equal(new DateTime(2026, 12, 1, 13, 0, 0), cal.ToUtc(new DateOnly(2026, 12, 1), new TimeOnly(8, 0))); // EST, UTC-5
    }

    [Fact]
    public void Today_is_in_the_clinic_zone_not_utc()
    {
        var cal = new ClinicCalendar("America/New_York", DayOfWeek.Monday);
        // 02:00 UTC on the 15th is still the evening of the 14th in New York.
        Assert.Equal(new DateOnly(2026, 10, 14), cal.Today(new DateTime(2026, 10, 15, 2, 0, 0, DateTimeKind.Utc)));
    }
}
