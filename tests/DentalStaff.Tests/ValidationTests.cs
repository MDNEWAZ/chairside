using DentalStaff.Application.Common;
using DentalStaff.Domain.Rules;

namespace DentalStaff.Tests;

public class ValidationTests
{
    [Theory]
    [InlineData("maria@clinic.com")]
    [InlineData("first.last+tag@sub.clinic.co.uk")]
    [InlineData("o'brien@clinic.com")]
    public void Plain_addresses_are_valid_emails(string email) => Assert.True(Validator.IsValidEmail(email));

    [Theory]
    [InlineData("maria")]
    [InlineData("maria@clinic")]                       // no dotted domain
    [InlineData("Maria <maria@clinic.com>")]           // display name
    [InlineData("maria@@clinic.com")]
    [InlineData("maria@clinic..com")]
    [InlineData("maria@-clinic.com")]
    [InlineData("\"maria\"@clinic.com")]               // quoted local part
    [InlineData("maria@[127.0.0.1]")]                  // IP literal
    [InlineData("maria@clinic.com\nBcc: x@evil.com")]  // header injection
    [InlineData("maria @clinic.com")]
    public void Unusual_or_dangerous_addresses_are_rejected(string email) => Assert.False(Validator.IsValidEmail(email));

    [Fact]
    public void Text_rejects_control_and_bidirectional_override_characters()
    {
        var v = new Validator().Text("Maria‮admin", "firstName", "a first name", 60);
        Assert.Throws<ValidationException>(v.ThrowIfInvalid);
        new Validator().Text("Line one\nLine two", "note", "a note", 500, multiline: true).ThrowIfInvalid();
        Assert.Throws<ValidationException>(new Validator().Text("Line one\nLine two", "name", "a name", 500).ThrowIfInvalid);
    }

    [Theory]
    [InlineData("short")]                    // too short
    [InlineData("password123")]              // well known
    [InlineData("aaaaaaaaaaaa")]             // too few different characters
    [InlineData("maria@clinic.com")]         // the email itself
    public void Weak_passwords_are_rejected(string password)
    {
        var v = new Validator();
        PasswordPolicy.Validate(v, password, "maria@clinic.com");
        Assert.Throws<ValidationException>(v.ThrowIfInvalid);
    }

    [Fact]
    public void Passwords_longer_than_the_maximum_are_rejected()
    {
        var v = new Validator();
        PasswordPolicy.Validate(v, new string('x', 100) + "Yz1!" + new string('q', 40), null);
        Assert.Throws<ValidationException>(v.ThrowIfInvalid);
    }

    [Fact]
    public void A_short_phrase_is_a_good_password()
    {
        var v = new Validator();
        PasswordPolicy.Validate(v, "blue chair at noon", "maria@clinic.com");
        v.ThrowIfInvalid();
    }

    [Fact]
    public void Dates_outside_2000_to_2100_are_rejected()
    {
        Assert.Throws<ValidationException>(new Validator().Date(new DateOnly(1900, 1, 1), "d", "date").ThrowIfInvalid);
        new Validator().Date(new DateOnly(2026, 10, 15), "d", "date").ThrowIfInvalid();
    }
}

public class DaylightSavingTests
{
    private static readonly ClinicCalendar NewYork = new("America/New_York", DayOfWeek.Monday);

    [Fact]
    public void A_time_skipped_by_spring_forward_does_not_exist()
    {
        // 8 March 2026: clocks jump from 2:00 to 3:00.
        Assert.Throws<NonexistentLocalTimeException>(() => NewYork.ToUtc(new DateOnly(2026, 3, 8), new TimeOnly(2, 30)));
    }

    [Fact]
    public void A_repeated_fall_back_time_reads_as_the_first_daylight_occurrence()
    {
        // 1 November 2026: 1:30 happens twice; the first is EDT (UTC-4).
        var utc = NewYork.ToUtc(new DateOnly(2026, 11, 1), new TimeOnly(1, 30));
        Assert.Equal(new DateTime(2026, 11, 1, 5, 30, 0, DateTimeKind.Utc), utc);
    }

    [Fact]
    public void Ordinary_times_convert_with_the_zone_offset()
    {
        Assert.Equal(new DateTime(2026, 1, 15, 14, 0, 0, DateTimeKind.Utc), NewYork.ToUtc(new DateOnly(2026, 1, 15), new TimeOnly(9, 0)));
    }
}
