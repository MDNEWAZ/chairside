using DentalStaff.Application.Common;
using DentalStaff.Domain.Entities;
using DentalStaff.Domain.Rules;
using Microsoft.EntityFrameworkCore;

namespace DentalStaff.Application.Features;

public sealed record WorkingTodayDto(int StaffId, string Name, string JobTitle, TimeOnly StartTime, TimeOnly EndTime, string Status);

public sealed record ExpiringCredentialDto(int StaffId, string Name, string Credential, DateOnly ExpiresOn, string Status);

public sealed record ChecklistDto(bool AddedStaff, bool SetWorkPattern, bool PublishedSchedule, bool InvitedSomeone);

public sealed record DashboardDto(
    int LocationId, DateOnly Today, List<WorkingTodayDto> WorkingToday, List<LeaveDto> OnLeaveToday, int PendingLeave,
    List<ExpiringCredentialDto> Credentials, List<AttendanceDto> NeedsAttention, int WeekIssues, int WeekBlocks, int WeekDrafts,
    ChecklistDto? Checklist);

public sealed record NotificationDto(int NotificationId, string Type, string Message, bool IsRead, DateTime CreatedAtUtc);

public sealed record NotificationsDto(int Unread, List<NotificationDto> Items);

public sealed record AuditDto(long AuditId, DateTime AtUtc, string? Who, string Action, string EntityName, string EntityId, string? OldValue, string? NewValue);

public sealed class DashboardService(
    IAppDbContext db, ICurrentUser user, Access access, ClinicScope scope, IClock clock,
    ScheduleService schedule, LeaveService leave, AttendanceService attendance)
{
    public async Task<DashboardDto> TodayAsync(int? locationId, CancellationToken ct)
    {
        access.RequireManager();
        var loc = locationId ?? user.HomeLocationId;
        access.RequireManagesLocation(loc);
        var calendar = await scope.CalendarAsync(ct);
        var today = calendar.Today(clock.UtcNow);

        var shifts = await (
            from s in db.Shifts.AsNoTracking()
            join st in db.Staff on s.StaffId equals st.StaffId
            join j in db.JobTitles on st.JobTitleId equals j.JobTitleId
            where s.LocationId == loc && s.ShiftDate == today && s.IsPublished
            orderby s.StartTime
            select new { s.StaffId, Name = st.FirstName + " " + st.LastName, Job = j.Name, s.StartTime, s.EndTime }).ToListAsync(ct);
        var startOfToday = calendar.ToUtc(today, TimeOnly.MinValue);
        var clocks = await db.Attendance.AsNoTracking().Where(a => a.ClockInUtc >= startOfToday).ToListAsync(ct);
        var working = shifts.Select(s =>
        {
            var rec = clocks.Where(c => c.StaffId == s.StaffId).MaxBy(c => c.ClockInUtc);
            var status = rec is null ? "not_in" : rec.ClockOutUtc is null ? "clocked_in" : "clocked_out";
            return new WorkingTodayDto(s.StaffId, s.Name, s.Job, s.StartTime, s.EndTime, status);
        }).ToList();

        var homeStaff = await db.Staff.AsNoTracking().Where(s => s.IsActive && s.HomeLocationId == loc).Select(s => s.StaffId).ToListAsync(ct);
        var onLeave = (await leave.TeamAsync(today, today, ct)).Where(l => homeStaff.Contains(l.StaffId)).ToList();
        var inbox = await leave.InboxAsync(ct);

        var credentials = await (
            from c in db.Credentials.AsNoTracking()
            join t in db.CredentialTypes on c.CredentialTypeId equals t.CredentialTypeId
            join s in db.Staff on c.StaffId equals s.StaffId
            where homeStaff.Contains(c.StaffId) && c.ExpiresOn <= today.AddDays(StaffService.ExpiringSoonDays)
            orderby c.ExpiresOn
            select new { c.StaffId, Person = s.FirstName + " " + s.LastName, Credential = t.Name, c.ExpiresOn, c.CredentialTypeId }).ToListAsync(ct);
        // A credential renewed with a newer record is no longer a concern.
        var latest = await db.Credentials.AsNoTracking().Where(c => homeStaff.Contains(c.StaffId))
            .GroupBy(c => new { c.StaffId, c.CredentialTypeId }).Select(g => new { g.Key.StaffId, g.Key.CredentialTypeId, Max = g.Max(x => x.ExpiresOn) }).ToListAsync(ct);
        var expiring = credentials
            .Where(c => latest.Any(l => l.StaffId == c.StaffId && l.CredentialTypeId == c.CredentialTypeId && l.Max == c.ExpiresOn))
            .Select(c => new ExpiringCredentialDto(c.StaffId, c.Person, c.Credential, c.ExpiresOn, StaffService.StatusOf(c.ExpiresOn, today))).ToList();

        var needsAttention = (await attendance.ForLocationAsync(loc, today, ct))
            .Concat(await attendance.ForLocationAsync(loc, today.AddDays(-7), ct))
            .Where(a => a.MissingClockOut || (a.IsUnscheduled && !a.UnscheduledConfirmed))
            .DistinctBy(a => a.AttendanceId).ToList();

        var week = await schedule.GetWeekAsync(loc, today, ct);
        ChecklistDto? checklist = null;
        if (access.IsOwner)
        {
            checklist = new ChecklistDto(
                await db.Staff.CountAsync(ct) > 1,
                await db.WorkPatterns.AnyAsync(ct),
                await db.Shifts.AnyAsync(s => s.IsPublished, ct),
                await db.Invitations.AnyAsync(i => i.ClinicId == user.ClinicId, ct));
        }

        return new DashboardDto(loc, today, working, onLeave, inbox.Count, expiring, needsAttention,
            week.Issues.Count, week.Issues.Count(i => i.Severity == nameof(IssueSeverity.Block)), week.DraftCount, checklist);
    }
}

public sealed class NotificationService(IAppDbContext db, ICurrentUser user)
{
    public async Task<NotificationsDto> ListAsync(CancellationToken ct)
    {
        var mine = db.Notifications.AsNoTracking().Where(n => n.RecipientStaffId == user.StaffId);
        return new NotificationsDto(
            await mine.CountAsync(n => !n.IsRead, ct),
            await mine.OrderByDescending(n => n.CreatedAtUtc).ThenByDescending(n => n.NotificationId).Take(30)
                .Select(n => new NotificationDto(n.NotificationId, n.Type, n.Message, n.IsRead, n.CreatedAtUtc)).ToListAsync(ct));
    }

    public async Task<NotificationsDto> MarkAllReadAsync(CancellationToken ct)
    {
        var unread = await db.Notifications.Where(n => n.RecipientStaffId == user.StaffId && !n.IsRead).ToListAsync(ct);
        unread.ForEach(n => n.IsRead = true);
        await db.SaveChangesAsync(ct);
        return await ListAsync(ct);
    }
}

public sealed class AuditService(IAppDbContext db, Access access)
{
    public async Task<List<AuditDto>> ListAsync(string? entity, int page, CancellationToken ct)
    {
        access.RequireOwner();
        var q = db.AuditLog.AsNoTracking();
        if (!string.IsNullOrWhiteSpace(entity)) q = q.Where(a => a.EntityName == entity);
        return await (
            from a in q
            join u in db.UserAccounts on a.UserId equals u.UserId into users
            from u in users.DefaultIfEmpty()
            orderby a.AtUtc descending, a.AuditId descending
            select new AuditDto(a.AuditId, a.AtUtc, u == null ? null : u.Email, a.Action, a.EntityName, a.EntityId, a.OldValue, a.NewValue))
            .Skip(Math.Max(0, page) * 50).Take(50).ToListAsync(ct);
    }
}
