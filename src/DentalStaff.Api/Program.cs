using System.Text.Json.Serialization;
using System.Threading.RateLimiting;
using DentalStaff.Api.Infrastructure;
using DentalStaff.Application;
using DentalStaff.Application.Common;
using DentalStaff.Database;
using DentalStaff.Infrastructure;
using DentalStaff.Infrastructure.Persistence;
using Microsoft.AspNetCore.Authorization;

var builder = WebApplication.CreateBuilder(args);

// HTTPS is required outside Development. A host without a certificate yet can turn it off for a first test only.
var requireHttps = builder.Configuration.GetValue("Hosting:RequireHttps", !builder.Environment.IsDevelopment());

builder.Services.AddApplication();
builder.Services.AddInfrastructure(builder.Configuration);
builder.Services.AddHttpContextAccessor();
builder.Services.AddScoped<ICurrentUser, CurrentUser>();
builder.Services.AddCookieAuth(requireHttps);
// Every endpoint requires a signed-in user unless it opts out with [AllowAnonymous].
builder.Services.AddAuthorizationBuilder()
    .SetFallbackPolicy(new AuthorizationPolicyBuilder().RequireAuthenticatedUser().Build());
builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = 429;
    // Sign-in, sign-up and invitation endpoints: 10 attempts per minute per IP address (configurable for test runs).
    var authPerMinute = builder.Configuration.GetValue("RateLimit:AuthPerMinute", 10);
    // Set when a proxy (the Vercel front end) forwards /api here, so limits apply per visitor, not per proxy.
    var behindProxy = builder.Configuration.GetValue("Hosting:BehindProxy", false);
    o.AddPolicy("auth", ctx => RateLimitPartition.GetFixedWindowLimiter(
        ClientAddress.For(ctx, behindProxy),
        _ => new FixedWindowRateLimiterOptions { PermitLimit = authPerMinute, Window = TimeSpan.FromMinutes(1) }));
});
builder.Services.AddControllers()
    .AddJsonOptions(o =>
    {
        o.JsonSerializerOptions.Converters.Add(new JsonStringEnumConverter());
        o.JsonSerializerOptions.DefaultIgnoreCondition = JsonIgnoreCondition.Never;
    })
    .ConfigureApiBehaviorOptions(o => o.InvalidModelStateResponseFactory = ModelBindingErrors.ToProblem);
builder.Services.AddProblemDetails();
builder.Services.AddExceptionHandler<AppExceptionHandler>();

var app = builder.Build();

// Hosts without remote database access (shared hosting) apply pending SQL scripts at start-up.
if (app.Configuration.GetValue("Database:MigrateOnStartup", false))
{
    var log = app.Services.GetRequiredService<ILoggerFactory>().CreateLogger("DatabaseMigrator");
    var result = DatabaseMigrator.Upgrade(app.Configuration.GetConnectionString(DentalStaff.Infrastructure.DependencyInjection.ConnectionStringName)!,
        createDatabaseIfMissing: false, message => log.LogInformation("{Message}", message));
    if (!result.Successful) throw new InvalidOperationException("Database migration failed.", result.Error);
}

app.UseExceptionHandler();
app.UseSecurityHeaders();
if (requireHttps)
{
    app.UseHsts();
    app.UseHttpsRedirection();
}

// The Angular build is served from wwwroot by the same site: one origin, so the SameSite=Strict cookie just works.
app.UseDefaultFiles();
app.UseStaticFiles(new StaticFileOptions
{
    OnPrepareResponse = ctx =>
    {
        // Hashed bundles never change; index.html, the manifest and the service worker must always be fresh.
        var hashed = System.Text.RegularExpressions.Regex.IsMatch(ctx.File.Name, @"-[A-Z0-9]{8}\.(js|css)$");
        ctx.Context.Response.Headers.CacheControl = hashed || ctx.File.Name.EndsWith(".woff2")
            ? "public, max-age=31536000, immutable"
            : "no-cache";
    },
});

app.UseRateLimiter();
app.UseAuthentication();
app.UseAuthorization();
app.UseCsrfHeaderCheck();

app.MapControllers();
app.MapHealthChecks("/api/health").AllowAnonymous();
// Unknown API paths are 404s; every other path is a client-side route of the Angular app.
app.Map("/api/{**rest}", () => Results.NotFound()).AllowAnonymous();
app.MapFallbackToFile("index.html").AllowAnonymous();

if (app.Configuration.GetValue("Demo:Enabled", false))
    await DemoSeeder.RunAsync(app.Services);

app.Run();
