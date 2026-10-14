using DentalStaff.Domain.Entities;
using Microsoft.EntityFrameworkCore;

namespace DentalStaff.Application.Common;

/// <summary>Writes in-app notifications and sends the matching (simulated) email.</summary>
public sealed class Notifier(IAppDbContext db, IEmailSender email, ICurrentUser user)
{
    public async Task NotifyAsync(IEnumerable<int> staffIds, string type, string message, CancellationToken ct)
    {
        var ids = staffIds.Distinct().ToList();
        if (ids.Count == 0) return;

        foreach (var id in ids)
            db.Notifications.Add(new Notification { ClinicId = user.ClinicId, RecipientStaffId = id, Type = type, Message = message });

        var recipients = await db.Staff.AsNoTracking().Where(s => ids.Contains(s.StaffId) && s.IsActive).Select(s => s.Email).ToListAsync(ct);
        foreach (var to in recipients)
            await email.SendAsync(to, "Chairside update", message, ct);
    }

    /// <summary>Managers of a location: its Practice Manager(s) and every Owner / Admin.</summary>
    public Task<List<int>> ManagersOfAsync(int locationId, CancellationToken ct) =>
        db.Staff.AsNoTracking()
            .Where(s => s.IsActive && (s.Role == Roles.OwnerAdmin || (s.Role == Roles.PracticeManager && s.HomeLocationId == locationId)))
            .Select(s => s.StaffId)
            .ToListAsync(ct);
}
