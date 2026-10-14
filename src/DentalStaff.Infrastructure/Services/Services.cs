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
        logger.LogInformation("SIMULATED EMAIL to {To}: {Subject} | {Body}", to, subject, body);
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
