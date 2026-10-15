using DentalStaff.Api.Infrastructure;
using DentalStaff.Application.Common;
using DentalStaff.Application.Features;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace DentalStaff.Api.Controllers;

public sealed record DemoRequest(string Persona);

public sealed record SessionDto(MeDto Me, LookupsDto Lookups);

[ApiController]
[Route("api/auth")]
public sealed class AuthController(AuthService auth, ICurrentUser user, IConfiguration config) : ControllerBase
{
    [AllowAnonymous, EnableRateLimiting("auth"), HttpPost("signup")]
    public async Task<MeDto> Signup(SignupRequest r, CancellationToken ct) => await SignInAsync(await auth.SignupAsync(r, ct), ct);

    [AllowAnonymous, EnableRateLimiting("auth"), HttpPost("login")]
    public async Task<MeDto> Login(LoginRequest r, CancellationToken ct) => await SignInAsync(await auth.LoginAsync(r, ct), ct);

    [AllowAnonymous, EnableRateLimiting("auth"), HttpPost("invite")]
    public async Task<MeDto> AcceptInvite(AcceptInviteRequest r, CancellationToken ct) => await SignInAsync(await auth.AcceptInviteAsync(r, ct), ct);

    [AllowAnonymous, EnableRateLimiting("auth"), HttpPost("demo")]
    public async Task<ActionResult<MeDto>> Demo(DemoRequest r, CancellationToken ct)
    {
        if (!config.GetValue("Demo:Enabled", false)) return NotFound();
        return await SignInAsync(await auth.DemoLoginAsync(r.Persona, ct), ct);
    }

    [AllowAnonymous, HttpGet("config")]
    public object PublicConfig() => new { demoEnabled = config.GetValue("Demo:Enabled", false), minPasswordLength = AuthService.MinPasswordLength };

    [HttpPost("logout")]
    public async Task<IActionResult> Logout(CancellationToken ct)
    {
        // Ends this session everywhere, so a copied cookie stops working too. Demo personas are shared by many
        // visitors, so signing out one of them must not sign out the others.
        if (user.ClinicId != AuthService.DemoClinicId) await auth.SignOutEverywhereAsync(user.UserId, ct);
        await HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
        return NoContent();
    }

    [HttpGet("me")]
    public Task<MeDto> Me(CancellationToken ct) => auth.MeAsync(user.StaffId, ct);

    /// <summary>
    /// Start-up probe: the signed-in person and clinic lookups in one round trip, or null when signed out
    /// (200, not 401, so a signed-out visit does not log an error).
    /// </summary>
    [AllowAnonymous, HttpGet("session")]
    public async Task<SessionDto?> Session([FromServices] ClinicService clinic, CancellationToken ct) =>
        user.IsAuthenticated ? new SessionDto(await auth.MeAsync(user.StaffId, ct), await clinic.LookupsAsync(ct)) : null;

    private async Task<MeDto> SignInAsync(SignedInUser signedIn, CancellationToken ct)
    {
        var principal = AuthSetup.ToPrincipal(signedIn);
        await HttpContext.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme, principal);
        HttpContext.User = principal; // so MeAsync below runs as the new user
        return await auth.MeAsync(signedIn.StaffId, ct);
    }
}
