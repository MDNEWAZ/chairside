using DentalStaff.Application.Common;
using DentalStaff.Application.Features;
using DentalStaff.Domain.Entities;
using DentalStaff.Domain.Rules;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace DentalStaff.Infrastructure.Persistence;

/// <summary>
/// Seeds "Bright Smiles Dental", a realistic two-location demo clinic, and keeps its schedule current:
/// on every start it makes sure this week (published) and next week (draft) have shifts.
/// Demo sign-in is by role, without a password, and works only for this clinic.
/// </summary>
public static class DemoSeeder
{
    private sealed record Person(string First, string Last, string Title, int Loc, string Pattern, string? Email = null, bool OvertimeEligible = true, string Type = "full_time");

    // Pattern: one letter per weekday Mon..Sun. F = Full day, M = Morning, A = Afternoon, D/R = Full day at the other location, - = off.
    private static readonly Person[] People =
    [
        new("Maya", "Patel", "Owner", 0, "-------", AuthService.DemoPersonas["owner"], OvertimeEligible: false),
        new("Jordan", "Lee", "Practice manager", 0, "FFFFF--", AuthService.DemoPersonas["manager"], OvertimeEligible: false),
        new("Sam", "Rivera", "Practice manager", 1, "FFFFF--", OvertimeEligible: false),
        new("Ethan", "Brooks", "Dentist", 0, "FFFF---"),
        new("Priya", "Nair", "Dentist", 0, "-FFFFR-"),
        new("Lucas", "Moreno", "Dentist", 1, "FFFFF--"),
        new("Grace", "Kim", "Hygienist", 0, "FFFFF--", AuthService.DemoPersonas["hygienist"]),
        new("Noah", "Bennett", "Hygienist", 0, "MM-MM--", Type: "part_time"),
        new("Ava", "Thompson", "Hygienist", 1, "FFFFDD-"),
        new("Leila", "Haddad", "Hygienist", 1, "-FFFF--"),
        new("Chloe", "Nguyen", "Dental assistant", 0, "FFFFF--"),
        new("Marcus", "Allen", "Dental assistant", 0, "AAAA---", Type: "part_time"),
        new("Sofia", "Romero", "Dental assistant", 1, "FFFFF--"),
        new("Daniel", "Okafor", "Dental assistant", 1, "-FFFFF-"),
        new("Hannah", "Wright", "Receptionist", 0, "FFFFF--", AuthService.DemoPersonas["reception"]),
        new("Owen", "Clarke", "Receptionist", 1, "FFFFF--"),
    ];

    public static async Task RunAsync(IServiceProvider services, CancellationToken ct = default)
    {
        using var scope = services.CreateScope();
        var tenant = scope.ServiceProvider.GetRequiredService<ITenantContext>();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var passwords = scope.ServiceProvider.GetRequiredService<IPasswordService>();
        var logger = scope.ServiceProvider.GetRequiredService<ILoggerFactory>().CreateLogger("DemoSeeder");
        var id = AuthService.DemoClinicId;
        tenant.Set(id, null);

        if (!await db.Clinics.AnyAsync(ct))
        {
            await SeedClinicAsync(db, passwords, id, ct);
            logger.LogInformation("Seeded demo clinic {ClinicId}", id);
        }
        await EnsureCurrentWeeksAsync(db, id, ct);
    }

    private static async Task SeedClinicAsync(AppDbContext db, IPasswordService passwords, Guid id, CancellationToken ct)
    {
        var clinic = new Clinic { ClinicId = id, Name = "Bright Smiles Dental", TimeZoneId = "America/New_York", IsDemo = true, PlanCode = Plans.Practice, TrialEndsUtc = DateTime.UtcNow.AddYears(10) };
        db.Clinics.Add(clinic);
        await db.SaveChangesAsync(ct);

        var locations = new List<Location>
        {
            new() { ClinicId = id, Name = "Downtown", Address = "120 Main Street, Springfield" },
            new() { ClinicId = id, Name = "Riverside", Address = "48 River Road, Springfield" },
        };
        db.Locations.AddRange(locations);
        await db.SaveChangesAsync(ct);

        var calendar = new ClinicCalendar(clinic.TimeZoneId, clinic.WorkweekStart);
        var today = calendar.Today(DateTime.UtcNow);
        var titles = await ClinicDefaults.AddAsync(db, clinic, locations, today, ct);
        var defs = await db.ShiftDefinitions.ToDictionaryAsync(d => d.Name, ct);

        var staff = new List<Staff>();
        foreach (var p in People)
        {
            var title = titles.Single(t => t.Name == p.Title);
            int? userId = null;
            if (p.Email is not null)
            {
                // Random password nobody knows: demo personas sign in through the demo endpoint only.
                var user = new UserAccount { ClinicId = id, Email = p.Email, PasswordHash = passwords.Hash(Guid.NewGuid().ToString("N")) };
                db.UserAccounts.Add(user);
                await db.SaveChangesAsync(ct);
                userId = user.UserId;
            }
            staff.Add(new Staff
            {
                ClinicId = id, UserId = userId, FirstName = p.First, LastName = p.Last,
                Email = p.Email ?? $"{p.First}.{p.Last}@brightsmiles.test".ToLowerInvariant(),
                Phone = $"(555) 01{staff.Count:00}-{1000 + staff.Count * 37}", Role = title.Role, JobTitleId = title.JobTitleId,
                HomeLocationId = locations[p.Loc].LocationId, StartDate = today.AddMonths(-6 - staff.Count * 3),
                OvertimeEligible = p.OvertimeEligible, EmploymentType = p.Type,
            });
        }
        db.Staff.AddRange(staff);
        await db.SaveChangesAsync(ct);

        for (var i = 0; i < People.Length; i++)
        {
            var p = People[i];
            var pattern = new StaffWorkPattern { ClinicId = id, StaffId = staff[i].StaffId, EffectiveFrom = today.AddMonths(-3) };
            for (var d = 0; d < 7; d++)
            {
                var code = p.Pattern[d];
                if (code == '-') continue;
                var other = code is 'D' or 'R';
                pattern.Days.Add(new StaffWorkPatternDay
                {
                    ClinicId = id, Weekday = (DayOfWeek)((d + 1) % 7),
                    ShiftDefinitionId = defs[code switch { 'M' => "Morning", 'A' => "Afternoon", _ => "Full day" }].ShiftDefinitionId,
                    LocationId = locations[other ? 1 - p.Loc : p.Loc].LocationId,
                });
            }
            if (pattern.Days.Count > 0) db.WorkPatterns.Add(pattern);
        }

        // Credentials: all valid, except one expired dentist licence (shows the publish block) and two expiring soon.
        var types = await db.CredentialTypes.ToDictionaryAsync(t => t.Name, ct);
        var reqs = await db.CredentialRequirements.ToListAsync(ct);
        foreach (var s in staff)
            foreach (var r in reqs.Where(r => r.JobTitleId == s.JobTitleId))
                db.Credentials.Add(new Credential { ClinicId = id, StaffId = s.StaffId, CredentialTypeId = r.CredentialTypeId, ExpiresOn = today.AddMonths(8 + s.StaffId % 12) });
        await db.SaveChangesAsync(ct);

        Staff Who(string first) => staff.Single(s => s.FirstName == first);
        int lucasId = Who("Lucas").StaffId, graceId = Who("Grace").StaffId, priyaId = Who("Priya").StaffId;
        int licenceTypeId = types["State dental licence"].CredentialTypeId, blsTypeId = types["CPR / BLS certification"].CredentialTypeId;
        var lucasLicence = await db.Credentials.SingleAsync(c => c.StaffId == lucasId && c.CredentialTypeId == licenceTypeId, ct);
        lucasLicence.ExpiresOn = today.AddDays(-3);
        var graceBls = await db.Credentials.SingleAsync(c => c.StaffId == graceId && c.CredentialTypeId == blsTypeId, ct);
        graceBls.ExpiresOn = today.AddDays(12);
        var priyaLicence = await db.Credentials.SingleAsync(c => c.StaffId == priyaId && c.CredentialTypeId == licenceTypeId, ct);
        priyaLicence.ExpiresOn = today.AddDays(24);

        // Leave: one approved next week, two pending for the managers' inboxes.
        var nextWeek = calendar.WeekStartFor(today).AddDays(7);
        db.LeaveRequests.AddRange(
            new LeaveRequest { ClinicId = id, StaffId = Who("Chloe").StaffId, StartDate = nextWeek.AddDays(2), EndDate = nextWeek.AddDays(3), LeaveType = LeaveTypes.Annual, DaysCounted = 2, Status = LeaveStatuses.Approved, DecidedByStaffId = Who("Jordan").StaffId, DecidedAtUtc = DateTime.UtcNow.AddDays(-2), CreatedAtUtc = DateTime.UtcNow.AddDays(-4) },
            new LeaveRequest { ClinicId = id, StaffId = Who("Ethan").StaffId, StartDate = nextWeek.AddDays(1), EndDate = nextWeek.AddDays(1), LeaveType = LeaveTypes.Annual, DaysCounted = 1, Status = LeaveStatuses.Pending, Note = "Family event", CreatedAtUtc = DateTime.UtcNow.AddDays(-1) },
            new LeaveRequest { ClinicId = id, StaffId = Who("Noah").StaffId, StartDate = nextWeek.AddDays(3), EndDate = nextWeek.AddDays(4), FirstDayHalf = true, LeaveType = LeaveTypes.Annual, DaysCounted = 1.5m, Status = LeaveStatuses.Pending, CreatedAtUtc = DateTime.UtcNow.AddHours(-5) },
            new LeaveRequest { ClinicId = id, StaffId = Who("Grace").StaffId, StartDate = today.AddMonths(-2), EndDate = today.AddMonths(-2).AddDays(1), LeaveType = LeaveTypes.Annual, DaysCounted = 2, Status = LeaveStatuses.Approved, DecidedByStaffId = Who("Jordan").StaffId, DecidedAtUtc = DateTime.UtcNow.AddMonths(-2), CreatedAtUtc = DateTime.UtcNow.AddMonths(-2) });

        db.Notifications.AddRange(
            new Notification { ClinicId = id, RecipientStaffId = Who("Jordan").StaffId, Type = "leave_requested", Message = "Ethan Brooks requested 1 day(s) of annual leave." },
            new Notification { ClinicId = id, RecipientStaffId = Who("Grace").StaffId, Type = "credential_expiring", Message = "Your CPR / BLS certification expires in 12 days." });
        await db.SaveChangesAsync(ct);
    }

    /// <summary>
    /// Keeps the demo alive over time: last week and this week published, next week as a draft, and attendance for the
    /// last working day, including one missing clock-out and one unscheduled clock-in at Downtown.
    /// </summary>
    private static async Task EnsureCurrentWeeksAsync(AppDbContext db, Guid id, CancellationToken ct)
    {
        var clinic = await db.Clinics.SingleAsync(ct);
        var calendar = new ClinicCalendar(clinic.TimeZoneId, clinic.WorkweekStart);
        var today = calendar.Today(DateTime.UtcNow);
        var thisWeek = calendar.WeekStartFor(today);

        foreach (var (week, publish) in new[] { (thisWeek.AddDays(-7), true), (thisWeek, true), (thisWeek.AddDays(7), false) })
        {
            if (await db.Shifts.AnyAsync(s => s.ShiftDate >= week && s.ShiftDate <= week.AddDays(6), ct)) continue;

            var patterns = await db.WorkPatterns.AsNoTracking().Include(p => p.Days).ToListAsync(ct);
            var defs = await db.ShiftDefinitions.AsNoTracking().ToDictionaryAsync(d => d.ShiftDefinitionId, ct);
            var closed = await db.ClosedDays.AsNoTracking().Where(c => c.ClosedOn >= week && c.ClosedOn <= week.AddDays(6)).ToListAsync(ct);
            var leave = await db.LeaveRequests.AsNoTracking().Where(l => l.Status == LeaveStatuses.Approved).ToListAsync(ct);
            for (var date = week; date <= week.AddDays(6); date = date.AddDays(1))
                foreach (var p in patterns)
                {
                    var day = p.Days.FirstOrDefault(d => d.Weekday == date.DayOfWeek);
                    if (day is null || closed.Any(c => c.ClosedOn == date && c.AppliesTo(day.LocationId)) || leave.Any(l => l.StaffId == p.StaffId && l.IsFullDayOff(date))) continue;
                    var def = defs[day.ShiftDefinitionId];
                    db.Shifts.Add(new Shift
                    {
                        ClinicId = id, StaffId = p.StaffId, LocationId = day.LocationId, ShiftDate = date, StartTime = def.StartTime, EndTime = def.EndTime,
                        UnpaidBreakMinutes = def.UnpaidBreakMinutes ?? clinic.DefaultBreakMinutes, IsPublished = publish, UpdatedAtUtc = DateTime.UtcNow,
                    });
                }
            await db.SaveChangesAsync(ct);
        }

        if (await db.Attendance.AnyAsync(ct)) return;

        var downtown = await db.Locations.Where(l => l.Name == "Downtown").Select(l => l.LocationId).SingleAsync(ct);
        var lastDay = await db.Shifts.Where(s => s.IsPublished && s.ShiftDate < today && s.LocationId == downtown).MaxAsync(s => (DateOnly?)s.ShiftDate, ct);
        if (lastDay is not { } workDay) return;

        var shifts = await db.Shifts.AsNoTracking().Where(s => s.ShiftDate == workDay && s.IsPublished).OrderBy(s => s.LocationId).ThenBy(s => s.ShiftId).ToListAsync(ct);
        var clinical = await db.Staff.AsNoTracking().Where(s => s.Role == Roles.ClinicalStaff).Select(s => s.StaffId).ToListAsync(ct);
        var forgetful = shifts.FirstOrDefault(s => s.LocationId == downtown && clinical.Contains(s.StaffId))?.ShiftId;
        foreach (var (s, i) in shifts.Select((s, i) => (s, i)))
            db.Attendance.Add(new AttendanceRecord
            {
                ClinicId = id, StaffId = s.StaffId, ShiftId = s.ShiftId, LocationId = s.LocationId,
                ClockInUtc = calendar.ToUtc(workDay, s.StartTime.AddMinutes(-5 + i % 7)),
                ClockOutUtc = s.ShiftId == forgetful ? null : calendar.ToUtc(workDay, s.EndTime.AddMinutes(i % 9)),
                UnpaidBreakMinutes = s.UnpaidBreakMinutes,
            });

        // Marcus works afternoons; he came in early for training without a scheduled shift.
        var marcus = await db.Staff.AsNoTracking().SingleAsync(s => s.FirstName == "Marcus" && s.LastName == "Allen", ct);
        db.Attendance.Add(new AttendanceRecord
        {
            ClinicId = id, StaffId = marcus.StaffId, LocationId = downtown, IsUnscheduled = true, UnpaidBreakMinutes = 0,
            ClockInUtc = calendar.ToUtc(workDay, new TimeOnly(8, 2)), ClockOutUtc = calendar.ToUtc(workDay, new TimeOnly(11, 31)),
        });
        await db.SaveChangesAsync(ct);
    }
}
