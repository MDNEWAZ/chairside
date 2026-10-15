using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;
using DentalStaff.Application.Common;
using DentalStaff.Domain.Entities;
using DentalStaff.Domain.Rules;
using Microsoft.EntityFrameworkCore;

namespace DentalStaff.Application.Features;

public sealed record SignupRequest(
    string ClinicName, string FirstName, string LastName, string Email, string Password,
    string TimeZoneId, List<string> LocationNames);

public sealed record LoginRequest(string Email, string Password);

public sealed record AcceptInviteRequest(string Token, string Password);

public sealed record ClinicSummaryDto(string Name, string PlanCode, DateTime TrialEndsUtc, bool IsDemo, string TimeZoneId);

public sealed record MeDto(
    int StaffId, string FirstName, string LastName, string Email, string Role, string JobTitle,
    int HomeLocationId, string HomeLocationName, ClinicSummaryDto Clinic);

/// <summary>What the API needs to issue the auth cookie. The stamp ties the cookie to the account's current sign-in generation.</summary>
public sealed record SignedInUser(Guid ClinicId, int UserId, int StaffId, string Role, int HomeLocationId, Guid SecurityStamp);

public sealed class AuthService(
    IAppDbContext db, ITenantContext tenant, IPasswordService passwords, IClock clock, IAnalytics analytics)
{
    public const int MinPasswordLength = PasswordPolicy.MinLength;
    public static readonly Guid DemoClinicId = Guid.Parse("6d3f8f0e-1b7a-4c51-9a55-0d3c0de11c01");
    public static readonly IReadOnlyDictionary<string, string> DemoPersonas = new Dictionary<string, string>
    {
        ["owner"] = "owner@demo.chairside.test",
        ["manager"] = "manager@demo.chairside.test",
        ["hygienist"] = "hygienist@demo.chairside.test",
        ["reception"] = "reception@demo.chairside.test",
    };

    private const string BadSignIn = "The email or password is not right. Check them and try again.";
    private const string UnusableInvite = "This invitation link has expired or was already used. Ask your clinic to send a new one.";

    public async Task<SignedInUser> SignupAsync(SignupRequest r, CancellationToken ct)
    {
        var locations = (r.LocationNames ?? []).Select(n => n?.Trim() ?? "").Where(n => n.Length > 0).ToList();
        var v = new Validator()
            .Text(r.ClinicName, "clinicName", "your practice name", 150)
            .Text(r.FirstName, "firstName", "your first name", 60)
            .Text(r.LastName, "lastName", "your last name", 60)
            .Email(r.Email, "email")
            .Require(ClinicCalendar.IsValidZone(r.TimeZoneId ?? ""), "timeZoneId", "Choose your time zone.")
            .Require(locations.Count is >= 1 and <= 3, "locationNames", "Add between one and three locations.")
            .Require(locations.Distinct(StringComparer.OrdinalIgnoreCase).Count() == locations.Count, "locationNames", "Each location needs a different name.");
        foreach (var n in locations) v.Text(n, "locationNames", "a location name", 100);
        PasswordPolicy.Validate(v, r.Password, r.Email);
        v.ThrowIfInvalid();

        var email = r.Email.Trim().ToLowerInvariant();
        if (await db.UserAccounts.AnyAsync(u => u.Email == email, ct))
            throw ValidationException.For("email", "An account with this email already exists. Sign in instead.");

        var clinicId = Guid.NewGuid();
        tenant.Set(clinicId, null);

        var signedIn = await db.InTransactionAsync(async () =>
        {
            var clinic = new Clinic
            {
                ClinicId = clinicId, Name = r.ClinicName.Trim(), TimeZoneId = r.TimeZoneId,
                TrialEndsUtc = clock.UtcNow.AddDays(14),
            };
            db.Clinics.Add(clinic);
            await db.SaveChangesAsync(ct); // separate saves: the model has no navigations, so EF cannot order dependent inserts

            var user = new UserAccount { ClinicId = clinicId, Email = email, PasswordHash = passwords.Hash(r.Password) };
            db.UserAccounts.Add(user);
            var locs = locations.Select(n => new Location { ClinicId = clinicId, Name = n }).ToList();
            db.Locations.AddRange(locs);
            await db.SaveChangesAsync(ct);

            var titles = await ClinicDefaults.AddAsync(db, clinic, locs, new ClinicCalendar(clinic.TimeZoneId, clinic.WorkweekStart).Today(clock.UtcNow), ct);
            var owner = new Staff
            {
                ClinicId = clinicId, UserId = user.UserId, FirstName = r.FirstName.Trim(), LastName = r.LastName.Trim(),
                Email = email, Role = Roles.OwnerAdmin, JobTitleId = titles.Single(t => t.Role == Roles.OwnerAdmin).JobTitleId,
                HomeLocationId = locs[0].LocationId, StartDate = DateOnly.FromDateTime(clock.UtcNow),
                OvertimeEligible = false,
            };
            db.Staff.Add(owner);
            await db.SaveChangesAsync(ct);
            return new SignedInUser(clinicId, user.UserId, owner.StaffId, owner.Role, owner.HomeLocationId, user.SecurityStamp);
        }, ct);

        analytics.Track("clinic_signed_up", new { locations = locations.Count });
        return signedIn;
    }

    public async Task<SignedInUser> LoginAsync(LoginRequest r, CancellationToken ct)
    {
        var email = (r.Email ?? "").Trim().ToLowerInvariant();
        // Per-account throttle on top of the per-IP rate limit, so a guess spread across many addresses still stops.
        if (LoginThrottle.IsLocked(email, clock.UtcNow))
            throw new ConflictException("Too many sign-in attempts for this account. Wait 15 minutes and try again.");

        var password = r.Password ?? "";
        var tooLong = password.Length > PasswordPolicy.MaxLength;
        var user = tooLong || email.Length > 256 ? null : await db.UserAccounts.SingleOrDefaultAsync(u => u.Email == email, ct);
        // Same message and the same hashing work for unknown emails, so responses do not reveal which emails exist.
        var ok = passwords.Verify(user?.PasswordHash ?? DummyHash, tooLong ? "" : password) && user is not null;
        if (!ok)
        {
            LoginThrottle.RecordFailure(email, clock.UtcNow);
            throw ValidationException.For("password", BadSignIn);
        }
        LoginThrottle.Reset(email);

        var signedIn = await SignInAsync(user!, ct);
        analytics.Track("signed_in");
        return signedIn;
    }

    public async Task<SignedInUser> DemoLoginAsync(string persona, CancellationToken ct)
    {
        if (!DemoPersonas.TryGetValue(persona ?? "", out var email))
            throw ValidationException.For("persona", "Choose one of the demo roles.");
        var user = await db.UserAccounts.SingleOrDefaultAsync(u => u.Email == email && u.ClinicId == DemoClinicId, ct)
                   ?? throw new NotFoundException("The demo clinic is not set up yet. Restart the API to seed it.");
        analytics.Track("demo_started", new { persona });
        return await SignInAsync(user, ct);
    }

    public async Task<SignedInUser> AcceptInviteAsync(AcceptInviteRequest r, CancellationToken ct)
    {
        var hash = HashToken(r.Token ?? "");
        var invite = await db.Invitations.SingleOrDefaultAsync(i => i.TokenHash == hash, ct);
        if (invite is null || invite.AcceptedUtc is not null || invite.RevokedUtc is not null || invite.ExpiresUtc < clock.UtcNow)
            throw new NotFoundException(UnusableInvite);

        tenant.Set(invite.ClinicId, null);
        var staff = await db.Staff.SingleAsync(s => s.StaffId == invite.StaffId, ct);
        // An invitation only creates a first account, for the address it was sent to. It can never take over a profile.
        if (!staff.IsActive || staff.UserId is not null
            || !string.Equals(invite.Email, staff.Email, StringComparison.OrdinalIgnoreCase))
            throw new NotFoundException(UnusableInvite);

        var v = new Validator();
        PasswordPolicy.Validate(v, r.Password, staff.Email);
        v.ThrowIfInvalid();
        if (await db.UserAccounts.AnyAsync(u => u.Email == staff.Email, ct))
            throw new ConflictException("An account with this email already exists. Sign in instead.");

        return await db.InTransactionAsync(async () =>
        {
            // Two tabs accepting the same link at once: the second waits here, then sees it was used.
            await db.AcquireLockAsync($"invite:{invite.InvitationId}", ct);
            var used = await db.Invitations.AsNoTracking()
                .AnyAsync(i => i.InvitationId == invite.InvitationId && i.AcceptedUtc != null, ct);
            if (used) throw new NotFoundException(UnusableInvite);

            var user = new UserAccount { ClinicId = invite.ClinicId, Email = staff.Email, PasswordHash = passwords.Hash(r.Password!) };
            db.UserAccounts.Add(user);
            await db.SaveChangesAsync(ct);
            staff.UserId = user.UserId;
            invite.AcceptedUtc = clock.UtcNow;
            await db.SaveChangesAsync(ct);
            analytics.Track("invite_accepted");
            return new SignedInUser(invite.ClinicId, user.UserId, staff.StaffId, staff.Role, staff.HomeLocationId, user.SecurityStamp);
        }, ct);
    }

    /// <summary>
    /// Re-reads the person on every request so deactivation and role changes apply at once. A changed security
    /// stamp (sign out, deactivation) ends every existing session of that account.
    /// </summary>
    public async Task<SignedInUser?> RefreshAsync(Guid clinicId, int userId, Guid securityStamp, CancellationToken ct)
    {
        tenant.Set(clinicId, userId);
        var stamp = await db.UserAccounts.AsNoTracking()
            .Where(u => u.UserId == userId).Select(u => (Guid?)u.SecurityStamp).SingleOrDefaultAsync(ct);
        if (stamp != securityStamp) return null;
        var staff = await db.Staff.AsNoTracking().SingleOrDefaultAsync(s => s.UserId == userId && s.IsActive, ct);
        return staff is null ? null : new SignedInUser(clinicId, userId, staff.StaffId, staff.Role, staff.HomeLocationId, securityStamp);
    }

    /// <summary>Ends every session of this account, on every device.</summary>
    public async Task SignOutEverywhereAsync(int userId, CancellationToken ct)
    {
        var user = await db.UserAccounts.SingleOrDefaultAsync(u => u.UserId == userId, ct);
        if (user is null) return;
        user.SecurityStamp = Guid.NewGuid();
        await db.SaveChangesAsync(ct);
    }

    public async Task<MeDto> MeAsync(int staffId, CancellationToken ct)
    {
        var clinic = await db.Clinics.AsNoTracking().SingleAsync(ct);
        return await (
            from s in db.Staff.AsNoTracking()
            join j in db.JobTitles on s.JobTitleId equals j.JobTitleId
            join l in db.Locations on s.HomeLocationId equals l.LocationId
            where s.StaffId == staffId
            select new MeDto(s.StaffId, s.FirstName, s.LastName, s.Email, s.Role, j.Name, l.LocationId, l.Name,
                new ClinicSummaryDto(clinic.Name, clinic.PlanCode, clinic.TrialEndsUtc, clinic.IsDemo, clinic.TimeZoneId))
        ).SingleAsync(ct);
    }

    public static string HashToken(string token) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token))).ToLowerInvariant();

    public static string NewToken() => Convert.ToBase64String(RandomNumberGenerator.GetBytes(32))
        .Replace('+', '-').Replace('/', '_').TrimEnd('=');

    private async Task<SignedInUser> SignInAsync(UserAccount user, CancellationToken ct)
    {
        tenant.Set(user.ClinicId, user.UserId);
        var staff = await db.Staff.AsNoTracking().SingleOrDefaultAsync(s => s.UserId == user.UserId, ct);
        if (staff is null || !staff.IsActive)
            throw ValidationException.For("password", "This account is no longer active. Contact your clinic's owner.");
        user.LastLoginUtc = clock.UtcNow;
        await db.SaveChangesAsync(ct);
        return new SignedInUser(user.ClinicId, user.UserId, staff.StaffId, staff.Role, staff.HomeLocationId, user.SecurityStamp);
    }

    private static string? _dummyHash;
    private string DummyHash => _dummyHash ??= passwords.Hash(Guid.NewGuid().ToString());
}

/// <summary>In-memory per-account sign-in throttle: five failures within 15 minutes lock that email for the rest of the window.</summary>
internal static class LoginThrottle
{
    private const int MaxFailures = 5;
    private static readonly TimeSpan Window = TimeSpan.FromMinutes(15);
    private static readonly ConcurrentDictionary<string, (int Count, DateTime Since)> Failures = new();

    public static bool IsLocked(string email, DateTime now) =>
        Failures.TryGetValue(email, out var f) && f.Count >= MaxFailures && now - f.Since < Window;

    public static void RecordFailure(string email, DateTime now)
    {
        if (Failures.Count > 10_000) Failures.Clear(); // bound memory under a spray of random addresses
        Failures.AddOrUpdate(email, (1, now), (_, f) => now - f.Since >= Window ? (1, now) : (f.Count + 1, f.Since));
    }

    public static void Reset(string email) => Failures.TryRemove(email, out _);
}
