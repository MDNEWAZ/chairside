using DentalStaff.Domain.Entities;
using Microsoft.EntityFrameworkCore;

namespace DentalStaff.Application.Common;

public interface IAppDbContext
{
    DbSet<Clinic> Clinics { get; }
    DbSet<UserAccount> UserAccounts { get; }
    DbSet<Location> Locations { get; }
    DbSet<JobTitle> JobTitles { get; }
    DbSet<Staff> Staff { get; }
    DbSet<Invitation> Invitations { get; }
    DbSet<ShiftDefinition> ShiftDefinitions { get; }
    DbSet<StaffWorkPattern> WorkPatterns { get; }
    DbSet<Shift> Shifts { get; }
    DbSet<ClosedDay> ClosedDays { get; }
    DbSet<CoverageRule> CoverageRules { get; }
    DbSet<CredentialType> CredentialTypes { get; }
    DbSet<CredentialTypeJobTitle> CredentialRequirements { get; }
    DbSet<Credential> Credentials { get; }
    DbSet<LeaveRequest> LeaveRequests { get; }
    DbSet<AttendanceRecord> Attendance { get; }
    DbSet<ScheduleOverride> ScheduleOverrides { get; }
    DbSet<Notification> Notifications { get; }
    DbSet<AuditLogEntry> AuditLog { get; }

    Task<int> SaveChangesAsync(CancellationToken cancellationToken = default);

    /// <summary>Sets ClockOutUtc from the database clock, never the device clock.</summary>
    Task<int> ClockOutAsync(int attendanceId, CancellationToken cancellationToken);

    Task<T> InTransactionAsync<T>(Func<Task<T>> work, CancellationToken cancellationToken);
}

/// <summary>
/// The tenant and user the database session runs as. Infrastructure copies these into
/// SESSION_CONTEXT whenever a connection opens, which is what row-level security reads.
/// </summary>
public interface ITenantContext
{
    Guid? ClinicId { get; }
    int? UserId { get; }
    void Set(Guid clinicId, int? userId);
}

/// <summary>The signed-in person, from the auth cookie.</summary>
public interface ICurrentUser
{
    bool IsAuthenticated { get; }
    Guid ClinicId { get; }
    int UserId { get; }
    int StaffId { get; }
    string Role { get; }
    int HomeLocationId { get; }
}

public interface IPasswordService
{
    string Hash(string password);
    bool Verify(string hash, string password);
}

/// <summary>Email delivery. Simulated in the prototype: messages are logged and returned to the UI.</summary>
public interface IEmailSender
{
    Task SendAsync(string to, string subject, string body, CancellationToken cancellationToken);
}

/// <summary>Product analytics events (name + properties). Logged in the prototype.</summary>
public interface IAnalytics
{
    void Track(string eventName, object? properties = null);
}

public interface IClock
{
    DateTime UtcNow { get; }
}
