namespace DentalStaff.Domain.Entities;

public class ShiftDefinition
{
    public int ShiftDefinitionId { get; set; }
    public Guid ClinicId { get; set; }
    public string Name { get; set; } = "";
    public TimeOnly StartTime { get; set; }
    public TimeOnly EndTime { get; set; }
    public int? UnpaidBreakMinutes { get; set; }
}

/// <summary>One version of a person's regular week. A change adds a new version (docs/decisions.md D2).</summary>
public class StaffWorkPattern
{
    public int PatternId { get; set; }
    public Guid ClinicId { get; set; }
    public int StaffId { get; set; }
    public DateOnly EffectiveFrom { get; set; }
    public List<StaffWorkPatternDay> Days { get; set; } = [];
}

public class StaffWorkPatternDay
{
    public int PatternDayId { get; set; }
    public Guid ClinicId { get; set; }
    public int PatternId { get; set; }
    public DayOfWeek Weekday { get; set; }
    public int ShiftDefinitionId { get; set; }
    public int LocationId { get; set; }
}

public class Shift
{
    public int ShiftId { get; set; }
    public Guid ClinicId { get; set; }
    public int StaffId { get; set; }
    public int LocationId { get; set; }
    public DateOnly ShiftDate { get; set; }
    public TimeOnly StartTime { get; set; }
    public TimeOnly EndTime { get; set; }
    public int UnpaidBreakMinutes { get; set; }
    public bool IsPublished { get; set; }
    public DateTime UpdatedAtUtc { get; set; }

    public decimal PaidHours => Math.Max(0, (decimal)(EndTime - StartTime).TotalMinutes - UnpaidBreakMinutes) / 60m;

    public bool Overlaps(Shift other) =>
        ShiftDate == other.ShiftDate && StartTime < other.EndTime && other.StartTime < EndTime;
}

public class ClosedDay
{
    public int ClosedDayId { get; set; }
    public Guid ClinicId { get; set; }
    public int? LocationId { get; set; }
    public DateOnly ClosedOn { get; set; }
    public string Name { get; set; } = "";

    public bool AppliesTo(int locationId) => LocationId is null || LocationId == locationId;
}

public class CoverageRule
{
    public int CoverageRuleId { get; set; }
    public Guid ClinicId { get; set; }
    public int LocationId { get; set; }
    public int JobTitleId { get; set; }
    public DayOfWeek Weekday { get; set; }
    public int MinHeadcount { get; set; }
}

public class CredentialType
{
    public int CredentialTypeId { get; set; }
    public Guid ClinicId { get; set; }
    public string Name { get; set; } = "";
    public bool BlocksScheduling { get; set; }
}

public class CredentialTypeJobTitle
{
    public Guid ClinicId { get; set; }
    public int CredentialTypeId { get; set; }
    public int JobTitleId { get; set; }
}

public class Credential
{
    public int CredentialId { get; set; }
    public Guid ClinicId { get; set; }
    public int StaffId { get; set; }
    public int CredentialTypeId { get; set; }
    public DateOnly ExpiresOn { get; set; }
}

public class ScheduleOverride
{
    public int OverrideId { get; set; }
    public Guid ClinicId { get; set; }
    public int ShiftId { get; set; }
    public int CredentialTypeId { get; set; }
    public int OverriddenByStaffId { get; set; }
    public string Reason { get; set; } = "";
    public DateTime OverriddenAtUtc { get; set; }
}

public class LeaveRequest
{
    public int LeaveRequestId { get; set; }
    public Guid ClinicId { get; set; }
    public int StaffId { get; set; }
    public DateOnly StartDate { get; set; }
    public DateOnly EndDate { get; set; }
    public bool FirstDayHalf { get; set; }
    public bool LastDayHalf { get; set; }
    public string LeaveType { get; set; } = LeaveTypes.Annual;
    public decimal DaysCounted { get; set; }
    public string? Note { get; set; }
    public string Status { get; set; } = LeaveStatuses.Pending;
    public int? DecidedByStaffId { get; set; }
    public string? DecisionComment { get; set; }
    public DateTime CreatedAtUtc { get; set; }
    public DateTime? DecidedAtUtc { get; set; }

    public bool Covers(DateOnly date) => date >= StartDate && date <= EndDate;

    /// <summary>True when the person is away for the whole day, not a half day.</summary>
    public bool IsFullDayOff(DateOnly date) =>
        Covers(date) && !(date == StartDate && FirstDayHalf) && !(date == EndDate && LastDayHalf);
}

public class AttendanceRecord
{
    public int AttendanceId { get; set; }
    public Guid ClinicId { get; set; }
    public int StaffId { get; set; }
    public int? ShiftId { get; set; }
    public int LocationId { get; set; }
    public DateTime ClockInUtc { get; set; }
    public DateTime? ClockOutUtc { get; set; }
    public int UnpaidBreakMinutes { get; set; }
    public bool IsUnscheduled { get; set; }
    public int? UnscheduledConfirmedByStaffId { get; set; }
    public int? CorrectedByStaffId { get; set; }
    public string? CorrectionNote { get; set; }

    public decimal? PaidHours => ClockOutUtc is { } outUtc
        ? Math.Max(0, (decimal)(outUtc - ClockInUtc).TotalMinutes - UnpaidBreakMinutes) / 60m
        : null;
}
