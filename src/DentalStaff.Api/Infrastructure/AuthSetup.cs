using System.Security.Claims;
using DentalStaff.Application.Common;
using DentalStaff.Application.Features;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;

namespace DentalStaff.Api.Infrastructure;

public static class ClaimNames
{
    public const string ClinicId = "cid";
    public const string UserId = "uid";
    public const string StaffId = "sid";
    public const string HomeLocationId = "loc";
    public const string SecurityStamp = "stm";
}

public sealed class CurrentUser(IHttpContextAccessor accessor) : ICurrentUser
{
    private ClaimsPrincipal Principal => accessor.HttpContext?.User ?? new ClaimsPrincipal();

    public bool IsAuthenticated => Principal.Identity?.IsAuthenticated == true;
    public Guid ClinicId => Guid.Parse(Value(ClaimNames.ClinicId));
    public int UserId => int.Parse(Value(ClaimNames.UserId));
    public int StaffId => int.Parse(Value(ClaimNames.StaffId));
    public string Role => Value(ClaimTypes.Role);
    public int HomeLocationId => int.Parse(Value(ClaimNames.HomeLocationId));

    private string Value(string type) =>
        Principal.FindFirstValue(type) ?? throw new UnauthorizedAccessException("Not signed in.");
}

public static class AuthSetup
{
    public static ClaimsPrincipal ToPrincipal(SignedInUser u) => new(new ClaimsIdentity(
    [
        new Claim(ClaimNames.ClinicId, u.ClinicId.ToString()),
        new Claim(ClaimNames.UserId, u.UserId.ToString()),
        new Claim(ClaimNames.StaffId, u.StaffId.ToString()),
        new Claim(ClaimTypes.Role, u.Role),
        new Claim(ClaimNames.HomeLocationId, u.HomeLocationId.ToString()),
        new Claim(ClaimNames.SecurityStamp, u.SecurityStamp.ToString()),
    ], CookieAuthenticationDefaults.AuthenticationScheme));

    public static IServiceCollection AddCookieAuth(this IServiceCollection services, bool requireHttps)
    {
        services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme)
            .AddCookie(o =>
            {
                // The __Host- prefix makes browsers refuse the cookie unless it is Secure, host-only and path "/".
                o.Cookie.Name = requireHttps ? "__Host-chairside.auth" : "chairside.auth";
                o.Cookie.Path = "/";
                o.Cookie.HttpOnly = true;
                o.Cookie.SameSite = SameSiteMode.Strict;
                o.Cookie.SecurePolicy = requireHttps ? CookieSecurePolicy.Always : CookieSecurePolicy.SameAsRequest;
                o.ExpireTimeSpan = TimeSpan.FromHours(10);
                o.SlidingExpiration = true;
                // An API answers with status codes, never redirects to a login page.
                o.Events.OnRedirectToLogin = ctx => { ctx.Response.StatusCode = 401; return Task.CompletedTask; };
                o.Events.OnRedirectToAccessDenied = ctx => { ctx.Response.StatusCode = 403; return Task.CompletedTask; };
                o.Events.OnValidatePrincipal = ValidateAsync;
            });
        return services;
    }

    /// <summary>
    /// Runs on every authenticated request: sets the database tenant context, and re-reads the person so a
    /// deactivation or role change takes effect immediately instead of when the cookie expires.
    /// </summary>
    private static async Task ValidateAsync(CookieValidatePrincipalContext ctx)
    {
        var p = ctx.Principal!;
        if (!Guid.TryParse(p.FindFirstValue(ClaimNames.ClinicId), out var clinicId) || !int.TryParse(p.FindFirstValue(ClaimNames.UserId), out var userId)
            || !Guid.TryParse(p.FindFirstValue(ClaimNames.SecurityStamp), out var stamp))
        {
            ctx.RejectPrincipal();
            return;
        }

        var auth = ctx.HttpContext.RequestServices.GetRequiredService<AuthService>();
        var fresh = await auth.RefreshAsync(clinicId, userId, stamp, ctx.HttpContext.RequestAborted);
        if (fresh is null)
        {
            ctx.RejectPrincipal();
            await ctx.HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
            return;
        }
        if (fresh.Role != p.FindFirstValue(ClaimTypes.Role) || fresh.HomeLocationId.ToString() != p.FindFirstValue(ClaimNames.HomeLocationId))
        {
            ctx.ReplacePrincipal(ToPrincipal(fresh));
            ctx.ShouldRenew = true;
        }
    }
}
