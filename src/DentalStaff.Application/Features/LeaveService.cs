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
    private const int MaxTeamRangeDays = 120;

    public async Task<LeavePreviewDto> PreviewAsync(LeaveDraft d, CancellationToken ct)
    {
        Validate(d);
        // The balance shown is the one the request draws from: the year it starts in.
        return new LeavePreviewDto(await CountAsync(user.StaffId, d, ct), await BalanceAsync(user.StaffId, d.StartDate.Year, ct));
    }

    public async Task<MyLeaveDto> MineAsync(CancellationToken ct) =>
        new(await BalanceAsync(user.StaffId, (await scope.TodayAsync(ct)).Year, ct),
            await Query(l => l.StaffId == user.StaffId, newestFirst: true).Take(50).ToListAsync(ct));

    public async Task<MyLeaveDto> RequestAsync(LeaveDraft d, CancellationToken ct)
    {
        Validate(d);
        var today = await scope.TodayAsync(ct);
        new Validator()
            .Require(d.StartDate >= today.AddDays(-30), "startDate", "Leave can start at most 30 days in the past.")
            .Require(d.EndDate <= today.AddYears(1), "endDate", "Leave can be requested up to one year ahead.")
            .ThrowIfInvalid();

        var days = await CountAsync(user.StaffId, d, ct);
        if (days == 0)
            throw ValidationException.For("startDate", "None of these dates are working days for you. If that is wrong, ask your manager to update your work pattern.");

        var me = await db.Staff.AsNoTracking().SingleAsync(s => s.StaffId == user.StaffId, ct);
        await db.InTransactionAsync(async () =>
        {
            // Two quick submits cannot both pass the overlap and allowance checks.
            await db.AcquireLockAsync($"leave-staff:{user.StaffId}", ct);
            if (await db.LeaveRequests.AnyAsync(l => l.StaffId == user.StaffId && l.Status != LeaveStatuses.Rejected && l.StartDate <= d.EndDate && l.EndDate >= d.StartDate, ct))
                throw ValidationException.For("startDate", "You already have leave on some of these dates. Check your requests below.");

            if (d.LeaveType == LeaveTypes.Annual)
            {
                var balance = await BalanceAsync(user.StaffId, d.StartDate.Year, ct);
                var available = balance.Remaining - balance.Pending;
                if (days > available)
                    throw ValidationException.For("endDate",
                        $"This needs {days:0.#} annual leave day(s), but only {Math.Max(0, available):0.#} are left for {balance.Year} after pending requests. Shorten the dates or choose another leave type.");
            }

            var request = new LeaveRequest
            {
                ClinicId = user.ClinicId, StaffId = user.StaffId, StartDate = d.StartDate, EndDate = d.EndDate,
                FirstDayHalf = d.FirstDayHalf, LastDayHalf = d.LastDayHalf, LeaveType = d.LeaveType, DaysCounted = days,
                Note = string.IsNullOrWhiteSpace(d.Note) ? null : d.Note.Trim(), Status = LeaveStatuses.Pending, CreatedAtUtc = clock.UtcNow,
            };

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
            return true;
        }, ct);
        return await MineAsync(ct);
    }

    /// <summary>Withdraws one of your own requests while it is still waiting for a decision.</summary>
    public async Task<MyLeaveDto> CancelAsync(int id, CancellationToken ct)
    {
        await db.InTransactionAsync(async () =>
        {
            await db.AcquireLockAsync($"leave:{id}", ct);
            var req = await db.LeaveRequests.SingleOrDefaultAsync(l => l.LeaveRequestId == id && l.StaffId == user.StaffId, ct)
                      ?? throw new NotFoundException("This request no longer exists.");
            if (req.Status != LeaveStatuses.Pending)
                throw new ConflictException("This request was already decided, so it cannot be withdrawn. Ask your manager.");
            db.LeaveRequests.Remove(req); // a pending request has no effect yet; the audit trigger keeps the record of it
            await db.SaveChangesAsync(ct);
            return true;
        }, ct);
        analytics.Track("leave_cancelled");
        return await MineAsync(ct);
    }

    /// <summary>How many requests wait for this manager, without the inbox's staffing impact work.</summary>
    public async Task<int> PendingForMeCountAsync(CancellationToken ct)
    {
        access.RequireManager();
        var waiting = await (
            from l in db.LeaveRequests.AsNoTracking()
            join s in db.Staff on l.StaffId equals s.StaffId
            where l.Status == LeaveStatuses.Pending && l.StaffId != user.StaffId
            select s).ToListAsync(ct);
        return waiting.Count(CanDecide);
    }

    public async Task<List<InboxItemDto>> InboxAsync(CancellationToken ct)
    {
        access.RequireManager();
        var staff = await db.Staff.AsNoTracking().ToDictionaryAsync(s => s.StaffId, ct);
        var pending = (await Query(l => l.Status == LeaveStatuses.Pending && l.StaffId != user.StaffId).ToListAsync(ct))
            .Where(p => CanDecide(staff[p.StaffId])).ToList();
        if (pending.Count == 0) return [];

        var titles = await db.JobTitles.AsNoTracking().ToDictionaryAsync(j => j.JobTitleId, j => j.Name, ct);
        var locations = await db.Locations.AsNoTracking().ToDictionaryAsync(l => l.LocationId, l => l.Name, ct);

        // Everything the impact and overlap columns need, loaded once for the whole inbox.
        var from = pending.Min(p => p.StartDate);
        var to = pending.Max(p => p.EndDate);
        var context = new ImpactContext(
            await db.CoverageRules.AsNoTracking().Where(r => r.MinHeadcount > 0).ToListAsync(ct),
            await WorkPlanAsync(from, to, ct, publishedOnly: false),
            await db.ClosedDays.AsNoTracking().Where(c => c.ClosedOn >= from && c.ClosedOn <= to).ToListAsync(ct),
            await db.LeaveRequests.AsNoTracking().Where(l => l.Status == LeaveStatuses.Approved && l.StartDate <= to && l.EndDate >= from).ToListAsync(ct),
            staff.ToDictionary(s => s.Key, s => s.Value.JobTitleId));
        var nearby = await Query(x => x.Status != LeaveStatuses.Rejected && x.StartDate <= to && x.EndDate >= from).ToListAsync(ct);

        return pending.Select(req =>
        {
            var person = staff[req.StaffId];
            var overlapping = nearby.Where(x => x.StaffId != req.StaffId && x.StartDate <= req.EndDate && x.EndDate >= req.StartDate
                                                && staff.TryGetValue(x.StaffId, out var o) && o.HomeLocationId == person.HomeLocationId).ToList();
            return new InboxItemDto(req, titles[person.JobTitleId], locations[person.HomeLocationId],
                Impact(person, req.StartDate, req.EndDate, context, locations, titles), overlapping);
        }).ToList();
    }

    public async Task<List<InboxItemDto>> DecideAsync(int id, DecideRequest r, CancellationToken ct)
    {
        access.RequireManager();
        new Validator()
            .Text(r.Comment, "comment", "a comment", 500, required: false, multiline: true)
            .Require(r.Approve || !string.IsNullOrWhiteSpace(r.Comment), "comment", "Add a short reason so the person knows why.")
            .ThrowIfInvalid();

        await db.InTransactionAsync(async () =>
        {
            // Two managers deciding at once: the second waits, then sees the first decision.
            await db.AcquireLockAsync($"leave:{id}", ct);
            var req = await db.LeaveRequests.SingleOrDefaultAsync(l => l.LeaveRequestId == id, ct) ?? throw new NotFoundException("This request no longer exists.");
            if (req.Status != LeaveStatuses.Pending) throw new ConflictException("This request was already decided.");
            var person = await db.Staff.AsNoTracking().SingleAsync(s => s.StaffId == req.StaffId, ct);
            if (!CanDecide(person)) throw new ForbiddenException("You cannot decide this request. Managers cannot decide their own leave.");

            req.DaysCounted = await CountAsync(req.StaffId, new LeaveDraft(req.StartDate, req.EndDate, req.FirstDayHalf, req.LastDayHalf, req.LeaveType, null), ct);
            req.Status = r.Approve ? LeaveStatuses.Approved : LeaveStatuses.Rejected;
            req.DecidedByStaffId = user.StaffId;
            req.DecisionComment = string.IsNullOrWhiteSpace(r.Comment) ? null : r.Comment.Trim();
            req.DecidedAtUtc = clock.UtcNow;
            await notifier.NotifyAsync([req.StaffId], "leave_decided",
                $"Your leave from {req.StartDate:MMM d} was {req.Status}." + (req.DecisionComment is null ? "" : $" Comment: {req.DecisionComment}"), ct);
            await db.SaveChangesAsync(ct);
            analytics.Track("leave_decided", new { req.Status });
            return true;
        }, ct);
        return await InboxAsync(ct);
    }

    /// <summary>Team leave for a location (dates only for non-managers, per the roles matrix).</summary>
    public async Task<List<LeaveDto>> TeamAsync(DateOnly from, DateOnly to, CancellationToken ct)
    {
        new Validator()
            .Date(from, "from", "start date")
            .Date(to, "to", "end date")
            .Require(to >= from && to.DayNumber - from.DayNumber <= MaxTeamRangeDays, "to", $"Choose a range of up to {MaxTeamRangeDays} days.")
            .ThrowIfInvalid();
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

    private sealed record ImpactContext(
        List<CoverageRule> Rules, Dictionary<(int StaffId, DateOnly Date), int> Plan, List<ClosedDay> Closed,
        List<LeaveRequest> ApprovedLeave, Dictionary<int, int> JobTitleOf);

    private static List<StaffingImpactDto> Impact(
        Staff person, DateOnly from, DateOnly to, ImpactContext c, Dictionary<int, string> locations, Dictionary<int, string> titles)
    {
        var impact = new List<StaffingImpactDto>();
        for (var date = from; date <= to; date = date.AddDays(1))
        {
            if (!c.Plan.TryGetValue((person.StaffId, date), out var where)) continue;
            var rule = c.Rules.FirstOrDefault(r => r.JobTitleId == person.JobTitleId && r.LocationId == where && r.Weekday == date.DayOfWeek);
            if (rule is null || c.Closed.Any(x => x.ClosedOn == date && x.AppliesTo(where))) continue;

            var remaining = c.Plan.Count(p => p.Key.Date == date && p.Value == where && p.Key.StaffId != person.StaffId
                                              && c.JobTitleOf.GetValueOrDefault(p.Key.StaffId) == person.JobTitleId
                                              && !c.ApprovedLeave.Any(l => l.StaffId == p.Key.StaffId && l.IsFullDayOff(date)));
            if (remaining < rule.MinHeadcount)
                impact.Add(new StaffingImpactDto(date, locations[where], titles[person.JobTitleId], remaining, rule.MinHeadcount));
        }
        return impact;
    }

    /// <summary>
    /// Who works where on each date: the shift, else the work pattern (decisions D2). Leave counts only published
    /// shifts, because a draft can still change; staffing impact also sees drafts, because the manager is planning them.
    /// </summary>
    private async Task<Dictionary<(int StaffId, DateOnly Date), int>> WorkPlanAsync(
        DateOnly from, DateOnly to, CancellationToken ct, int? staffId = null, bool publishedOnly = true)
    {
        var shifts = await db.Shifts.AsNoTracking()
            .Where(s => s.ShiftDate >= from && s.ShiftDate <= to && (staffId == null || s.StaffId == staffId) && (!publishedOnly || s.IsPublished))
            .Select(s => new { s.StaffId, s.ShiftDate, s.LocationId }).ToListAsync(ct);
        var patterns = await db.WorkPatterns.AsNoTracking().Include(p => p.Days)
            .Where(p => p.EffectiveFrom <= to && (staffId == null || p.StaffId == staffId)
                        && db.Staff.Any(s => s.StaffId == p.StaffId && s.IsActive))
            .ToListAsync(ct);

        var plan = new Dictionary<(int, DateOnly), int>();
        var byStaff = patterns.GroupBy(p => p.StaffId).ToList();
        for (var date = from; date <= to; date = date.AddDays(1))
        {
            foreach (var group in byStaff)
            {
                var day = group.Where(p => p.EffectiveFrom <= date).MaxBy(p => p.EffectiveFrom)?.Days.FirstOrDefault(d => d.Weekday == date.DayOfWeek);
                if (day is not null) plan[(group.Key, date)] = day.LocationId;
            }
        }
        foreach (var s in shifts) plan[(s.StaffId, s.ShiftDate)] = s.LocationId; // the real schedule wins
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

    private async Task<LeaveBalanceDto> BalanceAsync(int staffId, int year, CancellationToken ct)
    {
        var clinic = await scope.ClinicAsync(ct);
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
            .Date(d.StartDate, "startDate", "start date")
            .Date(d.EndDate, "endDate", "end date")
            .Require(d.EndDate >= d.StartDate, "endDate", "End date must be on or after the start date.")
            .Require(d.EndDate.DayNumber - d.StartDate.DayNumber <= 60, "endDate", "Request at most 60 days at a time.")
            .Require(LeaveTypes.All.Contains(d.LeaveType), "leaveType", "Choose a leave type.")
            .Require(!(d.StartDate == d.EndDate && d.FirstDayHalf && d.LastDayHalf), "lastDayHalf", "For a single half day, tick only the first box.")
            .Text(d.Note, "note", "a note", 500, required: false, multiline: true);
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
