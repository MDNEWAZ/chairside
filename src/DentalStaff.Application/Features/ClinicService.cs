using DentalStaff.Application.Common;
using DentalStaff.Domain.Entities;
using DentalStaff.Domain.Rules;
using Microsoft.EntityFrameworkCore;

namespace DentalStaff.Application.Features;

public sealed record LookupItem(int Id, string Name);

public sealed record JobTitleItem(int Id, string Name, string Role);

public sealed record ShiftDefinitionItem(int Id, string Name, TimeOnly StartTime, TimeOnly EndTime, int? UnpaidBreakMinutes);

public sealed record CredentialTypeItem(int Id, string Name, bool BlocksScheduling, List<int> RequiredForJobTitleIds);

public sealed record LookupsDto(
    List<LookupItem> Locations, List<JobTitleItem> JobTitles, List<ShiftDefinitionItem> ShiftDefinitions, List<CredentialTypeItem> CredentialTypes);

public sealed record ClinicSettingsDto(
    string Name, string TimeZoneId, DayOfWeek WorkweekStart, decimal OvertimeThresholdHours, int DefaultBreakMinutes, decimal LeaveAllowanceDays);

public sealed record BillingDto(string PlanCode, DateTime TrialEndsUtc, int ActiveStaff, int Locations, int MaxLocations, decimal MonthlyEstimate, bool Simulated);

public sealed record ChangePlanRequest(string PlanCode);

public sealed record AddLocationRequest(string Name, string? Address);

public sealed record CoverageCell(int JobTitleId, DayOfWeek Weekday, int MinHeadcount);

public sealed record CoverageDto(int LocationId, List<CoverageCell> Cells);

public sealed record ClosedDayDto(int ClosedDayId, DateOnly ClosedOn, string Name, int? LocationId);

public sealed record AddClosedDayRequest(DateOnly ClosedOn, string Name, int? LocationId);

public sealed class ClinicService(IAppDbContext db, ICurrentUser user, Access access, ClinicScope scope, IAnalytics analytics)
{
    public static readonly IReadOnlyDictionary<string, decimal> PricePerActiveStaff = new Dictionary<string, decimal>
    {
        [Plans.Trial] = 0m, [Plans.Starter] = 4m, [Plans.Practice] = 6m,
    };

    public async Task<LookupsDto> LookupsAsync(CancellationToken ct)
    {
        var reqs = await db.CredentialRequirements.AsNoTracking().ToListAsync(ct);
        return new LookupsDto(
            await db.Locations.AsNoTracking().Where(l => l.IsActive).OrderBy(l => l.Name).Select(l => new LookupItem(l.LocationId, l.Name)).ToListAsync(ct),
            await db.JobTitles.AsNoTracking().OrderBy(j => j.JobTitleId).Select(j => new JobTitleItem(j.JobTitleId, j.Name, j.Role)).ToListAsync(ct),
            await db.ShiftDefinitions.AsNoTracking().OrderBy(d => d.StartTime).ThenBy(d => d.EndTime)
                .Select(d => new ShiftDefinitionItem(d.ShiftDefinitionId, d.Name, d.StartTime, d.EndTime, d.UnpaidBreakMinutes)).ToListAsync(ct),
            (await db.CredentialTypes.AsNoTracking().OrderBy(c => c.Name).ToListAsync(ct))
                .Select(c => new CredentialTypeItem(c.CredentialTypeId, c.Name, c.BlocksScheduling,
                    reqs.Where(r => r.CredentialTypeId == c.CredentialTypeId).Select(r => r.JobTitleId).ToList())).ToList());
    }

    public async Task<ClinicSettingsDto> SettingsAsync(CancellationToken ct)
    {
        access.RequireManager();
        var c = await scope.ClinicAsync(ct);
        return new ClinicSettingsDto(c.Name, c.TimeZoneId, c.WorkweekStart, c.OvertimeThresholdHours, c.DefaultBreakMinutes, c.LeaveAllowanceDays);
    }

    public async Task<ClinicSettingsDto> UpdateSettingsAsync(ClinicSettingsDto r, CancellationToken ct)
    {
        access.RequireOwner();
        new Validator()
            .Text(r.Name, "name", "the practice name", 150)
            .Require(ClinicCalendar.IsValidZone(r.TimeZoneId ?? ""), "timeZoneId", "Choose a time zone.")
            .Require(Enum.IsDefined(r.WorkweekStart), "workweekStart", "Choose the first day of the workweek.")
            .Require(r.OvertimeThresholdHours is > 0 and <= 80, "overtimeThresholdHours", "Enter between 1 and 80 hours.")
            .Require(r.DefaultBreakMinutes is >= 0 and <= 120, "defaultBreakMinutes", "Enter between 0 and 120 minutes.")
            .Require(r.LeaveAllowanceDays is >= 0 and <= 60, "leaveAllowanceDays", "Enter between 0 and 60 days.")
            .ThrowIfInvalid();

        var clinic = await db.Clinics.SingleAsync(ct);
        clinic.Name = r.Name.Trim();
        clinic.TimeZoneId = r.TimeZoneId!;
        clinic.WorkweekStart = r.WorkweekStart;
        clinic.OvertimeThresholdHours = r.OvertimeThresholdHours;
        clinic.DefaultBreakMinutes = r.DefaultBreakMinutes;
        clinic.LeaveAllowanceDays = r.LeaveAllowanceDays;
        await db.SaveChangesAsync(ct);
        return new ClinicSettingsDto(clinic.Name, clinic.TimeZoneId, clinic.WorkweekStart, clinic.OvertimeThresholdHours, clinic.DefaultBreakMinutes, clinic.LeaveAllowanceDays);
    }

    public async Task<LookupsDto> AddLocationAsync(AddLocationRequest r, CancellationToken ct)
    {
        access.RequireOwner();
        var clinic = await scope.ClinicAsync(ct);
        var count = await db.Locations.CountAsync(l => l.IsActive, ct);
        new Validator()
            .Text(r.Name, "name", "a location name", 100)
            .Text(r.Address, "address", "an address", 300, required: false)
            .Require(IsDemo is false, "name", "Locations cannot be added in the demo clinic. Sign up to set up your own.")
            .Require(count < Plans.MaxLocations(clinic.PlanCode), "name", $"Your plan includes {Plans.MaxLocations(clinic.PlanCode)} location(s). Change plan to add more.")
            .ThrowIfInvalid();
        var name = r.Name.Trim();
        if (await db.Locations.AnyAsync(l => l.Name.ToLower() == name.ToLower(), ct)) throw ValidationException.For("name", "A location with this name already exists.");

        db.Locations.Add(new Location { ClinicId = user.ClinicId, Name = r.Name.Trim(), Address = string.IsNullOrWhiteSpace(r.Address) ? null : r.Address.Trim() });
        await db.SaveChangesAsync(ct);
        analytics.Track("location_added");
        return await LookupsAsync(ct);
    }

    public async Task<BillingDto> BillingAsync(CancellationToken ct)
    {
        access.RequireOwner();
        var clinic = await db.Clinics.AsNoTracking().SingleAsync(ct);
        var active = await db.Staff.CountAsync(s => s.IsActive, ct);
        var locations = await db.Locations.CountAsync(l => l.IsActive, ct);
        var price = PricePerActiveStaff[clinic.PlanCode];
        return new BillingDto(clinic.PlanCode, clinic.TrialEndsUtc, active, locations, Plans.MaxLocations(clinic.PlanCode), active * price, Simulated: true);
    }

    /// <summary>Simulated: no payment provider is called. The plan's location limit is enforced for real.</summary>
    public async Task<BillingDto> ChangePlanAsync(ChangePlanRequest r, CancellationToken ct)
    {
        access.RequireOwner();
        if (IsDemo) throw new ConflictException("The demo clinic's plan cannot be changed. Sign up to try billing on your own clinic.");
        if (!Plans.IsKnown(r.PlanCode) || r.PlanCode == Plans.Trial) throw ValidationException.For("planCode", "Choose Starter or Practice.");
        var locations = await db.Locations.CountAsync(l => l.IsActive, ct);
        if (locations > Plans.MaxLocations(r.PlanCode))
            throw ValidationException.For("planCode", $"Starter includes one location and you have {locations}. Choose Practice.");
        var clinic = await db.Clinics.SingleAsync(ct);
        clinic.PlanCode = r.PlanCode;
        await db.SaveChangesAsync(ct);
        analytics.Track("plan_changed", new { r.PlanCode, simulated = true });
        return await BillingAsync(ct);
    }

    public async Task<CoverageDto> CoverageAsync(int locationId, CancellationToken ct)
    {
        access.RequireManagesLocation(locationId);
        var cells = await db.CoverageRules.AsNoTracking().Where(c => c.LocationId == locationId)
            .Select(c => new CoverageCell(c.JobTitleId, c.Weekday, c.MinHeadcount)).ToListAsync(ct);
        return new CoverageDto(locationId, cells);
    }

    public async Task<CoverageDto> SaveCoverageAsync(CoverageDto r, CancellationToken ct)
    {
        access.RequireOwner();
        var cells = r.Cells ?? [];
        var jobTitleIds = await db.JobTitles.AsNoTracking().Select(j => j.JobTitleId).ToListAsync(ct);
        new Validator()
            .Require(await db.Locations.AnyAsync(l => l.LocationId == r.LocationId, ct), "locationId", "Choose a location.")
            .Require(cells.Count <= jobTitleIds.Count * 7, "cells", "There are more cells than job titles and weekdays.")
            .Require(cells.All(c => jobTitleIds.Contains(c.JobTitleId) && Enum.IsDefined(c.Weekday)), "cells", "Each cell needs a job title and a weekday from this clinic.")
            .Require(cells.DistinctBy(c => (c.JobTitleId, c.Weekday)).Count() == cells.Count, "cells", "Each job title and weekday can appear once.")
            .Require(cells.All(c => c.MinHeadcount is >= 0 and <= 20), "cells", "Each minimum must be between 0 and 20.")
            .ThrowIfInvalid();

        var existing = await db.CoverageRules.Where(c => c.LocationId == r.LocationId).ToListAsync(ct);
        foreach (var cell in cells)
        {
            var rule = existing.FirstOrDefault(e => e.JobTitleId == cell.JobTitleId && e.Weekday == cell.Weekday);
            if (rule is null && cell.MinHeadcount > 0)
                db.CoverageRules.Add(new CoverageRule { ClinicId = user.ClinicId, LocationId = r.LocationId, JobTitleId = cell.JobTitleId, Weekday = cell.Weekday, MinHeadcount = cell.MinHeadcount });
            else if (rule is not null) rule.MinHeadcount = cell.MinHeadcount;
        }
        await db.SaveChangesAsync(ct);
        return await CoverageAsync(r.LocationId, ct);
    }

    public async Task<List<ClosedDayDto>> ClosedDaysAsync(CancellationToken ct)
    {
        var today = await scope.TodayAsync(ct);
        return await db.ClosedDays.AsNoTracking().Where(c => c.ClosedOn >= today).OrderBy(c => c.ClosedOn)
            .Select(c => new ClosedDayDto(c.ClosedDayId, c.ClosedOn, c.Name, c.LocationId)).ToListAsync(ct);
    }

    public async Task<List<ClosedDayDto>> AddClosedDayAsync(AddClosedDayRequest r, CancellationToken ct)
    {
        access.RequireOwner();
        new Validator()
            .Text(r.Name, "name", "a name", 80)
            .Date(r.ClosedOn, "closedOn", "date")
            .Require(r.LocationId is null || await db.Locations.AnyAsync(l => l.LocationId == r.LocationId, ct), "locationId", "Choose a location.")
            .Require(r.ClosedOn >= await scope.TodayAsync(ct), "closedOn", "Choose today or a future date.")
            .ThrowIfInvalid();
        if (await db.ClosedDays.AnyAsync(c => c.ClosedOn == r.ClosedOn && c.LocationId == r.LocationId, ct))
            throw ValidationException.For("closedOn", "This day is already closed for that location.");
        db.ClosedDays.Add(new ClosedDay { ClinicId = user.ClinicId, ClosedOn = r.ClosedOn, Name = r.Name.Trim(), LocationId = r.LocationId });
        await db.SaveChangesAsync(ct);
        return await ClosedDaysAsync(ct);
    }

    public async Task<List<ClosedDayDto>> DeleteClosedDayAsync(int id, CancellationToken ct)
    {
        access.RequireOwner();
        var day = await db.ClosedDays.SingleOrDefaultAsync(c => c.ClosedDayId == id, ct) ?? throw new NotFoundException("This closed day was already removed.");
        db.ClosedDays.Remove(day);
        await db.SaveChangesAsync(ct);
        return await ClosedDaysAsync(ct);
    }

    private bool IsDemo => user.ClinicId == AuthService.DemoClinicId;

    /// <summary>Everything the clinic owns, as JSON. Password hashes and invitation tokens are never included.</summary>
    public async Task<object> ExportAsync(CancellationToken ct)
    {
        access.RequireOwner();
        analytics.Track("data_exported");
        return new
        {
            exportedAtUtc = DateTime.UtcNow,
            clinic = await SettingsAsync(ct),
            locations = await db.Locations.AsNoTracking().ToListAsync(ct),
            jobTitles = await db.JobTitles.AsNoTracking().ToListAsync(ct),
            staff = await db.Staff.AsNoTracking().Select(s => new { s.StaffId, s.FirstName, s.LastName, s.Email, s.Phone, s.Role, s.JobTitleId, s.HomeLocationId, s.StartDate, s.IsActive, s.OvertimeEligible, s.EmploymentType }).ToListAsync(ct),
            workPatterns = await db.WorkPatterns.AsNoTracking().Include(p => p.Days).ToListAsync(ct),
            shiftDefinitions = await db.ShiftDefinitions.AsNoTracking().ToListAsync(ct),
            shifts = await db.Shifts.AsNoTracking().ToListAsync(ct),
            leaveRequests = await db.LeaveRequests.AsNoTracking().ToListAsync(ct),
            attendance = await db.Attendance.AsNoTracking().ToListAsync(ct),
            credentialTypes = await db.CredentialTypes.AsNoTracking().ToListAsync(ct),
            credentials = await db.Credentials.AsNoTracking().ToListAsync(ct),
            coverageRules = await db.CoverageRules.AsNoTracking().ToListAsync(ct),
            closedDays = await db.ClosedDays.AsNoTracking().ToListAsync(ct),
            scheduleOverrides = await db.ScheduleOverrides.AsNoTracking().ToListAsync(ct),
        };
    }
}
