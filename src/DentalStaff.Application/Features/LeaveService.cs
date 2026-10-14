using DentalStaff.Application.Common;
using DentalStaff.Domain.Entities;
using DentalStaff.Domain.Rules;
using Microsoft.EntityFrameworkCore;

namespace DentalStaff.Application.Features;

public sealed record LeaveDraft(DateOnly StartDate, DateOnly EndDate, bool FirstDayHalf, bool LastDayHalf, string LeaveType, string? Note);

public sealed record LeaveBalanceDto(decimal Allowance, decimal Used, decimal Pending, decimal Remaining, int Year);

public sealed record LeavePreviewDto(decimal DaysCounted, LeaveBalanceDto Balance);

public sealed record LeaveDto(
    int LeaveRequestId, int StaffId, string StaffName, DateOnly StartDate, DateOnly EndDate, bool FirstDayHalf, bool LastDayHalf,
    string LeaveType, decimal DaysCounted, string Status, string? Note, string? DecidedBy, string? DecisionComment, DateTime CreatedAtUtc);

public sealed record MyLeaveDto(LeaveBalanceDto Balance, List<LeaveDto> Requests);

public sealed record StaffingImpactDto(DateOnly Date, string Location, string JobTitle, int RemainingAfter, int Minimum);

public sealed record InboxItemDto(LeaveDto Request, string JobTitle, string HomeLocation, List<StaffingImpactDto> Impact, List<LeaveDto> Overlapping);

public sealed record DecideRequest(bool Approve, string? Comment);

public sealed class LeaveService(
    IAppDbContext db, ICurrentUser user, Access access, ClinicScope scope, Notifier notifier, IClock clock, IAnalytics analytics)
{
    public async Task<LeavePreviewDto> PreviewAsync(LeaveDraft d, CancellationToken ct)
    {
        Validate(d);
        return new LeavePreviewDto(await CountAsync(user.StaffId, d, ct), await BalanceAsync(user.StaffId, ct));
    }

    public async Task<MyLeaveDto> MineAsync(CancellationToken ct) =>
        new(await BalanceAsync(user.StaffId, ct), await Query(l => l.StaffId == user.StaffId, newestFirst: true).Take(50).ToListAsync(ct));

    public async Task<MyLeaveDto> RequestAsync(LeaveDraft d, CancellationToken ct)
    {
        Validate(d);
        var today = await scope.TodayAsync(ct);
        new Validator()
            .Require(d.StartDate >= today.AddDays(-30), "startDate", "Leave can start at most 30 days in the past.")
            .Require(d.EndDate <= today.AddYears(1), "endDate", "Leave can be requested up to one year ahead.")
            .ThrowIfInvalid();

        if (await db.LeaveRequests.AnyAsync(l => l.StaffId == user.StaffId && l.Status != LeaveStatuses.Rejected && l.StartDate <= d.EndDate && l.EndDate >= d.StartDate, ct))
            throw ValidationException.For("startDate", "You already have leave on some of these dates. Check your requests below.");

        var days = await CountAsync(user.StaffId, d, ct);
        if (days == 0)
            throw ValidationException.For("startDate", "None of these dates are working days for you. If that is wrong, ask your manager to update your work pattern.");

        var request = new LeaveRequest
        {
            ClinicId = user.ClinicId, StaffId = user.StaffId, StartDate = d.StartDate, EndDate = d.EndDate,
            FirstDayHalf = d.FirstDayHalf, LastDayHalf = d.LastDayHalf, LeaveType = d.LeaveType, DaysCounted = days,
            Note = string.IsNullOrWhiteSpace(d.Note) ? null : d.Note.Trim(), Status = LeaveStatuses.Pending, CreatedAtUtc = clock.UtcNow,
        };

        var me = await db.Staff.AsNoTracking().SingleAsync(s => s.StaffId == user.StaffId, ct);
        var otherOwners = await db.Staff.AsNoTracking().Where(s => s.IsActive && s.Role == Roles.OwnerAdmin && s.StaffId != me.StaffId).Select(s => s.StaffId).ToListAsync(ct);
        if (me.Role == Roles.OwnerAdmin && otherOwners.Count == 0)
        {
            // The only Owner / Admin: recorded as approved, still on the calendar and in staffing checks.
            request.Status = LeaveStatuses.Approved;
            request.DecidedByStaffId = me.StaffId;
            request.DecisionComment = "Recorded automatically for the Owner / Admin.";
            request.DecidedAtUtc = clock.UtcNow;
        }
        else
        {
            var deciders = me.Role is Roles.OwnerAdmin or Roles.PracticeManager
                ? otherOwners
                : (await notifier.ManagersOfAsync(me.HomeLocationId, ct)).Where(id => id != me.StaffId);
            await notifier.NotifyAsync(deciders, "leave_requested",
                $"{me.FullName} requested {days:0.#} day(s) of {d.LeaveType} leave from {d.StartDate:MMM d}.", ct);
        }

        db.LeaveRequests.Add(request);
        await db.SaveChangesAsync(ct);
        analytics.Track("leave_requested", new { d.LeaveType, days, autoApproved = request.Status == LeaveStatuses.Approved });
        return await MineAsync(ct);
    }

    public async Task<List<InboxItemDto>> InboxAsync(CancellationToken ct)
    {
        access.RequireManager();
        var pending = await Query(l => l.Status == LeaveStatuses.Pending && l.StaffId != user.StaffId).ToListAsync(ct);
        var staff = await db.Staff.AsNoTracking().ToDictionaryAsync(s => s.StaffId, ct);
        var titles = await db.JobTitles.AsNoTracking().ToDictionaryAsync(j => j.JobTitleId, j => j.Name, ct);
        var locations = await db.Locations.AsNoTracking().ToDictionaryAsync(l => l.LocationId, l => l.Name, ct);

        var items = new List<InboxItemDto>();
        foreach (var req in pending.Where(p => CanDecide(staff[p.StaffId])))
        {
            var person = staff[req.StaffId];
            var overlapping = await Query(x => x.StaffId != req.StaffId && x.Status != LeaveStatuses.Rejected && x.StartDate <= req.EndDate && x.EndDate >= req.StartDate
                            && db.Staff.Any(s => s.StaffId == x.StaffId && s.HomeLocationId == person.HomeLocationId))
                .ToListAsync(ct);
            items.Add(new InboxItemDto(req, titles[person.JobTitleId], locations[person.HomeLocationId],
                await ImpactAsync(person, req.StartDate, req.EndDate, locations, titles, ct), overlapping));
        }
        return items;
    }

    public async Task<List<InboxItemDto>> DecideAsync(int id, DecideRequest r, CancellationToken ct)
    {
        access.RequireManager();
        var req = await db.LeaveRequests.SingleOrDefaultAsync(l => l.LeaveRequestId == id, ct) ?? throw new NotFoundException("This request no longer exists.");
        if (req.Status != LeaveStatuses.Pending) throw new ConflictException("This request was already decided.");
        var person = await db.Staff.AsNoTracking().SingleAsync(s => s.StaffId == req.StaffId, ct);
        if (!CanDecide(person)) throw new ForbiddenException("You cannot decide this request. Managers cannot decide their own leave.");
        new Validator().Text(r.Comment, "comment", "a comment", 500, required: false).ThrowIfInvalid();

        req.DaysCounted = await CountAsync(req.StaffId, new LeaveDraft(req.StartDate, req.EndDate, req.FirstDayHalf, req.LastDayHalf, req.LeaveType, null), ct);
        req.Status = r.Approve ? LeaveStatuses.Approved : LeaveStatuses.Rejected;
        req.DecidedByStaffId = user.StaffId;
        req.DecisionComment = string.IsNullOrWhiteSpace(r.Comment) ? null : r.Comment.Trim();
        req.DecidedAtUtc = clock.UtcNow;
        await notifier.NotifyAsync([req.StaffId], "leave_decided",
            $"Your leave from {req.StartDate:MMM d} was {req.Status}." + (req.DecisionComment is null ? "" : $" Comment: {req.DecisionComment}"), ct);
        await db.SaveChangesAsync(ct);
        analytics.Track("leave_decided", new { req.Status });
        return await InboxAsync(ct);
    }

    /// <summary>Team leave for a location (dates only for non-managers, per the roles matrix).</summary>
    public async Task<List<LeaveDto>> TeamAsync(DateOnly from, DateOnly to, CancellationToken ct)
    {
        var locationId = user.HomeLocationId;
        var allLocations = access.IsOwner;
        var list = await Query(x => x.Status == LeaveStatuses.Approved && x.StartDate <= to && x.EndDate >= from
                                    && (allLocations || db.Staff.Any(s => s.StaffId == x.StaffId && s.HomeLocationId == locationId))).ToListAsync(ct);
        return access.IsManager ? list : list.Select(x => x with { LeaveType = "leave", Note = null, DecisionComment = null, DaysCounted = 0 }).ToList();
    }

    private bool CanDecide(Staff person) =>
        person.StaffId != user.StaffId && (
            access.IsOwner
            || (user.Role == Roles.PracticeManager && person.HomeLocationId == user.HomeLocationId && person.Role is Roles.ClinicalStaff or Roles.Reception));

    private async Task<List<StaffingImpactDto>> ImpactAsync(
        Staff person, DateOnly from, DateOnly to, Dictionary<int, string> locations, Dictionary<int, string> titles, CancellationToken ct)
    {
        var rules = await db.CoverageRules.AsNoTracking().Where(r => r.JobTitleId == person.JobTitleId && r.MinHeadcount > 0).ToListAsync(ct);
        var plan = await WorkPlanAsync(from, to, ct);
        var closed = await db.ClosedDays.AsNoTracking().Where(c => c.ClosedOn >= from && c.ClosedOn <= to).ToListAsync(ct);
        var leave = await db.LeaveRequests.AsNoTracking()
            .Where(l => l.Status == LeaveStatuses.Approved && l.StartDate <= to && l.EndDate >= from).ToListAsync(ct);
        var jobTitleOf = await db.Staff.AsNoTracking().ToDictionaryAsync(s => s.StaffId, s => s.JobTitleId, ct);

        var impact = new List<StaffingImpactDto>();
        for (var date = from; date <= to; date = date.AddDays(1))
        {
            if (!plan.TryGetValue((person.StaffId, date), out var where)) continue;
            var rule = rules.FirstOrDefault(r => r.LocationId == where && r.Weekday == date.DayOfWeek);
            if (rule is null || closed.Any(c => c.ClosedOn == date && c.AppliesTo(where))) continue;

            var remaining = plan.Count(p => p.Key.Date == date && p.Value == where && p.Key.StaffId != person.StaffId
                                            && jobTitleOf.GetValueOrDefault(p.Key.StaffId) == person.JobTitleId
                                            && !leave.Any(l => l.StaffId == p.Key.StaffId && l.IsFullDayOff(date)));
            if (remaining < rule.MinHeadcount)
                impact.Add(new StaffingImpactDto(date, locations[where], titles[person.JobTitleId], remaining, rule.MinHeadcount));
        }
        return impact;
    }

    /// <summary>Who works where on each date: the published or draft shift, else the work pattern (decisions D2).</summary>
    private async Task<Dictionary<(int StaffId, DateOnly Date), int>> WorkPlanAsync(DateOnly from, DateOnly to, CancellationToken ct, int? staffId = null)
    {
        var shifts = await db.Shifts.AsNoTracking()
            .Where(s => s.ShiftDate >= from && s.ShiftDate <= to && (staffId == null || s.StaffId == staffId))
            .Select(s => new { s.StaffId, s.ShiftDate, s.LocationId, s.IsPublished }).ToListAsync(ct);
        var patterns = await db.WorkPatterns.AsNoTracking().Include(p => p.Days)
            .Where(p => p.EffectiveFrom <= to && (staffId == null || p.StaffId == staffId)
                        && db.Staff.Any(s => s.StaffId == p.StaffId && s.IsActive))
            .ToListAsync(ct);

        var plan = new Dictionary<(int, DateOnly), int>();
        for (var date = from; date <= to; date = date.AddDays(1))
        {
            foreach (var group in patterns.GroupBy(p => p.StaffId))
            {
                var day = group.Where(p => p.EffectiveFrom <= date).MaxBy(p => p.EffectiveFrom)?.Days.FirstOrDefault(d => d.Weekday == date.DayOfWeek);
                if (day is not null) plan[(group.Key, date)] = day.LocationId;
            }
            foreach (var s in shifts.Where(s => s.ShiftDate == date)) plan[(s.StaffId, date)] = s.LocationId; // real schedule wins
        }
        return plan;
    }

    private async Task<decimal> CountAsync(int staffId, LeaveDraft d, CancellationToken ct)
    {
        var plan = await WorkPlanAsync(d.StartDate, d.EndDate, ct, staffId);
        var closed = await db.ClosedDays.AsNoTracking().Where(c => c.ClosedOn >= d.StartDate && c.ClosedOn <= d.EndDate).ToListAsync(ct);
        return LeaveDayCounter.Count(d.StartDate, d.EndDate, d.FirstDayHalf, d.LastDayHalf,
            worksOn: date => plan.ContainsKey((staffId, date)),
            isClosed: date => plan.TryGetValue((staffId, date), out var loc) && closed.Any(c => c.ClosedOn == date && c.AppliesTo(loc)));
    }

    private async Task<LeaveBalanceDto> BalanceAsync(int staffId, CancellationToken ct)
    {
        var clinic = await scope.ClinicAsync(ct);
        var year = (await scope.TodayAsync(ct)).Year;
        var start = new DateOnly(year, 1, 1);
        var end = new DateOnly(year, 12, 31);
        var annual = await db.LeaveRequests.AsNoTracking()
            .Where(l => l.StaffId == staffId && l.LeaveType == LeaveTypes.Annual && l.StartDate >= start && l.StartDate <= end)
            .GroupBy(l => l.Status).Select(g => new { Status = g.Key, Days = g.Sum(x => x.DaysCounted) }).ToListAsync(ct);
        var used = annual.Where(a => a.Status == LeaveStatuses.Approved).Sum(a => a.Days);
        var pending = annual.Where(a => a.Status == LeaveStatuses.Pending).Sum(a => a.Days);
        return new LeaveBalanceDto(clinic.LeaveAllowanceDays, used, pending, clinic.LeaveAllowanceDays - used, year);
    }

    private static void Validate(LeaveDraft d)
    {
        var v = new Validator()
            .Require(d.EndDate >= d.StartDate, "endDate", "End date must be on or after the start date.")
            .Require(d.EndDate.DayNumber - d.StartDate.DayNumber <= 60, "endDate", "Request at most 60 days at a time.")
            .Require(LeaveTypes.All.Contains(d.LeaveType), "leaveType", "Choose a leave type.")
            .Require(!(d.StartDate == d.EndDate && d.FirstDayHalf && d.LastDayHalf), "lastDayHalf", "For a single half day, tick only the first box.")
            .Text(d.Note, "note", "a note", 500, required: false);
        v.ThrowIfInvalid();
    }

    /// <summary>Filters and orders on the entity first: EF cannot translate filters on a projected record.</summary>
    private IQueryable<LeaveDto> Query(System.Linq.Expressions.Expression<Func<LeaveRequest, bool>> filter, bool newestFirst = false) =>
        from l in (newestFirst
            ? db.LeaveRequests.AsNoTracking().Where(filter).OrderByDescending(x => x.StartDate)
            : db.LeaveRequests.AsNoTracking().Where(filter).OrderBy(x => x.StartDate))
        join s in db.Staff on l.StaffId equals s.StaffId
        join dsn in db.Staff on l.DecidedByStaffId equals dsn.StaffId into ds
        from decider in ds.DefaultIfEmpty()
        select new LeaveDto(l.LeaveRequestId, l.StaffId, s.FirstName + " " + s.LastName, l.StartDate, l.EndDate, l.FirstDayHalf, l.LastDayHalf,
            l.LeaveType, l.DaysCounted, l.Status, l.Note,
            decider == null ? null : decider.FirstName + " " + decider.LastName, l.DecisionComment, l.CreatedAtUtc);
}
