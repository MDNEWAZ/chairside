using System.Text;
using System.Text.RegularExpressions;

namespace DentalStaff.Application.Common;

/// <summary>Base for expected failures. The API maps each type to a ProblemDetails status code.</summary>
public abstract class AppException(string message) : Exception(message);

public sealed class NotFoundException(string message) : AppException(message);

public sealed class ForbiddenException(string message = "You do not have access to this.") : AppException(message);

public sealed class ConflictException(string message, object? details = null) : AppException(message)
{
    public object? Details { get; } = details;
}

/// <summary>Field-level validation failure. Keys are camelCase field names the UI ties errors to.</summary>
public sealed class ValidationException(IDictionary<string, string[]> errors)
    : AppException("Some fields need attention.")
{
    public IDictionary<string, string[]> Errors { get; } = errors;

    public static ValidationException For(string field, string message) => new(new Dictionary<string, string[]> { [field] = [message] });
}

/// <summary>Collects field errors and throws once, so the UI can show them all together.</summary>
public sealed partial class Validator
{
    public static readonly DateOnly EarliestDate = new(2000, 1, 1);
    public static readonly DateOnly LatestDate = new(2100, 12, 31);

    private readonly Dictionary<string, List<string>> _errors = new();

    public Validator Require(bool condition, string field, string message)
    {
        if (!condition)
        {
            if (!_errors.TryGetValue(field, out var list)) _errors[field] = list = [];
            list.Add(message);
        }
        return this;
    }

    /// <summary>
    /// Plain text: required (unless optional), within the column length, and free of control and bidirectional
    /// override characters that can disguise names in lists and notifications. Line breaks are allowed only in multi-line notes.
    /// </summary>
    public Validator Text(string? value, string field, string label, int max, bool required = true, bool multiline = false)
    {
        if (string.IsNullOrWhiteSpace(value))
            return Require(!required, field, $"Enter {label}.");
        Require(value.Trim().Length <= max, field, $"{Capitalise(label)} must be {max} characters or fewer.");
        return Require(!HasUnsafeCharacters(value, multiline), field, $"{Capitalise(label)} contains characters that cannot be used.");
    }

    public Validator Email(string? value, string field)
    {
        Text(value, field, "an email address", 256);
        if (!string.IsNullOrWhiteSpace(value))
            Require(IsValidEmail(value), field, "Enter a valid email address, like name@clinic.com.");
        return this;
    }

    public Validator Date(DateOnly value, string field, string label) =>
        Require(value >= EarliestDate && value <= LatestDate, field, $"Enter a {label} between 2000 and 2100.");

    public void ThrowIfInvalid()
    {
        if (_errors.Count > 0)
            throw new ValidationException(_errors.ToDictionary(e => e.Key, e => e.Value.ToArray()));
    }

    /// <summary>A plain local@domain address: no display names, quotes, comments or IP literals, and a dotted domain.</summary>
    public static bool IsValidEmail(string value)
    {
        var v = value.Trim().Normalize(NormalizationForm.FormKC);
        return v.Length <= 256 && EmailPattern().IsMatch(v)
               && System.Net.Mail.MailAddress.TryCreate(v, out var parsed) && parsed.Address == v && parsed.DisplayName.Length == 0;
    }

    private static bool HasUnsafeCharacters(string value, bool multiline) =>
        value.Any(c => (char.IsControl(c) && !(multiline && c is '\n' or '\r' or '\t'))
                       || c is '‪' or '‫' or '‬' or '‭' or '‮' or '⁦' or '⁧' or '⁨' or '⁩' or '‎' or '‏');

    [GeneratedRegex(@"^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$")]
    private static partial Regex EmailPattern();

    private static string Capitalise(string s) => s.Length == 0 ? s : char.ToUpperInvariant(s[0]) + s[1..];
}

/// <summary>Password rules: length 10–128, not a well-known password, and not the email address.</summary>
public static class PasswordPolicy
{
    public const int MinLength = 10;
    public const int MaxLength = 128;

    // The most common passwords that meet the length rule (from public breach lists). Short list on purpose:
    // the length rule already removes most of the top 10,000.
    private static readonly HashSet<string> Common = new(StringComparer.OrdinalIgnoreCase)
    {
        "1234567890", "12345678910", "0123456789", "123456789a", "1q2w3e4r5t", "1qaz2wsx3edc", "qwertyuiop", "qwerty1234",
        "qwerty12345", "password12", "password123", "password1!", "Password123!", "passw0rd123", "iloveyou12", "abcdefghij",
        "abc1234567", "aaaaaaaaaa", "1111111111", "0000000000", "zaq12wsxcde", "letmein123", "welcome123", "admin12345",
        "administrator", "changeme123", "dentist123", "dental1234", "chairside1", "chairside123", "football123", "baseball123",
        "princess123", "sunshine123", "starwars123", "trustno1234", "monkey12345", "dragon12345", "michael123", "superman123",
    };

    public static void Validate(Validator v, string? password, string? email, string field = "password")
    {
        var p = password ?? "";
        v.Require(p.Length >= MinLength, field, $"Use at least {MinLength} characters.")
         .Require(p.Length <= MaxLength, field, $"Use {MaxLength} characters or fewer.");
        if (p.Length is >= MinLength and <= MaxLength)
        {
            v.Require(!Common.Contains(p) && p.Distinct().Count() > 3, field, "This password is too easy to guess. Try a short phrase.");
            v.Require(string.IsNullOrEmpty(email) || !string.Equals(p.Trim(), email.Trim(), StringComparison.OrdinalIgnoreCase), field, "Do not use your email address as your password.");
        }
    }
}
