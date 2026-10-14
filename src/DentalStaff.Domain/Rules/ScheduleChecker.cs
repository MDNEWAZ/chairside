using DentalStaff.Domain.Entities;

namespace DentalStaff.Domain.Rules;

public enum IssueKind { Overlap, OnLeave, ClosedDay, BelowMinimum, ExpiredLicence, Overtime }

public enum IssueSeverity { Warning, Block }

public sealed record ScheduleIssue(
    IssueKind Kind,
    IssueSeverity Severity,
    DateOnly? Date,
    int? StaffId,
    int? ShiftId,
    int? CredentialTypeId,
    string Message);

/// <summary>Everything the four schedule checks need for one location and one workweek.</summary>
public sealed class ScheduleCheckInput
{
    public required int LocationId { get; init; }
    public required DateOnly WeekStart { get; init; }
    /// <summary>Every shift in the week at every location, so overlap and hours span both locations.</summary>
    public required IReadOnlyList<Shift> Shifts { get; init; }
    public required IReadOnlyList<LeaveRequest> ApprovedLeave { get; init; }
    public required IReadOnlyList<ClosedDay> ClosedDays { get; init; }
    public required IReadOnlyList<CoverageRule> CoverageRules { get; init; }
    public required IReadOnlyDictionary<int, Staff> Staff { get; init; }
    public required IReadOnlyDictionary<int, string> JobTitleNames { get; init; }
    public required IReadOnlyList<CredentialTypeJobTitle> Requirements { get; init; }
    public required IReadOnlyDictionary<int, CredentialType> CredentialTypes { get; init; }
    public required IReadOnlyList<Credential> Credentials { get; init; }
    public required IReadOnlyList<ScheduleOverride> Overrides { get; init; }
    public required decimal OvertimeThresholdHours { get; init; }
}

/// <summary>
/// The four schedule checks from the brief (overlap or leave, minimum staffing, expired required
/// licence, overtime), plus closed days. Only an expired licence that blocks scheduling, with no
/// recorded override, is a Block; everything else warns.
/// </summary>
public static class ScheduleChecker
{
    public static IReadOnlyList<ScheduleIssue> Run(ScheduleCheckInput input)
    {
        var issues = new List<ScheduleIssue>();
        var weekEnd = input.WeekStart.AddDays(6);
        var weekShifts = input.Shifts.Where(s => s.ShiftDate >= input.WeekStart && s.ShiftDate <= weekEnd).ToList();
        var localShifts = weekShifts.Where(s => s.LocationId == input.LocationId).ToList();

        foreach (var shift in localShifts)
        {
            var name = NameOf(input, shift.StaffId);

            if (weekShifts.Any(o => o.ShiftId != shift.ShiftId && o.StaffId == shift.StaffId && o.Overlaps(shift)))
                issues.Add(new(IssueKind.Overlap, IssueSeverity.Warning, shift.ShiftDate, shift.StaffId, shift.ShiftId, null,
                    $"{name} already has an overlapping shift on this day."));

            var leave = input.ApprovedLeave.FirstOrDefault(l => l.StaffId == shift.StaffId && l.Covers(shift.ShiftDate));
            if (leave is not null)
                issues.Add(new(IssueKind.OnLeave, IssueSeverity.Warning, shift.ShiftDate, shift.StaffId, shift.ShiftId, null,
                    leave.IsFullDayOff(shift.ShiftDate)
                        ? $"{name} is on approved leave this day."
                        : $"{name} has approved half-day leave this day."));

            if (input.ClosedDays.Any(c => c.ClosedOn == shift.ShiftDate && c.AppliesTo(input.LocationId)))
                issues.Add(new(IssueKind.ClosedDay, IssueSeverity.Warning, shift.ShiftDate, shift.StaffId, shift.ShiftId, null,
                    $"The clinic is closed this day, but {name} has a shift."));

            issues.AddRange(LicenceIssues(input, shift, name));
        }

        issues.AddRange(CoverageIssues(input, localShifts));
        issues.AddRange(OvertimeIssues(input, weekShifts, localShifts));
        return issues;
    }

    private static IEnumerable<ScheduleIssue> LicenceIssues(ScheduleCheckInput input, Shift shift, string name)
    {
        if (!input.Staff.TryGetValue(shift.StaffId, out var staff)) yield break;

        var required = input.Requirements.Where(r => r.JobTitleId == staff.JobTitleId).Select(r => r.CredentialTypeId);
        foreach (var typeId in required)
        {
            var latestExpiry = input.Credentials
                .Where(c => c.StaffId == shift.StaffId && c.CredentialTypeId == typeId)
                .Select(c => (DateOnly?)c.ExpiresOn)
                .Max();
            if (latestExpiry >= shift.ShiftDate) continue;

            var type = input.CredentialTypes[typeId];
            var overridden = input.Overrides.Any(o => o.ShiftId == shift.ShiftId && o.CredentialTypeId == typeId);
            var severity = type.BlocksScheduling && !overridden ? IssueSeverity.Block : IssueSeverity.Warning;
            var state = latestExpiry is null ? "has no" : "has an expired";
            var suffix = overridden ? " Overridden by the owner." : "";
            yield return new(IssueKind.ExpiredLicence, severity, shift.ShiftDate, shift.StaffId, shift.ShiftId, typeId,
                $"{name} {state} {type.Name} on this day.{suffix}");
        }
    }

    private static IEnumerable<ScheduleIssue> CoverageIssues(ScheduleCheckInput input, List<Shift> localShifts)
    {
        for (var date = input.WeekStart; date <= input.WeekStart.AddDays(6); date = date.AddDays(1))
        {
            if (input.ClosedDays.Any(c => c.ClosedOn == date && c.AppliesTo(input.LocationId))) continue;

            foreach (var rule in input.CoverageRules.Where(r => r.LocationId == input.LocationId && r.Weekday == date.DayOfWeek && r.MinHeadcount > 0))
            {
                var headcount = localShifts
                    .Where(s => s.ShiftDate == date
                                && input.Staff.TryGetValue(s.StaffId, out var st) && st.JobTitleId == rule.JobTitleId
                                && !input.ApprovedLeave.Any(l => l.StaffId == s.StaffId && l.IsFullDayOff(date)))
                    .Select(s => s.StaffId)
                    .Distinct()
                    .Count();
                if (headcount >= rule.MinHeadcount) continue;

                var title = input.JobTitleNames.GetValueOrDefault(rule.JobTitleId, "staff");
                yield return new(IssueKind.BelowMinimum, IssueSeverity.Warning, date, null, null, null,
                    $"{headcount} of {rule.MinHeadcount} {title} scheduled.");
            }
        }
    }

    private static IEnumerable<ScheduleIssue> OvertimeIssues(ScheduleCheckInput input, List<Shift> weekShifts, List<Shift> localShifts)
    {
        foreach (var staffId in localShifts.Select(s => s.StaffId).Distinct())
        {
            if (!input.Staff.TryGetValue(staffId, out var staff) || !staff.OvertimeEligible) continue;

            var hours = WeeklyHours(weekShifts, staffId);
            if (hours > input.OvertimeThresholdHours)
                yield return new(IssueKind.Overtime, IssueSeverity.Warning, null, staffId, null, null,
                    $"{staff.FullName} is scheduled {hours:0.#} hours this week, above the {input.OvertimeThresholdHours:0.#} hour threshold.");
        }
    }

    public static decimal WeeklyHours(IEnumerable<Shift> weekShifts, int staffId) =>
        weekShifts.Where(s => s.StaffId == staffId).Sum(s => s.PaidHours);

    private static string NameOf(ScheduleCheckInput input, int staffId) =>
        input.Staff.TryGetValue(staffId, out var s) ? s.FullName : "This person";
}
