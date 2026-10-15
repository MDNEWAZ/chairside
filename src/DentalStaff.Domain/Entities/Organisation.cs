namespace DentalStaff.Domain.Entities;

/// <summary>A tenant: one dental practice with one or more locations.</summary>
public class Clinic
{
    public Guid ClinicId { get; set; }
    public string Name { get; set; } = "";
    public string TimeZoneId { get; set; } = "America/New_York";
    public DayOfWeek WorkweekStart { get; set; } = DayOfWeek.Monday;
    public decimal OvertimeThresholdHours { get; set; } = 40;
    public int DefaultBreakMinutes { get; set; } = 30;
    public decimal LeaveAllowanceDays { get; set; } = 15;
    public string PlanCode { get; set; } = Plans.Trial;
    public DateTime TrialEndsUtc { get; set; }
    public bool IsDemo { get; set; }
    public DateTime CreatedAtUtc { get; set; }
}

public class UserAccount
{
    public int UserId { get; set; }
    public Guid ClinicId { get; set; }
    public string Email { get; set; } = "";
    public string PasswordHash { get; set; } = "";
    public DateTime? LastLoginUtc { get; set; }
    /// <summary>Changed to sign the person out everywhere (logout, deactivation).</summary>
    public Guid SecurityStamp { get; set; } = Guid.NewGuid();
}

public class Location
{
    public int LocationId { get; set; }
    public Guid ClinicId { get; set; }
    public string Name { get; set; } = "";
    public string? Address { get; set; }
    public bool IsActive { get; set; } = true;
}

public class JobTitle
{
    public int JobTitleId { get; set; }
    public Guid ClinicId { get; set; }
    public string Name { get; set; } = "";
    public string Role { get; set; } = Roles.ClinicalStaff;
}

public class Staff
{
    public int StaffId { get; set; }
    public Guid ClinicId { get; set; }
    public int? UserId { get; set; }
    public string FirstName { get; set; } = "";
    public string LastName { get; set; } = "";
    public string Email { get; set; } = "";
    public string? Phone { get; set; }
    public string Role { get; set; } = Roles.ClinicalStaff;
    public int JobTitleId { get; set; }
    public int HomeLocationId { get; set; }
    public DateOnly StartDate { get; set; }
    public bool IsActive { get; set; } = true;
    public bool OvertimeEligible { get; set; } = true;
    public string EmploymentType { get; set; } = "full_time";

    public string FullName => $"{FirstName} {LastName}";
}

public class Invitation
{
    public int InvitationId { get; set; }
    public Guid ClinicId { get; set; }
    public int StaffId { get; set; }
    public string TokenHash { get; set; } = "";
    public DateTime ExpiresUtc { get; set; }
    public DateTime? AcceptedUtc { get; set; }
    /// <summary>The address the link was sent to; accepting requires it to still be the person's email.</summary>
    public string? Email { get; set; }
    public DateTime? RevokedUtc { get; set; }
}

public class Notification
{
    public int NotificationId { get; set; }
    public Guid ClinicId { get; set; }
    public int RecipientStaffId { get; set; }
    public string Type { get; set; } = "";
    public string Message { get; set; } = "";
    public bool IsRead { get; set; }
    public DateTime CreatedAtUtc { get; set; }
}

public class AuditLogEntry
{
    public long AuditId { get; set; }
    public Guid ClinicId { get; set; }
    public DateTime AtUtc { get; set; }
    public int? UserId { get; set; }
    public string Action { get; set; } = "";
    public string EntityName { get; set; } = "";
    public string EntityId { get; set; } = "";
    public string? OldValue { get; set; }
    public string? NewValue { get; set; }
}
