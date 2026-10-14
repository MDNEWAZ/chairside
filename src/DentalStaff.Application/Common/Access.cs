using DentalStaff.Domain.Entities;
using DentalStaff.Domain.Rules;
using Microsoft.EntityFrameworkCore;

namespace DentalStaff.Application.Common;

/// <summary>
/// Role and location rules from the roles matrix. Tenant isolation is enforced separately by
/// row-level security in the database; these checks decide what a role may do inside its clinic.
/// </summary>
public sealed class Access(ICurrentUser user)
{
    public bool IsOwner => user.Role == Roles.OwnerAdmin;
    public bool IsManager => Roles.IsManager(user.Role);

    public void RequireOwner()
    {
        if (!IsOwner) throw new ForbiddenException("Only the Owner / Admin can do this.");
    }

    public void RequireManager()
    {
        if (!IsManager) throw new ForbiddenException("Only managers can do this.");
    }

    /// <summary>Owner manages every location; a Practice Manager manages their home location only.</summary>
    public bool ManagesLocation(int locationId) => IsOwner || (user.Role == Roles.PracticeManager && user.HomeLocationId == locationId);

    public void RequireManagesLocation(int locationId)
    {
        if (!ManagesLocation(locationId)) throw new ForbiddenException("You can only manage your own location.");
    }

    /// <summary>Visible location ids for location-scoped lists, or null for all.</summary>
    public int? ScopedLocationId => IsOwner ? null : user.HomeLocationId;
}

/// <summary>Per-request cache of the signed-in clinic's settings and calendar.</summary>
public sealed class ClinicScope(IAppDbContext db, IClock clock)
{
    private Clinic? _clinic;

    public async Task<Clinic> ClinicAsync(CancellationToken ct) =>
        _clinic ??= await db.Clinics.AsNoTracking().SingleAsync(ct);

    public async Task<ClinicCalendar> CalendarAsync(CancellationToken ct)
    {
        var clinic = await ClinicAsync(ct);
        return new ClinicCalendar(clinic.TimeZoneId, clinic.WorkweekStart);
    }

    public async Task<DateOnly> TodayAsync(CancellationToken ct) => (await CalendarAsync(ct)).Today(clock.UtcNow);
}
