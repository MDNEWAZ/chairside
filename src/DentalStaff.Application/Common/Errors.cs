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
public sealed class Validator
{
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

    public Validator Text(string? value, string field, string label, int max, bool required = true)
    {
        if (string.IsNullOrWhiteSpace(value))
            return Require(!required, field, $"Enter {label}.");
        return Require(value.Trim().Length <= max, field, $"{Capitalise(label)} must be {max} characters or fewer.");
    }

    public Validator Email(string? value, string field)
    {
        Text(value, field, "an email address", 256);
        if (!string.IsNullOrWhiteSpace(value))
            Require(System.Net.Mail.MailAddress.TryCreate(value.Trim(), out _) && value.Contains('.'), field, "Enter a valid email address, like name@clinic.com.");
        return this;
    }

    public void ThrowIfInvalid()
    {
        if (_errors.Count > 0)
            throw new ValidationException(_errors.ToDictionary(e => e.Key, e => e.Value.ToArray()));
    }

    private static string Capitalise(string s) => s.Length == 0 ? s : char.ToUpperInvariant(s[0]) + s[1..];
}
