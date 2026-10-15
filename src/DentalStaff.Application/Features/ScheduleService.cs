using DentalStaff.Application.Common;
using DentalStaff.Domain.Entities;
using DentalStaff.Domain.Rules;
using Microsoft.EntityFrameworkCore;

namespace DentalStaff.Application.Features;

public sealed record ShiftDto(
    int ShiftId, int StaffId, int LocationId, DateOnly ShiftDate, TimeOnly StartTime, TimeOnly EndTime,
    int UnpaidBreakMinutes, bool IsPublished, decimal PaidHours);

public sealed record ScheduleDayDto(DateOnly Date, string? ClosedName, List<CoverageCellDto> Coverage);

public sealed record CoverageCellDto(string JobTitle, int Scheduled, int Minimum);

public sealed record ScheduleRowDto(
    int StaffId, string Name, string JobTitle, string HomeLocation, decimal WeeklyHours, bool OvertimeEligible, bool OverThreshold);

public sealed record IssueDto(string Kind, string Severity, DateOnly? Date, int? StaffId, int? ShiftId, string Message);

public sealed record ScheduleWeekDto(
    int LocationId, DateOnly WeekStart, List<ScheduleDayDto> Days, List<ScheduleRowDto> Rows, List<ShiftDto> Shifts,
    List<IssueDto> Issues, int DraftCount, bool CanEdit, bool CanOverride, decimal OvertimeThresholdHours);

public sealed record SaveShiftRequest(
    int LocationId, int StaffId, DateOnly ShiftDate, TimeOnly StartTime, TimeOnly EndTime, int? UnpaidBreakMinutes, bool? IsPublished);

public sealed record PublishRequest(int LocationId, DateOnly WeekStart, string? OverrideReason);

public sealed record WeekRequest(int LocationId, DateOnly WeekStart);

public sealed record PublishResult(int Published, int Overrides, ScheduleWeekDto Week);

public sealed record FillResult(int Created, ScheduleWeekDto Week);

public sealed class ScheduleService(
    IAppDbContext db, ICurrentUser user, Access access, ClinicScope scope, Notifier notifier, IClock clock, IAnalytics analytics)
{
    public async Task<ScheduleWeekDto> GetWeekAsync(int? locationId, DateOnly? anyDateInWeek, CancellationToken ct)
    {
        var calendar = await scope.CalendarAsync(ct);
        var loc = locationId ?? user.HomeLocationId;
        // Non-managers see only their own location, published shifts (roles matrix).
        if (!access.IsManager && loc != user.HomeLocationId) throw new ForbiddenException("You can view the schedule for your own location.");
        if (!await db.Locations.AnyAsync(l => l.LocationId == loc && l.IsActive, ct)) throw new NotFoundException("That location does not exist.");

        var weekStart = calendar.WeekStartFor(anyDateInWeek ?? calendar.Today(clock.UtcNow));
        return await BuildWeekAsync(loc, weekStart, ct);
    }

    public async Task<ScheduleWeekDto> CreateAsync(SaveShiftRequest r, CancellationToken ct)
    {
        access.RequireManagesLocation(r.LocationId);
        var clinic = await scope.ClinicAsync(ct);
        await ValidateAsync(r, ct);

        // Every shift starts as a draft. A caller asking for "published" (Undo of a published shift) gets it only if
        // the licence check passes, so no path publishes around the block and the owner override.
        var shift = new Shift
        {
            ClinicId = user.ClinicId, LocationId = r.LocationId, StaffId = r.StaffId, ShiftDate = r.ShiftDate,
            StartTime = r.StartTime, EndTime = r.EndTime, UnpaidBreakMinutes = r.UnpaidBreakMinutes ?? clinic.DefaultBreakMinutes,
            IsPublished = false, UpdatedAtUtc = clock.UtcNow,
        };
        db.Shifts.Add(shift);
        await db.SaveChangesAsync(ct);
        if (r.IsPublished == true && !await HasLicenceBlockAsync(shift, ct))
        {
            shift.IsPublished = true;
            await notifier.NotifyAsync([shift.StaffId], "schedule_changed", $"You have a new shift on {shift.ShiftDate:ddd, MMM d}.", ct);
            await db.SaveChangesAsync(ct);
        }
        analytics.Track("shift_created");
        return await WeekForAsync(shift.LocationId, shift.ShiftDate, ct);
    }

    /// <summary>True when this shift's person lacks a required, blocking licence on the shift date (and no override applies).</summary>
    private async Task<bool> HasLicenceBlockAsync(Shift shift, CancellationToken ct)
    {
        var weekStart = (await scope.CalendarAsync(ct)).WeekStartFor(shift.ShiftDate);
        var input = await LoadCheckInputAsync(shift.LocationId, weekStart, ct);
        return ScheduleChecker.Run(input).Any(i => i.Severity == IssueSeverity.Block && i.ShiftId == shift.ShiftId);
    }

    public async Task<ScheduleWeekDto> UpdateAsync(int shiftId, SaveShiftRequest r, CancellationToken ct)
    {
        var shift = await db.Shifts.SingleOrDefaultAsync(s => s.ShiftId == shiftId, ct) ?? throw new NotFoundException("This shift no longer exists.");
        access.RequireManagesLocation(shift.LocationId);
        if (r.LocationId != shift.LocationId) throw ValidationException.For("locationId", "Delete this shift and add it at the other location instead.");
        await ValidateAsync(r, ct, ignoreShiftId: shiftId);

        var previousStaff = shift.StaffId;
        var personOrDayChanged = shift.StaffId != r.StaffId || shift.ShiftDate != r.ShiftDate;
        shift.StaffId = r.StaffId;
        shift.ShiftDate = r.ShiftDate;
        shift.StartTime = r.StartTime;
        shift.EndTime = r.EndTime;
        shift.UnpaidBreakMinutes = r.UnpaidBreakMinutes ?? shift.UnpaidBreakMinutes;
        shift.UpdatedAtUtc = clock.UtcNow;

        // An owner override was given for one person on one day; it must not follow the shift to someone else.
        if (personOrDayChanged)
            db.ScheduleOverrides.RemoveRange(await db.ScheduleOverrides.Where(o => o.ShiftId == shiftId).ToListAsync(ct));
        await db.SaveChangesAsync(ct);

        var unpublished = false;
        if (shift.IsPublished && personOrDayChanged && await HasLicenceBlockAsync(shift, ct))
        {
            // A published shift now breaks the licence rule: take it back to draft so it goes through publish again.
            shift.IsPublished = false;
            unpublished = true;
        }
        if (shift.IsPublished || unpublished)
            await notifier.NotifyAsync([previousStaff, shift.StaffId], "schedule_changed", $"A published shift on {shift.ShiftDate:ddd, MMM d} was changed. Check your schedule.", ct);
        await db.SaveChangesAsync(ct);
        return await WeekForAsync(shift.LocationId, shift.ShiftDate, ct);
    }

    public async Task<ScheduleWeekDto> DeleteAsync(int shiftId, CancellationToken ct)
    {
        var shift = await db.Shifts.SingleOrDefaultAsync(s => s.ShiftId == shiftId, ct) ?? throw new NotFoundException("This shift was already deleted.");
        access.RequireManagesLocation(shift.LocationId);
        db.Shifts.Remove(shift);
        if (shift.IsPublished)
            await notifier.NotifyAsync([shift.StaffId], "schedule_changed", $"Your shift on {shift.ShiftDate:ddd, MMM d} was removed.", ct);
        await db.SaveChangesAsync(ct);
        return await WeekForAsync(shift.LocationId, shift.ShiftDate, ct);
    }

    public async Task<PublishResult> PublishAsync(PublishRequest r, CancellationToken ct)
    {
        access.RequireManagesLocation(r.LocationId);
        await RequireLocationAsync(r.LocationId, ct);
        new Validator().Date(r.WeekStart, "weekStart", "week").ThrowIfInvalid();
        var weekStart = (await scope.CalendarAsync(ct)).WeekStartFor(r.WeekStart);
        // One publish per location and week at a time, so a double click cannot log the same override twice.
        return await db.InTransactionAsync(async () =>
        {
            await db.AcquireLockAsync($"week:{r.LocationId}:{weekStart:yyyyMMdd}", ct);
            return await PublishWeekAsync(r, weekStart, ct);
        }, ct);
    }

    private async Task<PublishResult> PublishWeekAsync(PublishRequest r, DateOnly weekStart, CancellationToken ct)
    {
        var input = await LoadCheckInputAsync(r.LocationId, weekStart, ct);
        var blocks = ScheduleChecker.Run(input).Where(i => i.Severity == IssueSeverity.Block).ToList();

        var overrides = 0;
        if (blocks.Count > 0)
        {
            if (!access.IsOwner)
                throw new ConflictException("Publishing is blocked by an expired required licence. Ask the Owner / Admin to review and override it, or change the shift.");
            new Validator().Text(r.OverrideReason, "overrideReason", "a reason for the override", 300, multiline: true).ThrowIfInvalid();

            foreach (var b in blocks)
                db.ScheduleOverrides.Add(new ScheduleOverride
                {
                    ClinicId = user.ClinicId, ShiftId = b.ShiftId!.Value, CredentialTypeId = b.CredentialTypeId!.Value,
                    OverriddenByStaffId = user.StaffId, Reason = r.OverrideReason.Trim(),
                });
            overrides = blocks.Count;
        }

        var weekEnd = weekStart.AddDays(6);
        var drafts = await db.Shifts
            .Where(s => s.LocationId == r.LocationId && !s.IsPublished && s.ShiftDate >= weekStart && s.ShiftDate <= weekEnd)
            .ToListAsync(ct);
        foreach (var s in drafts)
        {
            s.IsPublished = true;
            s.UpdatedAtUtc = clock.UtcNow;
        }
        var locationName = await db.Locations.Where(l => l.LocationId == r.LocationId).Select(l => l.Name).SingleAsync(ct);
        await notifier.NotifyAsync(drafts.Select(s => s.StaffId), "schedule_published",
            $"The schedule for the week of {weekStart:MMM d} at {locationName} is published.", ct);
        await db.SaveChangesAsync(ct);
        analytics.Track("schedule_published", new { shifts = drafts.Count, overrides });
        return new PublishResult(drafts.Count, overrides, await BuildWeekAsync(r.LocationId, weekStart, ct));
    }

    /// <summary>Creates draft shifts from each person's work pattern, skipping closed days, full-day leave, and days already scheduled.</summary>
    public async Task<FillResult> FillFromPatternsAsync(WeekRequest r, CancellationToken ct)
    {
        access.RequireManagesLocation(r.LocationId);
        await RequireLocationAsync(r.LocationId, ct);
        new Validator().Date(r.WeekStart, "weekStart", "week").ThrowIfInvalid();
        var weekStart = (await scope.CalendarAsync(ct)).WeekStartFor(r.WeekStart);
        // Two clicks on "Fill week" run one after the other; the second finds the days filled and adds nothing.
        return await db.InTransactionAsync(async () =>
        {
            await db.AcquireLockAsync($"week:{r.LocationId}:{weekStart:yyyyMMdd}", ct);
            return await FillWeekAsync(r, weekStart, ct);
        }, ct);
    }

    private async Task<FillResult> FillWeekAsync(WeekRequest r, DateOnly weekStart, CancellationToken ct)
    {
        var weekEnd = weekStart.AddDays(6);

        var patterns = await db.WorkPatterns.AsNoTracking().Include(p => p.Days)
            .Where(p => p.EffectiveFrom <= weekEnd && db.Staff.Any(s => s.StaffId == p.StaffId && s.IsActive))
            .ToListAsync(ct);
        var definitions = await db.ShiftDefinitions.AsNoTracking().ToDictionaryAsync(d => d.ShiftDefinitionId, ct);
        var closed = await db.ClosedDays.AsNoTracking().Where(c => c.ClosedOn >= weekStart && c.ClosedOn <= weekEnd).ToListAsync(ct);
        var leave = await ApprovedLeaveAsync(weekStart, weekEnd, ct);
        var existing = await db.Shifts.AsNoTracking().Where(s => s.ShiftDate >= weekStart && s.ShiftDate <= weekEnd)
            .Select(s => new { s.StaffId, s.ShiftDate }).ToListAsync(ct);
        var clinic = await scope.ClinicAsync(ct);

        var created = 0;
        for (var date = weekStart; date <= weekEnd; date = date.AddDays(1))
        {
            if (closed.Any(c => c.ClosedOn == date && c.AppliesTo(r.LocationId))) continue;
            foreach (var staffPatterns in patterns.GroupBy(p => p.StaffId))
            {
                var pattern = staffPatterns.Where(p => p.EffectiveFrom <= date).MaxBy(p => p.EffectiveFrom);
                var day = pattern?.Days.FirstOrDefault(d => d.Weekday == date.DayOfWeek && d.LocationId == r.LocationId);
                if (day is null
                    || existing.Any(e => e.StaffId == staffPatterns.Key && e.ShiftDate == date)
                    || leave.Any(l => l.StaffId == staffPatterns.Key && l.IsFullDayOff(date))) continue;

                var def = definitions[day.ShiftDefinitionId];
                db.Shifts.Add(new Shift
                {
                    ClinicId = user.ClinicId, StaffId = staffPatterns.Key, LocationId = r.LocationId, ShiftDate = date,
                    StartTime = def.StartTime, EndTime = def.EndTime,
                    UnpaidBreakMinutes = def.UnpaidBreakMinutes ?? clinic.DefaultBreakMinutes, UpdatedAtUtc = clock.UtcNow,
                });
                created++;
            }
        }
        await db.SaveChangesAsync(ct);
        analytics.Track("week_filled_from_patterns", new { created });
        return new FillResult(created, await BuildWeekAsync(r.LocationId, weekStart, ct));
    }

    public async Task<List<ShiftDto>> MyUpcomingAsync(CancellationToken ct)
    {
        var today = await scope.TodayAsync(ct);
        return await db.Shifts.AsNoTracking()
            .Where(s => s.StaffId == user.StaffId && s.IsPublished && s.ShiftDate >= today && s.ShiftDate <= today.AddDays(28))
            .OrderBy(s => s.ShiftDate).ThenBy(s => s.StartTime)
            .Select(s => new ShiftDto(s.ShiftId, s.StaffId, s.LocationId, s.ShiftDate, s.StartTime, s.EndTime, s.UnpaidBreakMinutes, s.IsPublished, 0))
            .ToListAsync(ct);
    }

    internal async Task<ScheduleCheckInput> LoadCheckInputAsync(int locationId, DateOnly weekStart, CancellationToken ct)
    {
        var weekEnd = weekStart.AddDays(6);
        var clinic = await scope.ClinicAsync(ct);
        return new ScheduleCheckInput
        {
            LocationId = locationId,
            WeekStart = weekStart,
            Shifts = await db.Shifts.AsNoTracking().Where(s => s.ShiftDate >= weekStart && s.ShiftDate <= weekEnd).ToListAsync(ct),
            ApprovedLeave = await ApprovedLeaveAsync(weekStart, weekEnd, ct),
            ClosedDays = await db.ClosedDays.AsNoTracking().Where(c => c.ClosedOn >= weekStart && c.ClosedOn <= weekEnd).ToListAsync(ct),
            CoverageRules = await db.CoverageRules.AsNoTracking().Where(c => c.LocationId == locationId).ToListAsync(ct),
            Staff = await db.Staff.AsNoTracking().ToDictionaryAsync(s => s.StaffId, ct),
            JobTitleNames = await db.JobTitles.AsNoTracking().ToDictionaryAsync(j => j.JobTitleId, j => j.Name, ct),
            Requirements = await db.CredentialRequirements.AsNoTracking().ToListAsync(ct),
            CredentialTypes = await db.CredentialTypes.AsNoTracking().ToDictionaryAsync(c => c.CredentialTypeId, ct),
            Credentials = await db.Credentials.AsNoTracking().ToListAsync(ct),
            Overrides = await db.ScheduleOverrides.AsNoTracking()
                .Where(o => db.Shifts.Any(s => s.ShiftId == o.ShiftId && s.ShiftDate >= weekStart && s.ShiftDate <= weekEnd)).ToListAsync(ct),
            OvertimeThresholdHours = clinic.OvertimeThresholdHours,
        };
    }

    private Task<List<LeaveRequest>> ApprovedLeaveAsync(DateOnly from, DateOnly to, CancellationToken ct) =>
        db.LeaveRequests.AsNoTracking()
            .Where(l => l.Status == LeaveStatuses.Approved && l.StartDate <= to && l.EndDate >= from)
            .ToListAsync(ct);

    private async Task<ScheduleWeekDto> WeekForAsync(int locationId, DateOnly date, CancellationToken ct) =>
        await BuildWeekAsync(locationId, (await scope.CalendarAsync(ct)).WeekStartFor(date), ct);

    private async Task<ScheduleWeekDto> BuildWeekAsync(int locationId, DateOnly weekStart, CancellationToken ct)
    {
        var input = await LoadCheckInputAsync(locationId, weekStart, ct);
        var canEdit = access.ManagesLocation(locationId);
        var visible = input.Shifts.Where(s => canEdit || s.IsPublished).ToList();

        var staffIds = visible.Where(s => s.LocationId == locationId).Select(s => s.StaffId)
            .Union(input.Staff.Values.Where(s => s.IsActive && s.HomeLocationId == locationId && s.Role != Roles.OwnerAdmin).Select(s => s.StaffId))
            .ToHashSet();
        var locationNames = await db.Locations.AsNoTracking().ToDictionaryAsync(l => l.LocationId, l => l.Name, ct);

        var rows = input.Staff.Values.Where(s => staffIds.Contains(s.StaffId))
            .Select(s =>
            {
                var hours = ScheduleChecker.WeeklyHours(visible, s.StaffId);
                return new ScheduleRowDto(s.StaffId, s.FullName, input.JobTitleNames[s.JobTitleId], locationNames[s.HomeLocationId],
                    hours, s.OvertimeEligible, s.OvertimeEligible && hours > input.OvertimeThresholdHours);
            })
            .OrderBy(r => r.JobTitle).ThenBy(r => r.Name)
            .ToList();

        var days = Enumerable.Range(0, 7).Select(i => weekStart.AddDays(i)).Select(date => new ScheduleDayDto(
            date,
            input.ClosedDays.FirstOrDefault(c => c.ClosedOn == date && c.AppliesTo(locationId))?.Name,
            input.CoverageRules.Where(r => r.Weekday == date.DayOfWeek && r.MinHeadcount > 0)
                .Select(r => new CoverageCellDto(input.JobTitleNames[r.JobTitleId],
                    visible.Where(s => s.LocationId == locationId && s.ShiftDate == date
                                       && input.Staff[s.StaffId].JobTitleId == r.JobTitleId
                                       && !input.ApprovedLeave.Any(l => l.StaffId == s.StaffId && l.IsFullDayOff(date)))
                        .Select(s => s.StaffId).Distinct().Count(),
                    r.MinHeadcount))
                .ToList())).ToList();

        // Checks are a planning tool for managers; staff see the published week only.
        var issues = canEdit
            ? ScheduleChecker.Run(input).Select(i => new IssueDto(i.Kind.ToString(), i.Severity.ToString(), i.Date, i.StaffId, i.ShiftId, i.Message)).ToList()
            : [];

        var shifts = visible.Where(s => staffIds.Contains(s.StaffId))
            .Select(s => new ShiftDto(s.ShiftId, s.StaffId, s.LocationId, s.ShiftDate, s.StartTime, s.EndTime, s.UnpaidBreakMinutes, s.IsPublished, s.PaidHours))
            .ToList();

        return new ScheduleWeekDto(locationId, weekStart, days, rows, shifts, issues,
            shifts.Count(s => s.LocationId == locationId && !s.IsPublished), canEdit, access.IsOwner, input.OvertimeThresholdHours);
    }

    private async Task RequireLocationAsync(int locationId, CancellationToken ct)
    {
        if (!await db.Locations.AnyAsync(l => l.LocationId == locationId && l.IsActive, ct)) throw new NotFoundException("That location does not exist.");
    }

    private async Task ValidateAsync(SaveShiftRequest r, CancellationToken ct, int? ignoreShiftId = null)
    {
        var v = new Validator()
            .Date(r.ShiftDate, "shiftDate", "date")
            .Require(r.EndTime > r.StartTime, "endTime", "End time must be after the start time.")
            .Require(r.UnpaidBreakMinutes is null or (>= 0 and <= 120), "unpaidBreakMinutes", "Break must be between 0 and 120 minutes.");
        var staff = await db.Staff.AsNoTracking().SingleOrDefaultAsync(s => s.StaffId == r.StaffId, ct);
        v.Require(staff is { IsActive: true }, "staffId", "Choose an active staff member.");
        v.Require(await db.Locations.AnyAsync(l => l.LocationId == r.LocationId && l.IsActive, ct), "locationId", "Choose a location.");
        if (r.EndTime > r.StartTime && r.UnpaidBreakMinutes is { } b)
            v.Require(b < (r.EndTime - r.StartTime).TotalMinutes, "unpaidBreakMinutes", "Break must be shorter than the shift.");
        // One shift per person per day (brief Part 1). Overlaps across locations are warnings from the checks.
        v.Require(!await db.Shifts.AnyAsync(s => s.StaffId == r.StaffId && s.ShiftDate == r.ShiftDate && s.LocationId == r.LocationId && s.ShiftId != ignoreShiftId, ct),
            "shiftDate", "This person already has a shift at this location on this day. Edit that shift instead.");
        v.ThrowIfInvalid();
    }
}
