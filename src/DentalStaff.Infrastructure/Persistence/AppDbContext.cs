using DentalStaff.Application.Common;
using DentalStaff.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace DentalStaff.Infrastructure.Persistence;

/// <summary>
/// EF Core is used for data access only. The schema, row-level security and audit triggers are
/// owned by the SQL scripts in database/DentalStaff.DbMigrator/Scripts.
/// </summary>
public sealed class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options), IAppDbContext
{
    public DbSet<Clinic> Clinics => Set<Clinic>();
    public DbSet<UserAccount> UserAccounts => Set<UserAccount>();
    public DbSet<Location> Locations => Set<Location>();
    public DbSet<JobTitle> JobTitles => Set<JobTitle>();
    public DbSet<Staff> Staff => Set<Staff>();
    public DbSet<Invitation> Invitations => Set<Invitation>();
    public DbSet<ShiftDefinition> ShiftDefinitions => Set<ShiftDefinition>();
    public DbSet<StaffWorkPattern> WorkPatterns => Set<StaffWorkPattern>();
    public DbSet<Shift> Shifts => Set<Shift>();
    public DbSet<ClosedDay> ClosedDays => Set<ClosedDay>();
    public DbSet<CoverageRule> CoverageRules => Set<CoverageRule>();
    public DbSet<CredentialType> CredentialTypes => Set<CredentialType>();
    public DbSet<CredentialTypeJobTitle> CredentialRequirements => Set<CredentialTypeJobTitle>();
    public DbSet<Credential> Credentials => Set<Credential>();
    public DbSet<LeaveRequest> LeaveRequests => Set<LeaveRequest>();
    public DbSet<AttendanceRecord> Attendance => Set<AttendanceRecord>();
    public DbSet<ScheduleOverride> ScheduleOverrides => Set<ScheduleOverride>();
    public DbSet<Notification> Notifications => Set<Notification>();
    public DbSet<AuditLogEntry> AuditLog => Set<AuditLogEntry>();

    public Task<int> ClockOutAsync(int attendanceId, CancellationToken cancellationToken) =>
        Database.ExecuteSqlInterpolatedAsync(
            $"UPDATE app.AttendanceRecord SET ClockOutUtc = SYSUTCDATETIME() WHERE AttendanceId = {attendanceId} AND ClockOutUtc IS NULL",
            cancellationToken);

    public Task<T> InTransactionAsync<T>(Func<Task<T>> work, CancellationToken cancellationToken) =>
        // Retry-on-failure needs the whole transaction wrapped in the execution strategy.
        Database.CreateExecutionStrategy().ExecuteAsync(async () =>
        {
            await using var tx = await Database.BeginTransactionAsync(cancellationToken);
            var result = await work();
            await tx.CommitAsync(cancellationToken);
            return result;
        });

    protected override void ConfigureConventions(ModelConfigurationBuilder configurationBuilder)
    {
        // Every DateTime in the database is UTC; mark it so JSON carries the "Z" and clients convert correctly.
        configurationBuilder.Properties<DateTime>().HaveConversion<UtcConverter>();
        configurationBuilder.Properties<DateTime?>().HaveConversion<UtcConverter>();
        configurationBuilder.Properties<string>().AreUnicode();
    }

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.HasDefaultSchema("app");

        b.Entity<Clinic>(e =>
        {
            e.ToTable("Clinic", t => t.HasTrigger("trg_Clinic_Audit"));
            e.Property(x => x.WorkweekStart).HasConversion<byte>();
            e.Property(x => x.OvertimeThresholdHours).HasPrecision(5, 2);
            e.Property(x => x.LeaveAllowanceDays).HasPrecision(5, 1);
            e.Property(x => x.CreatedAtUtc).HasDefaultValueSql("SYSUTCDATETIME()").ValueGeneratedOnAdd();
        });
        b.Entity<UserAccount>(e => e.ToTable("UserAccount").HasKey(x => x.UserId));
        b.Entity<Location>(e => e.ToTable("Location", t => t.HasTrigger("trg_Location_Audit")));
        b.Entity<JobTitle>().ToTable("JobTitle");
        b.Entity<Staff>(e =>
        {
            e.ToTable("Staff", t => t.HasTrigger("trg_Staff_Audit"));
            e.Ignore(x => x.FullName);
        });
        b.Entity<Invitation>(e =>
        {
            e.ToTable("Invitation");
            e.Property(x => x.TokenHash).IsUnicode(false).IsFixedLength().HasMaxLength(64);
        });
        b.Entity<ShiftDefinition>().ToTable("ShiftDefinition");
        b.Entity<StaffWorkPattern>(e =>
        {
            e.ToTable("StaffWorkPattern", t => t.HasTrigger("trg_StaffWorkPattern_Audit"));
            e.HasKey(x => x.PatternId);
            e.HasMany(x => x.Days).WithOne().HasForeignKey(d => d.PatternId).OnDelete(DeleteBehavior.Cascade);
        });
        b.Entity<StaffWorkPatternDay>(e =>
        {
            e.ToTable("StaffWorkPatternDay");
            e.HasKey(x => x.PatternDayId);
            e.Property(x => x.Weekday).HasConversion<byte>();
        });
        b.Entity<Shift>(e =>
        {
            e.ToTable("Shift", t => t.HasTrigger("trg_Shift_Audit"));
            e.Ignore(x => x.PaidHours);
        });
        b.Entity<ClosedDay>(e => e.ToTable("ClosedDay", t => t.HasTrigger("trg_ClosedDay_Audit")));
        b.Entity<CoverageRule>(e =>
        {
            e.ToTable("CoverageRule", t => t.HasTrigger("trg_CoverageRule_Audit"));
            e.Property(x => x.Weekday).HasConversion<byte>();
        });
        b.Entity<CredentialType>().ToTable("CredentialType");
        b.Entity<CredentialTypeJobTitle>(e => e.ToTable("CredentialTypeJobTitle").HasKey(x => new { x.CredentialTypeId, x.JobTitleId }));
        b.Entity<Credential>(e => e.ToTable("Credential", t => t.HasTrigger("trg_Credential_Audit")));
        b.Entity<LeaveRequest>(e =>
        {
            e.ToTable("LeaveRequest", t => t.HasTrigger("trg_LeaveRequest_Audit"));
            e.Property(x => x.DaysCounted).HasPrecision(4, 1);
        });
        b.Entity<AttendanceRecord>(e =>
        {
            e.ToTable("AttendanceRecord", t => t.HasTrigger("trg_AttendanceRecord_Audit"));
            e.HasKey(x => x.AttendanceId);
            e.Property(x => x.ClockInUtc).HasDefaultValueSql("SYSUTCDATETIME()").ValueGeneratedOnAdd();
            e.Ignore(x => x.PaidHours);
        });
        b.Entity<ScheduleOverride>(e =>
        {
            e.ToTable("ScheduleOverride", t => t.HasTrigger("trg_ScheduleOverride_Audit"));
            e.HasKey(x => x.OverrideId);
            e.Property(x => x.OverriddenAtUtc).HasDefaultValueSql("SYSUTCDATETIME()").ValueGeneratedOnAdd();
        });
        b.Entity<Notification>(e =>
        {
            e.ToTable("Notification");
            e.Property(x => x.CreatedAtUtc).HasDefaultValueSql("SYSUTCDATETIME()").ValueGeneratedOnAdd();
        });
        b.Entity<AuditLogEntry>(e =>
        {
            e.ToTable("AuditLogEntry", "audit");
            e.HasKey(x => x.AuditId);
        });
    }

    private sealed class UtcConverter() : ValueConverter<DateTime, DateTime>(
        v => v.Kind == DateTimeKind.Utc ? v : v.ToUniversalTime(),
        v => DateTime.SpecifyKind(v, DateTimeKind.Utc));
}
