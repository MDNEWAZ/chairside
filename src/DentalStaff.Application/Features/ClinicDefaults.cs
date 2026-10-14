using DentalStaff.Application.Common;
using DentalStaff.Domain.Entities;
using DentalStaff.Domain.Rules;

namespace DentalStaff.Application.Features;

/// <summary>
/// Sensible starting policies for a new clinic, so a manager can build a schedule on day one.
/// Every value is editable data, not code (brief: "read every policy value from the settings tables").
/// </summary>
public static class ClinicDefaults
{
    public static async Task<List<JobTitle>> AddAsync(IAppDbContext db, Clinic clinic, IReadOnlyList<Location> locations, DateOnly today, CancellationToken ct)
    {
        var id = clinic.ClinicId;
        var titles = new List<JobTitle>
        {
            new() { ClinicId = id, Name = "Owner", Role = Roles.OwnerAdmin },
            new() { ClinicId = id, Name = "Practice manager", Role = Roles.PracticeManager },
            new() { ClinicId = id, Name = "Dentist", Role = Roles.ClinicalStaff },
            new() { ClinicId = id, Name = "Hygienist", Role = Roles.ClinicalStaff },
            new() { ClinicId = id, Name = "Dental assistant", Role = Roles.ClinicalStaff },
            new() { ClinicId = id, Name = "Receptionist", Role = Roles.Reception },
        };
        db.JobTitles.AddRange(titles);
        db.ShiftDefinitions.AddRange(
            new ShiftDefinition { ClinicId = id, Name = "Full day", StartTime = new(8, 0), EndTime = new(16, 30), UnpaidBreakMinutes = 30 },
            new ShiftDefinition { ClinicId = id, Name = "Morning", StartTime = new(8, 0), EndTime = new(13, 0), UnpaidBreakMinutes = 0 },
            new ShiftDefinition { ClinicId = id, Name = "Afternoon", StartTime = new(12, 0), EndTime = new(18, 0), UnpaidBreakMinutes = 0 });
        var licence = new CredentialType { ClinicId = id, Name = "State dental licence", BlocksScheduling = true };
        var hygiene = new CredentialType { ClinicId = id, Name = "Dental hygiene licence", BlocksScheduling = true };
        var bls = new CredentialType { ClinicId = id, Name = "CPR / BLS certification", BlocksScheduling = false };
        db.CredentialTypes.AddRange(licence, hygiene, bls);
        foreach (var year in new[] { today.Year, today.Year + 1 })
            foreach (var (date, name) in UsFederalHolidays.For(year).Where(h => h.Date >= today))
                db.ClosedDays.Add(new ClosedDay { ClinicId = id, ClosedOn = date, Name = name });
        await db.SaveChangesAsync(ct);

        int T(string name) => titles.Single(t => t.Name == name).JobTitleId;
        db.CredentialRequirements.AddRange(
            new CredentialTypeJobTitle { ClinicId = id, CredentialTypeId = licence.CredentialTypeId, JobTitleId = T("Dentist") },
            new CredentialTypeJobTitle { ClinicId = id, CredentialTypeId = hygiene.CredentialTypeId, JobTitleId = T("Hygienist") },
            new CredentialTypeJobTitle { ClinicId = id, CredentialTypeId = bls.CredentialTypeId, JobTitleId = T("Dentist") },
            new CredentialTypeJobTitle { ClinicId = id, CredentialTypeId = bls.CredentialTypeId, JobTitleId = T("Hygienist") },
            new CredentialTypeJobTitle { ClinicId = id, CredentialTypeId = bls.CredentialTypeId, JobTitleId = T("Dental assistant") });

        // Weekday minimums: one dentist, one hygienist, one receptionist per open location.
        foreach (var loc in locations)
            foreach (var day in new[] { DayOfWeek.Monday, DayOfWeek.Tuesday, DayOfWeek.Wednesday, DayOfWeek.Thursday, DayOfWeek.Friday })
                foreach (var title in new[] { "Dentist", "Hygienist", "Receptionist" })
                    db.CoverageRules.Add(new CoverageRule { ClinicId = id, LocationId = loc.LocationId, JobTitleId = T(title), Weekday = day, MinHeadcount = 1 });
        await db.SaveChangesAsync(ct);
        return titles;
    }
}
