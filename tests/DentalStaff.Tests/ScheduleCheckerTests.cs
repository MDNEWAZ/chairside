using DentalStaff.Domain.Entities;
using DentalStaff.Domain.Rules;

namespace DentalStaff.Tests;

public class ScheduleCheckerTests
{
    private const int Downtown = 1, Riverside = 2, Dentist = 10, Hygienist = 11, Licence = 100;
    private static readonly DateOnly Mon = new(2026, 10, 19);
    private int _nextShiftId = 1;

    private readonly Dictionary<int, Staff> _staff = new()
    {
        [1] = new Staff { StaffId = 1, FirstName = "Ethan", LastName = "Brooks", JobTitleId = Dentist, HomeLocationId = Downtown, OvertimeEligible = true },
        [2] = new Staff { StaffId = 2, FirstName = "Grace", LastName = "Kim", JobTitleId = Hygienist, HomeLocationId = Downtown, OvertimeEligible = true },
        [3] = new Staff { StaffId = 3, FirstName = "Lucas", LastName = "Moreno", JobTitleId = Dentist, HomeLocationId = Riverside, OvertimeEligible = false },
    };

    private Shift S(int staffId, int day, int location = Downtown, int start = 8, int end = 16, int breakMin = 0) => new()
    {
        ShiftId = _nextShiftId++, StaffId = staffId, LocationId = location, ShiftDate = Mon.AddDays(day),
        StartTime = new TimeOnly(start, 0), EndTime = new TimeOnly(end, 0), UnpaidBreakMinutes = breakMin,
    };

    private ScheduleCheckInput Input(
        IReadOnlyList<Shift> shifts, IReadOnlyList<LeaveRequest>? leave = null, IReadOnlyList<CoverageRule>? coverage = null,
        IReadOnlyList<Credential>? credentials = null, IReadOnlyList<ScheduleOverride>? overrides = null,
        IReadOnlyList<ClosedDay>? closed = null, bool licenceBlocks = true) => new()
    {
        LocationId = Downtown,
        WeekStart = Mon,
        Shifts = shifts,
        ApprovedLeave = leave ?? [],
        ClosedDays = closed ?? [],
        CoverageRules = coverage ?? [],
        Staff = _staff,
        JobTitleNames = new Dictionary<int, string> { [Dentist] = "Dentist", [Hygienist] = "Hygienist" },
        Requirements = [new CredentialTypeJobTitle { CredentialTypeId = Licence, JobTitleId = Dentist }],
        CredentialTypes = new Dictionary<int, CredentialType> { [Licence] = new() { CredentialTypeId = Licence, Name = "State dental licence", BlocksScheduling = licenceBlocks } },
        Credentials = credentials ?? [new Credential { StaffId = 1, CredentialTypeId = Licence, ExpiresOn = Mon.AddYears(1) },
                                      new Credential { StaffId = 3, CredentialTypeId = Licence, ExpiresOn = Mon.AddYears(1) }],
        Overrides = overrides ?? [],
        OvertimeThresholdHours = 40,
    };

    private static List<ScheduleIssue> Of(IEnumerable<ScheduleIssue> issues, IssueKind kind) => issues.Where(i => i.Kind == kind).ToList();

    [Fact]
    public void Clean_week_has_no_issues()
    {
        Assert.Empty(ScheduleChecker.Run(Input([S(1, 0), S(2, 0)])));
    }

    [Fact]
    public void Overlap_is_found_across_locations()
    {
        var issues = ScheduleChecker.Run(Input([S(1, 0), S(1, 0, Riverside, start: 12, end: 18)]));
        var overlap = Assert.Single(Of(issues, IssueKind.Overlap));
        Assert.Equal(IssueSeverity.Warning, overlap.Severity);
    }

    [Fact]
    public void Back_to_back_shifts_do_not_overlap()
    {
        Assert.Empty(Of(ScheduleChecker.Run(Input([S(1, 0, end: 12), S(1, 0, Riverside, start: 12, end: 17)])), IssueKind.Overlap));
    }

    [Fact]
    public void Shift_on_approved_leave_warns()
    {
        var leave = new LeaveRequest { StaffId = 2, StartDate = Mon, EndDate = Mon.AddDays(1), Status = LeaveStatuses.Approved };
        Assert.Single(Of(ScheduleChecker.Run(Input([S(2, 1)], leave: [leave])), IssueKind.OnLeave));
    }

    [Fact]
    public void Below_minimum_warns_and_counts_people_on_leave_as_absent()
    {
        var coverage = new[] { new CoverageRule { LocationId = Downtown, JobTitleId = Dentist, Weekday = DayOfWeek.Monday, MinHeadcount = 1 } };
        var leave = new LeaveRequest { StaffId = 1, StartDate = Mon, EndDate = Mon, Status = LeaveStatuses.Approved };
        var issue = Assert.Single(Of(ScheduleChecker.Run(Input([S(1, 0)], leave: [leave], coverage: coverage)), IssueKind.BelowMinimum));
        Assert.Equal("0 of 1 Dentist scheduled.", issue.Message);
    }

    [Fact]
    public void Half_day_leave_still_counts_toward_minimum()
    {
        var coverage = new[] { new CoverageRule { LocationId = Downtown, JobTitleId = Dentist, Weekday = DayOfWeek.Monday, MinHeadcount = 1 } };
        var leave = new LeaveRequest { StaffId = 1, StartDate = Mon, EndDate = Mon, FirstDayHalf = true, Status = LeaveStatuses.Approved };
        Assert.Empty(Of(ScheduleChecker.Run(Input([S(1, 0)], leave: [leave], coverage: coverage)), IssueKind.BelowMinimum));
    }

    [Fact]
    public void Closed_day_skips_minimum_staffing()
    {
        var coverage = new[] { new CoverageRule { LocationId = Downtown, JobTitleId = Dentist, Weekday = DayOfWeek.Monday, MinHeadcount = 1 } };
        var closed = new[] { new ClosedDay { ClosedOn = Mon, Name = "Holiday" } };
        Assert.Empty(Of(ScheduleChecker.Run(Input([], coverage: coverage, closed: closed)), IssueKind.BelowMinimum));
    }

    [Fact]
    public void Expired_required_licence_blocks()
    {
        var creds = new[] { new Credential { StaffId = 1, CredentialTypeId = Licence, ExpiresOn = Mon.AddDays(1) } };
        var issues = Of(ScheduleChecker.Run(Input([S(1, 0), S(1, 2)], credentials: creds)), IssueKind.ExpiredLicence);
        var block = Assert.Single(issues); // valid on Monday, expired on Wednesday
        Assert.Equal(IssueSeverity.Block, block.Severity);
        Assert.Equal(Mon.AddDays(2), block.Date);
    }

    [Fact]
    public void Missing_required_licence_blocks()
    {
        var issue = Assert.Single(Of(ScheduleChecker.Run(Input([S(1, 0)], credentials: [])), IssueKind.ExpiredLicence));
        Assert.Equal(IssueSeverity.Block, issue.Severity);
    }

    [Fact]
    public void Renewed_licence_clears_the_block()
    {
        var creds = new[]
        {
            new Credential { StaffId = 1, CredentialTypeId = Licence, ExpiresOn = Mon.AddDays(-10) },
            new Credential { StaffId = 1, CredentialTypeId = Licence, ExpiresOn = Mon.AddYears(2) },
        };
        Assert.Empty(Of(ScheduleChecker.Run(Input([S(1, 0)], credentials: creds)), IssueKind.ExpiredLicence));
    }

    [Fact]
    public void Override_turns_block_into_warning()
    {
        var shift = S(1, 0);
        var overrides = new[] { new ScheduleOverride { ShiftId = shift.ShiftId, CredentialTypeId = Licence } };
        var issue = Assert.Single(Of(ScheduleChecker.Run(Input([shift], credentials: [], overrides: overrides)), IssueKind.ExpiredLicence));
        Assert.Equal(IssueSeverity.Warning, issue.Severity);
    }

    [Fact]
    public void Non_blocking_credential_only_warns()
    {
        var issue = Assert.Single(Of(ScheduleChecker.Run(Input([S(1, 0)], credentials: [], licenceBlocks: false)), IssueKind.ExpiredLicence));
        Assert.Equal(IssueSeverity.Warning, issue.Severity);
    }

    [Fact]
    public void Overtime_adds_hours_across_both_locations()
    {
        // 4 x 8h at Downtown + 1 x 9h at Riverside = 41h
        var shifts = new[] { S(2, 0), S(2, 1), S(2, 2), S(2, 3), S(2, 4, Riverside, start: 8, end: 17) };
        var issue = Assert.Single(Of(ScheduleChecker.Run(Input(shifts)), IssueKind.Overtime));
        Assert.Contains("41 hours", issue.Message);
    }

    [Fact]
    public void Exactly_threshold_is_not_overtime_and_breaks_are_deducted()
    {
        // 5 x (8.5h - 30 min break) = 40h
        var shifts = Enumerable.Range(0, 5).Select(d => new Shift
        {
            ShiftId = _nextShiftId++, StaffId = 2, LocationId = Downtown, ShiftDate = Mon.AddDays(d),
            StartTime = new(8, 0), EndTime = new(16, 30), UnpaidBreakMinutes = 30,
        }).ToList();
        Assert.Empty(Of(ScheduleChecker.Run(Input(shifts)), IssueKind.Overtime));
    }

    [Fact]
    public void Overtime_ignores_staff_who_are_not_eligible()
    {
        _staff[1].OvertimeEligible = false;
        var shifts = Enumerable.Range(0, 6).Select(d => S(1, d, end: 17)).ToList();
        Assert.Empty(Of(ScheduleChecker.Run(Input(shifts)), IssueKind.Overtime));
    }
}
