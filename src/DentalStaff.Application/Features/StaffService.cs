using DentalStaff.Application.Common;
using DentalStaff.Domain.Entities;
using Microsoft.EntityFrameworkCore;

namespace DentalStaff.Application.Features;

public sealed record DirectoryItemDto(
    int StaffId, string Name, string Role, string JobTitle, int HomeLocationId, string HomeLocation, bool IsActive,
    bool HasAccount, string? CredentialStatus);

public sealed record PatternDayDto(DayOfWeek Weekday, int ShiftDefinitionId, int LocationId);

public sealed record CredentialDto(int CredentialId, int CredentialTypeId, string Name, DateOnly ExpiresOn, string Status, bool Required);

public sealed record StaffDetailDto(
    int StaffId, string FirstName, string LastName, string Email, string? Phone, string Role, int JobTitleId, int HomeLocationId,
    DateOnly StartDate, bool IsActive, bool OvertimeEligible, string EmploymentType, bool HasAccount, bool InvitePending,
    List<PatternDayDto> Pattern, DateOnly? PatternEffectiveFrom, List<CredentialDto> Credentials, bool CanEdit, bool CanInvite);

public sealed record StaffInput(
    string FirstName, string LastName, string Email, string? Phone, int JobTitleId, int HomeLocationId, DateOnly StartDate,
    bool OvertimeEligible, string EmploymentType, List<PatternDayDto> Pattern);

public sealed record InviteResultDto(string AcceptUrlPath, DateTime ExpiresUtc, string Note);

public sealed record AddCredentialRequest(int CredentialTypeId, DateOnly ExpiresOn);

public sealed class StaffService(
    IAppDbContext db, ICurrentUser user, Access access, ClinicScope scope, IEmailSender email, IClock clock, IAnalytics analytics)
{
    public const int ExpiringSoonDays = 30;

    public async Task<List<DirectoryItemDto>> DirectoryAsync(string? search, bool includeInactive, CancellationToken ct)
    {
        var q = db.Staff.AsNoTracking().AsQueryable();
        // Practice Managers see names and roles at both locations; clinical staff and reception see their own location.
        if (!access.IsManager) q = q.Where(s => s.HomeLocationId == user.HomeLocationId);
        if (!includeInactive || !access.IsManager) q = q.Where(s => s.IsActive);
        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = search.Trim();
            q = q.Where(s => (s.FirstName + " " + s.LastName).Contains(term) || s.Email.Contains(term));
        }

        var rows = await (
            from s in q
            join j in db.JobTitles on s.JobTitleId equals j.JobTitleId
            join l in db.Locations on s.HomeLocationId equals l.LocationId
            orderby s.LastName, s.FirstName
            select new { s, Job = j.Name, Loc = l.Name }).Take(500).ToListAsync(ct);

        var statuses = await CredentialStatusesAsync(ct);
        return rows.Select(x => new DirectoryItemDto(x.s.StaffId, x.s.FullName, x.s.Role, x.Job, x.s.HomeLocationId, x.Loc, x.s.IsActive,
            x.s.UserId is not null, access.ManagesLocation(x.s.HomeLocationId) ? statuses.GetValueOrDefault(x.s.StaffId) : null)).ToList();
    }

    public async Task<StaffDetailDto> GetAsync(int id, CancellationToken ct)
    {
        var s = await db.Staff.AsNoTracking().SingleOrDefaultAsync(x => x.StaffId == id, ct) ?? throw new NotFoundException("This staff member does not exist.");
        var canEdit = access.ManagesLocation(s.HomeLocationId) && (access.IsOwner || s.Role is Roles.ClinicalStaff or Roles.Reception);
        if (!canEdit && id != user.StaffId && !access.ManagesLocation(s.HomeLocationId))
            throw new ForbiddenException("You can only view your own profile.");

        var pattern = await CurrentPatternAsync(id, ct);
        var invitePending = await db.Invitations.AnyAsync(i => i.StaffId == id && i.AcceptedUtc == null && i.RevokedUtc == null && i.ExpiresUtc > clock.UtcNow, ct);
        return new StaffDetailDto(s.StaffId, s.FirstName, s.LastName, s.Email, s.Phone, s.Role, s.JobTitleId, s.HomeLocationId, s.StartDate,
            s.IsActive, s.OvertimeEligible, s.EmploymentType, s.UserId is not null, invitePending,
            pattern?.Days.OrderBy(d => ((int)d.Weekday + 6) % 7).Select(d => new PatternDayDto(d.Weekday, d.ShiftDefinitionId, d.LocationId)).ToList() ?? [],
            pattern?.EffectiveFrom, await CredentialsAsync(s, ct), canEdit, access.IsOwner && s.UserId is null && s.IsActive);
    }

    public async Task<StaffDetailDto> CreateAsync(StaffInput input, CancellationToken ct)
    {
        access.RequireManager();
        var jobTitle = await ValidateAsync(input, null, ct);
        var staff = new Staff { ClinicId = user.ClinicId };
        Apply(staff, input, jobTitle);
        // One unit: a failed pattern save must not leave a half-created person behind.
        await db.InTransactionAsync(async () =>
        {
            db.Staff.Add(staff);
            await db.SaveChangesAsync(ct);
            await SavePatternAsync(staff.StaffId, input.Pattern, ct);
            return true;
        }, ct);
        analytics.Track("staff_added", new { role = staff.Role });
        return await GetAsync(staff.StaffId, ct);
    }

    public async Task<StaffDetailDto> UpdateAsync(int id, StaffInput input, CancellationToken ct)
    {
        var staff = await db.Staff.SingleOrDefaultAsync(s => s.StaffId == id, ct) ?? throw new NotFoundException("This staff member does not exist.");
        RequireCanEdit(staff);
        var jobTitle = await ValidateAsync(input, id, ct);
        if (staff.StaffId == user.StaffId && jobTitle.Role != staff.Role)
            throw ValidationException.For("jobTitleId", "You cannot change your own role.");
        var newEmail = (input.Email ?? "").Trim().ToLowerInvariant();
        // The sign-in email lives on the account; changing it here would split the two and could hand the profile to someone else.
        if (staff.UserId is not null && newEmail != staff.Email)
            throw ValidationException.For("email", "This person already signs in with this email, so it cannot be changed here.");
        if (IsDemo && staff.UserId is not null && jobTitle.Role != staff.Role)
            throw ValidationException.For("jobTitleId", "Demo sign-in roles cannot be changed, so the demo keeps working for everyone.");
        Apply(staff, input, jobTitle);
        await db.InTransactionAsync(async () =>
        {
            await db.SaveChangesAsync(ct);
            await SavePatternAsync(id, input.Pattern, ct);
            return true;
        }, ct);
        return await GetAsync(id, ct);
    }

    public async Task<StaffDetailDto> SetActiveAsync(int id, bool active, CancellationToken ct)
    {
        var staff = await db.Staff.SingleOrDefaultAsync(s => s.StaffId == id, ct) ?? throw new NotFoundException("This staff member does not exist.");
        RequireCanEdit(staff);
        if (staff.StaffId == user.StaffId) throw new ConflictException("You cannot deactivate yourself.");
        if (IsDemo && staff.UserId is not null && !active)
            throw new ConflictException("Demo sign-in people cannot be deactivated, so the demo keeps working for everyone.");
        if (staff.IsActive == active) return await GetAsync(id, ct);

        var today = await scope.TodayAsync(ct);
        await db.InTransactionAsync(async () =>
        {
            staff.IsActive = active; // never deleted: history stays (brief: deactivate, do not delete)
            if (!active)
            {
                // Someone who has left cannot work future shifts, take pending leave, accept an invitation, or stay signed in.
                var future = await db.Shifts.Where(s => s.StaffId == id && s.ShiftDate > today).ToListAsync(ct);
                var futureIds = future.Select(f => f.ShiftId).ToList();
                db.ScheduleOverrides.RemoveRange(await db.ScheduleOverrides.Where(o => futureIds.Contains(o.ShiftId)).ToListAsync(ct));
                db.Shifts.RemoveRange(future);
                foreach (var leave in await db.LeaveRequests.Where(l => l.StaffId == id && l.Status == LeaveStatuses.Pending).ToListAsync(ct))
                {
                    leave.Status = LeaveStatuses.Rejected;
                    leave.DecidedByStaffId = user.StaffId;
                    leave.DecidedAtUtc = clock.UtcNow;
                    leave.DecisionComment = "Closed automatically: this person was deactivated.";
                }
                foreach (var invite in await db.Invitations.Where(i => i.StaffId == id && i.AcceptedUtc == null && i.RevokedUtc == null).ToListAsync(ct))
                    invite.RevokedUtc = clock.UtcNow;
                if (staff.UserId is { } userId && await db.UserAccounts.SingleOrDefaultAsync(u => u.UserId == userId, ct) is { } account)
                    account.SecurityStamp = Guid.NewGuid();
            }
            await db.SaveChangesAsync(ct);
            return true;
        }, ct);
        return await GetAsync(id, ct);
    }

    public async Task<InviteResultDto> InviteAsync(int id, CancellationToken ct)
    {
        access.RequireOwner();
        var staff = await db.Staff.AsNoTracking().SingleOrDefaultAsync(s => s.StaffId == id, ct) ?? throw new NotFoundException("This staff member does not exist.");
        if (staff.UserId is not null) throw new ConflictException("This person already has an account.");
        if (!staff.IsActive) throw new ConflictException("Reactivate this person before inviting them.");
        if (IsDemo) throw new ConflictException("Invitations are turned off in the demo clinic. Sign up for your own clinic to invite your team.");

        var token = AuthService.NewToken();
        // A new link replaces any earlier one, and only works for the address it was sent to.
        foreach (var old in await db.Invitations.Where(i => i.StaffId == id && i.AcceptedUtc == null && i.RevokedUtc == null).ToListAsync(ct))
            old.RevokedUtc = clock.UtcNow;
        var invite = new Invitation
        {
            ClinicId = user.ClinicId, StaffId = id, Email = staff.Email, TokenHash = AuthService.HashToken(token), ExpiresUtc = clock.UtcNow.AddDays(7),
        };
        db.Invitations.Add(invite);
        await db.SaveChangesAsync(ct);
        var path = $"/invite/{token}";
        await email.SendAsync(staff.Email, "You're invited to Chairside", $"Set your password to join your clinic: {path}", ct);
        analytics.Track("staff_invited");
        return new InviteResultDto(path, invite.ExpiresUtc, "Email sending is simulated in this prototype. Share this link with the person directly.");
    }

    public async Task<StaffDetailDto> AddCredentialAsync(int staffId, AddCredentialRequest r, CancellationToken ct)
    {
        var staff = await db.Staff.AsNoTracking().SingleOrDefaultAsync(s => s.StaffId == staffId, ct) ?? throw new NotFoundException("This staff member does not exist.");
        RequireCanEditCredentials(staff);
        new Validator()
            .Require(await db.CredentialTypes.AnyAsync(c => c.CredentialTypeId == r.CredentialTypeId, ct), "credentialTypeId", "Choose a credential type.")
            .Date(r.ExpiresOn, "expiresOn", "expiry date")
            .ThrowIfInvalid();
        db.Credentials.Add(new Credential { ClinicId = user.ClinicId, StaffId = staffId, CredentialTypeId = r.CredentialTypeId, ExpiresOn = r.ExpiresOn });
        await db.SaveChangesAsync(ct);
        return await GetAsync(staffId, ct);
    }

    public async Task<StaffDetailDto> DeleteCredentialAsync(int staffId, int credentialId, CancellationToken ct)
    {
        var credential = await db.Credentials.SingleOrDefaultAsync(c => c.CredentialId == credentialId && c.StaffId == staffId, ct)
                         ?? throw new NotFoundException("This credential was already removed.");
        var staff = await db.Staff.AsNoTracking().SingleAsync(s => s.StaffId == staffId, ct);
        RequireCanEditCredentials(staff);
        db.Credentials.Remove(credential);
        await db.SaveChangesAsync(ct);
        return await GetAsync(staffId, ct);
    }

    /// <summary>Worst credential status per person: expired, missing, expiring, or valid.</summary>
    public async Task<Dictionary<int, string>> CredentialStatusesAsync(CancellationToken ct)
    {
        var today = await scope.TodayAsync(ct);
        var staff = await db.Staff.AsNoTracking().Where(s => s.IsActive).Select(s => new { s.StaffId, s.JobTitleId }).ToListAsync(ct);
        var reqs = await db.CredentialRequirements.AsNoTracking().ToListAsync(ct);
        var creds = await db.Credentials.AsNoTracking().ToListAsync(ct);
        var result = new Dictionary<int, string>();
        foreach (var s in staff)
        {
            var statuses = reqs.Where(r => r.JobTitleId == s.JobTitleId).Select(r =>
            {
                var latest = creds.Where(c => c.StaffId == s.StaffId && c.CredentialTypeId == r.CredentialTypeId).Select(c => (DateOnly?)c.ExpiresOn).Max();
                return latest is null ? "missing" : StatusOf(latest.Value, today);
            }).ToList();
            result[s.StaffId] = new[] { "expired", "missing", "expiring", "valid" }.FirstOrDefault(statuses.Contains) ?? "valid";
        }
        return result;
    }

    public static string StatusOf(DateOnly expiresOn, DateOnly today) =>
        expiresOn < today ? "expired" : expiresOn <= today.AddDays(ExpiringSoonDays) ? "expiring" : "valid";

    private async Task<List<CredentialDto>> CredentialsAsync(Staff s, CancellationToken ct)
    {
        var today = await scope.TodayAsync(ct);
        var required = await db.CredentialRequirements.AsNoTracking().Where(r => r.JobTitleId == s.JobTitleId).Select(r => r.CredentialTypeId).ToListAsync(ct);
        var rows = await (
            from c in db.Credentials.AsNoTracking()
            join t in db.CredentialTypes on c.CredentialTypeId equals t.CredentialTypeId
            where c.StaffId == s.StaffId
            orderby c.ExpiresOn
            select new { c, t.Name }).ToListAsync(ct);
        return rows.Select(x => new CredentialDto(x.c.CredentialId, x.c.CredentialTypeId, x.Name, x.c.ExpiresOn,
            StatusOf(x.c.ExpiresOn, today), required.Contains(x.c.CredentialTypeId))).ToList();
    }

    private Task<StaffWorkPattern?> CurrentPatternAsync(int staffId, CancellationToken ct) =>
        db.WorkPatterns.AsNoTracking().Include(p => p.Days).Where(p => p.StaffId == staffId)
            .OrderByDescending(p => p.EffectiveFrom).FirstOrDefaultAsync(ct);

    /// <summary>A changed pattern becomes a new version from today, so leave already counted does not change.</summary>
    private async Task SavePatternAsync(int staffId, List<PatternDayDto> days, CancellationToken ct)
    {
        var current = await CurrentPatternAsync(staffId, ct);
        var same = current is not null && current.Days.Count == days.Count && days.All(d =>
            current.Days.Any(c => c.Weekday == d.Weekday && c.ShiftDefinitionId == d.ShiftDefinitionId && c.LocationId == d.LocationId));
        if (same || (current is null && days.Count == 0)) return;

        var today = await scope.TodayAsync(ct);
        var version = await db.WorkPatterns.Include(p => p.Days).SingleOrDefaultAsync(p => p.StaffId == staffId && p.EffectiveFrom == today, ct);
        if (version is null)
        {
            version = new StaffWorkPattern { ClinicId = user.ClinicId, StaffId = staffId, EffectiveFrom = today };
            db.WorkPatterns.Add(version);
        }
        version.Days.Clear();
        version.Days.AddRange(days.Select(d => new StaffWorkPatternDay { ClinicId = user.ClinicId, Weekday = d.Weekday, ShiftDefinitionId = d.ShiftDefinitionId, LocationId = d.LocationId }));
        await db.SaveChangesAsync(ct);
    }

    private bool IsDemo => user.ClinicId == AuthService.DemoClinicId;

    /// <summary>
    /// Licences gate publishing, so only the Owner / Admin may change a manager's. A Practice Manager therefore
    /// can never change their own.
    /// </summary>
    private void RequireCanEditCredentials(Staff staff)
    {
        access.RequireManagesLocation(staff.HomeLocationId);
        if (!access.IsOwner && staff.Role is not (Roles.ClinicalStaff or Roles.Reception))
            throw new ForbiddenException("Only the Owner / Admin can change a manager's credentials.");
    }

    private void RequireCanEdit(Staff staff)
    {
        access.RequireManagesLocation(staff.HomeLocationId);
        if (!access.IsOwner && staff.Role is not (Roles.ClinicalStaff or Roles.Reception))
            throw new ForbiddenException("Only the Owner / Admin can edit managers.");
    }

    private static void Apply(Staff s, StaffInput input, JobTitle jobTitle)
    {
        s.FirstName = input.FirstName.Trim();
        s.LastName = input.LastName.Trim();
        s.Email = input.Email.Trim().ToLowerInvariant();
        s.Phone = string.IsNullOrWhiteSpace(input.Phone) ? null : input.Phone.Trim();
        s.JobTitleId = jobTitle.JobTitleId;
        s.Role = jobTitle.Role; // the role comes from the job title, so permissions follow the fixed list
        s.HomeLocationId = input.HomeLocationId;
        s.StartDate = input.StartDate;
        s.OvertimeEligible = input.OvertimeEligible;
        s.EmploymentType = input.EmploymentType;
    }

    private async Task<JobTitle> ValidateAsync(StaffInput input, int? staffId, CancellationToken ct)
    {
        var jobTitle = await db.JobTitles.AsNoTracking().SingleOrDefaultAsync(j => j.JobTitleId == input.JobTitleId, ct);
        var locationIds = await db.Locations.Where(l => l.IsActive).Select(l => l.LocationId).ToListAsync(ct);
        var definitionIds = await db.ShiftDefinitions.Select(d => d.ShiftDefinitionId).ToListAsync(ct);
        var email = (input.Email ?? "").Trim().ToLowerInvariant();
        var pattern = input.Pattern ?? [];

        var v = new Validator()
            .Text(input.FirstName, "firstName", "a first name", 60)
            .Text(input.LastName, "lastName", "a last name", 60)
            .Email(input.Email, "email")
            .Text(input.Phone, "phone", "a phone number", 30, required: false)
            .Require(jobTitle is not null, "jobTitleId", "Choose a job title.")
            .Require(locationIds.Contains(input.HomeLocationId), "homeLocationId", "Choose a home location.")
            .Require(input.EmploymentType is "full_time" or "part_time", "employmentType", "Choose full time or part time.")
            .Require(pattern.Count <= 7 && pattern.All(p => Enum.IsDefined(p.Weekday)), "pattern", "Choose working days from Monday to Sunday.")
            .Require(pattern.Select(p => p.Weekday).Distinct().Count() == pattern.Count, "pattern", "Each weekday can appear once.")
            .Date(input.StartDate, "startDate", "start date")
            .Require(pattern.All(p => locationIds.Contains(p.LocationId) && definitionIds.Contains(p.ShiftDefinitionId)), "pattern", "Choose a shift and location for each working day.");
        if (jobTitle is not null)
        {
            v.Require(access.IsOwner || jobTitle.Role is Roles.ClinicalStaff or Roles.Reception, "jobTitleId", "Only the Owner / Admin can assign manager or owner roles.");
            v.Require(access.ManagesLocation(input.HomeLocationId), "homeLocationId", "You can only add staff to your own location.");
        }
        if (!string.IsNullOrEmpty(email))
            v.Require(!await db.Staff.AnyAsync(s => s.Email == email && s.StaffId != staffId, ct), "email", "Someone in your clinic already uses this email.");
        v.ThrowIfInvalid();
        return jobTitle!;
    }
}
