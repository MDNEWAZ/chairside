using DentalStaff.Application.Common;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.Logging;

namespace DentalStaff.Infrastructure.Services;

/// <summary>PBKDF2 hashing from ASP.NET Core Identity (versioned format, safe to upgrade later).</summary>
public sealed class PasswordService : IPasswordService
{
    private static readonly PasswordHasher<object> Hasher = new();
    private static readonly object User = new();

    public string Hash(string password) => Hasher.HashPassword(User, password);

    public bool Verify(string hash, string password) =>
        Hasher.VerifyHashedPassword(User, hash, password) != PasswordVerificationResult.Failed;
}

/// <summary>Simulated delivery: writes the email to the log. Swap for a real provider (SendGrid, ACS) in production.</summary>
public sealed class SimulatedEmailSender(ILogger<SimulatedEmailSender> logger) : IEmailSender
{
    public Task SendAsync(string to, string subject, string body, CancellationToken cancellationToken)
    {
        // Never log a full address or a sign-in link: logs are read by more people than the inbox is.
        var at = to.IndexOf('@');
        var maskedTo = at > 1 ? to[0] + new string('*', at - 1) + to[at..] : "***";
        var safeBody = System.Text.RegularExpressions.Regex.Replace(body, @"/invite/[A-Za-z0-9_-]+", "/invite/[redacted]");
        logger.LogInformation("SIMULATED EMAIL to {To}: {Subject} | {Body}", maskedTo, subject, safeBody);
        return Task.CompletedTask;
    }
}

public sealed class LoggingAnalytics(ILogger<LoggingAnalytics> logger) : IAnalytics
{
    public void Track(string eventName, object? properties = null) =>
        logger.LogInformation("analytics_event {Event} {@Properties}", eventName, properties);
}

public sealed class SystemClock : IClock
{
    public DateTime UtcNow => DateTime.UtcNow;
}
