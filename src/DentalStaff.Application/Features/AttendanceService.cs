using DentalStaff.Application.Common;
using DentalStaff.Domain.Entities;
using DentalStaff.Domain.Rules;
using Microsoft.EntityFrameworkCore;

namespace DentalStaff.Application.Features;

public sealed record AttendanceDto(
    int AttendanceId, int StaffId, string StaffName, int LocationId, string LocationName, DateTime ClockInUtc, DateTime? ClockOutUtc,
    int UnpaidBreakMinutes, decimal? PaidHours, bool IsUnscheduled, bool UnscheduledConfirmed, bool MissingClockOut,
    bool WeeklyOvertime, string? CorrectionNote);

public sealed record TodayShiftDto(int ShiftId, int LocationId, string LocationName, TimeOnly StartTime, TimeOnly EndTime);

public sealed record ClockStatusDto(
    AttendanceDto? Open, TodayShiftDto? TodayShift, int DefaultLocationId, List<LocationOptionDto> Locations, List<AttendanceDto> Recent, DateTime ServerUtc);

public sealed record LocationOptionDto(int LocationId, string Name);

public sealed record ClockInRequest(int LocationId);

public sealed record CorrectAttendanceRequest(DateOnly ClockInDate, TimeOnly ClockInTime, DateOnly? ClockOutDate, TimeOnly? ClockOutTime, int UnpaidBreakMinutes, string Note);

public sealed class AttendanceService(
    IAppDbContext db, ICurrentUser user, Access access, ClinicScope scope, Notifier notifier, IClock clock, IAnalytics analytics)
{
    private const int MaxShiftHours = 16;

    public async Task<ClockStatusDto> StatusAsync(CancellationToken ct)
    {
        var calendar = await scope.CalendarAsync(ct);
        var today = calendar.Today(clock.UtcNow);
        var locations = await db.Locations.AsNoTracking().Where(l => l.IsActive).OrderBy(l => l.Name)
            .Select(l => new LocationOptionDto(l.LocationId, l.Name)).ToListAsync(ct);
        var todayShift = await (
            from s in db.Shifts.AsNoTracking()
            join l in db.Locations on s.LocationId equals l.LocationId
            where s.StaffId == user.StaffId && s.ShiftDate == today && s.IsPublished
            orderby s.StartTime
            select new TodayShiftDto(s.ShiftId, s.LocationId, l.Name, s.StartTime, s.EndTime)).FirstOrDefaultAsync(ct);

        var since = clock.UtcNow.AddDays(-14);
        var recent = await ListAsync(r => r.StaffId == user.StaffId && r.ClockInUtc >= since, ct);
        var open = recent.FirstOrDefault(r => r.ClockOutUtc is null && !r.MissingClockOut);
        return new ClockStatusDto(open, todayShift, todayShift?.LocationId ?? user.HomeLocationId, locations, recent, clock.UtcNow);
    }

    public async Task<ClockStatusDto> ClockInAsync(ClockInRequest r, CancellationToken ct)
    {
        var calendar = await scope.CalendarAsync(ct);
        var today = calendar.Today(clock.UtcNow);
        if (!await db.Locations.AnyAsync(l => l.LocationId == r.LocationId && l.IsActive, ct))
            throw ValidationException.For("locationId", "Choose the location you are at.");

        var startOfToday = calendar.ToUtc(today, TimeOnly.MinValue);
        if (await db.Attendance.AnyAsync(a => a.StaffId == user.StaffId && a.ClockOutUtc == null && a.ClockInUtc >= startOfToday, ct))
            throw new ConflictException("You are already clocked in. Clock out first.");

        var shift = await db.Shifts.AsNoTracking()
            .Where(s => s.StaffId == user.StaffId && s.ShiftDate == today && s.LocationId == r.LocationId && s.IsPublished)
            .FirstOrDefaultAsync(ct);
        var clinic = await scope.ClinicAsync(ct);
        db.Attendance.Add(new AttendanceRecord
        {
            ClinicId = user.ClinicId, StaffId = user.StaffId, ShiftId = shift?.ShiftId, LocationId = r.LocationId,
            UnpaidBreakMinutes = shift?.UnpaidBreakMinutes ?? clinic.DefaultBreakMinutes, IsUnscheduled = shift is null,
            // ClockInUtc is left unset: the database default SYSUTCDATETIME() supplies it.
        });
        if (shift is null)
        {
            var name = await db.Staff.Where(s => s.StaffId == user.StaffId).Select(s => s.FirstName + " " + s.LastName).SingleAsync(ct);
            var managers = (await notifier.ManagersOfAsync(r.LocationId, ct)).Where(id => id != user.StaffId);
            await notifier.NotifyAsync(managers, "unscheduled_clock_in", $"{name} clocked in without a scheduled shift. Please confirm it.", ct);
        }
        await db.SaveChangesAsync(ct);
        analytics.Track("clocked_in", new { unscheduled = shift is null });
        return await StatusAsync(ct);
    }

    public async Task<ClockStatusDto> ClockOutAsync(CancellationToken ct)
    {
        var calendar = await scope.CalendarAsync(ct);
        var startOfToday = calendar.ToUtc(calendar.Today(clock.UtcNow), TimeOnly.MinValue);
        var open = await db.Attendance.AsNoTracking()
            .Where(a => a.StaffId == user.StaffId && a.ClockOutUtc == null && a.ClockInUtc >= startOfToday)
            .Select(a => (int?)a.AttendanceId).FirstOrDefaultAsync(ct);
        if (open is null) throw new ConflictException("You are not clocked in today.");

        await db.ClockOutAsync(open.Value, ct);
        analytics.Track("clocked_out");
        return await StatusAsync(ct);
    }

    public async Task<List<AttendanceDto>> ForLocationAsync(int locationId, DateOnly? anyDateInWeek, CancellationToken ct)
    {
        access.RequireManagesLocation(locationId);
        var calendar = await scope.CalendarAsync(ct);
        var weekStart = calendar.WeekStartFor(anyDateInWeek ?? calendar.Today(clock.UtcNow));
        var from = calendar.ToUtc(weekStart, TimeOnly.MinValue);
        var to = calendar.ToUtc(weekStart.AddDays(7), TimeOnly.MinValue);
        return await ListAsync(a => a.LocationId == locationId && a.ClockInUtc >= from && a.ClockInUtc < to, ct);
    }

    public async Task<AttendanceDto> CorrectAsync(int id, CorrectAttendanceRequest r, CancellationToken ct)
    {
        var record = await LoadForManagerAsync(id, ct);
        var calendar = await scope.CalendarAsync(ct);
        var inUtc = calendar.ToUtc(r.ClockInDate, r.ClockInTime);
        DateTime? outUtc = r.ClockOutDate is { } d && r.ClockOutTime is { } t ? calendar.ToUtc(d, t) : null;

        var v = new Validator()
            .Text(r.Note, "note", "a note explaining the correction", 300)
            .Require(r.UnpaidBreakMinutes is >= 0 and <= 120, "unpaidBreakMinutes", "Break must be between 0 and 120 minutes.")
            .Require((r.ClockOutDate is null) == (r.ClockOutTime is null), "clockOutTime", "Enter both the clock-out date and time.")
            .Require(inUtc <= clock.UtcNow, "clockInTime", "Clock-in cannot be in the future.");
        if (outUtc is { } o)
        {
            v.Require(o > inUtc, "clockOutTime", "Clock-out must be after clock-in.")
             .Require(o <= clock.UtcNow, "clockOutTime", "Clock-out cannot be in the future.")
             .Require((o - inUtc).TotalHours <= MaxShiftHours, "clockOutTime", $"A record cannot be longer than {MaxShiftHours} hours.")
             .Require(r.UnpaidBreakMinutes < (o - inUtc).TotalMinutes, "unpaidBreakMinutes", "Break must be shorter than the time worked.");
        }
        v.ThrowIfInvalid();

        record.ClockInUtc = inUtc;
        record.ClockOutUtc = outUtc;
        record.UnpaidBreakMinutes = r.UnpaidBreakMinutes;
        record.CorrectedByStaffId = user.StaffId;
        record.CorrectionNote = r.Note.Trim();
        await db.SaveChangesAsync(ct);
        analytics.Track("attendance_corrected");
        return (await ListAsync(a => a.AttendanceId == id, ct)).Single();
    }

    public async Task<AttendanceDto> ConfirmUnscheduledAsync(int id, CancellationToken ct)
    {
        var record = await LoadForManagerAsync(id, ct);
        if (!record.IsUnscheduled) throw new ConflictException("This record has a scheduled shift and needs no confirmation.");
        record.UnscheduledConfirmedByStaffId = user.StaffId;
        await db.SaveChangesAsync(ct);
        return (await ListAsync(a => a.AttendanceId == id, ct)).Single();
    }

    private async Task<AttendanceRecord> LoadForManagerAsync(int id, CancellationToken ct)
    {
        var record = await db.Attendance.SingleOrDefaultAsync(a => a.AttendanceId == id, ct) ?? throw new NotFoundException("This attendance record no longer exists.");
        access.RequireManagesLocation(record.LocationId);
        if (record.StaffId == user.StaffId) throw new ForbiddenException("You cannot correct your own attendance. Ask the Owner / Admin.");
        return record;
    }

    private async Task<List<AttendanceDto>> ListAsync(System.Linq.Expressions.Expression<Func<AttendanceRecord, bool>> filter, CancellationToken ct)
    {
        var calendar = await scope.CalendarAsync(ct);
        var clinic = await scope.ClinicAsync(ct);
        var today = calendar.Today(clock.UtcNow);

        var rows = await (
            from a in db.Attendance.AsNoTracking().Where(filter)
            join s in db.Staff on a.StaffId equals s.StaffId
            join l in db.Locations on a.LocationId equals l.LocationId
            orderby a.ClockInUtc descending
            select new { a, s.FirstName, s.LastName, s.OvertimeEligible, l.Name }).Take(500).ToListAsync(ct);

        // Weekly hours add up across both locations for the workweek in the clinic settings.
        var weeks = rows.Select(x => (x.a.StaffId, Week: calendar.WeekStartFor(DateOnly.FromDateTime(calendar.ToLocal(x.a.ClockInUtc))))).Distinct().ToList();
        var weeklyHours = new Dictionary<(int, DateOnly), decimal>();
        foreach (var (staffId, week) in weeks)
        {
            var from = calendar.ToUtc(week, TimeOnly.MinValue);
            var to = calendar.ToUtc(week.AddDays(7), TimeOnly.MinValue);
            var records = await db.Attendance.AsNoTracking().Where(a => a.StaffId == staffId && a.ClockInUtc >= from && a.ClockInUtc < to).ToListAsync(ct);
            weeklyHours[(staffId, week)] = records.Sum(r => r.PaidHours ?? 0);
        }

        return rows.Select(x =>
        {
            var localDate = DateOnly.FromDateTime(calendar.ToLocal(x.a.ClockInUtc));
            var week = calendar.WeekStartFor(localDate);
            var missing = x.a.ClockOutUtc is null && (localDate < today || (clock.UtcNow - x.a.ClockInUtc).TotalHours > MaxShiftHours);
            return new AttendanceDto(x.a.AttendanceId, x.a.StaffId, $"{x.FirstName} {x.LastName}", x.a.LocationId, x.Name,
                x.a.ClockInUtc, x.a.ClockOutUtc, x.a.UnpaidBreakMinutes, x.a.PaidHours, x.a.IsUnscheduled,
                x.a.UnscheduledConfirmedByStaffId is not null, missing,
                x.OvertimeEligible && weeklyHours[(x.a.StaffId, week)] > clinic.OvertimeThresholdHours, x.a.CorrectionNote);
        }).ToList();
    }
}
