using DentalStaff.Application.Common;
using DentalStaff.Infrastructure.Persistence;
using DentalStaff.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace DentalStaff.Infrastructure;

public static class DependencyInjection
{
    public const string ConnectionStringName = "DentalStaff";

    public static IServiceCollection AddInfrastructure(this IServiceCollection services, IConfiguration configuration)
    {
        var connectionString = configuration.GetConnectionString(ConnectionStringName)
            ?? throw new InvalidOperationException($"Connection string '{ConnectionStringName}' is not configured.");

        services.AddScoped<TenantContext>();
        services.AddScoped<ITenantContext>(sp => sp.GetRequiredService<TenantContext>());
        services.AddScoped<TenantSessionInterceptor>();
        services.AddDbContext<AppDbContext>((sp, options) => options
            .UseSqlServer(connectionString, sql => sql.EnableRetryOnFailure())
            .AddInterceptors(sp.GetRequiredService<TenantSessionInterceptor>()));
        services.AddScoped<IAppDbContext>(sp => sp.GetRequiredService<AppDbContext>());

        services.AddSingleton<IPasswordService, PasswordService>();
        services.AddSingleton<IEmailSender, SimulatedEmailSender>();
        services.AddSingleton<IAnalytics, LoggingAnalytics>();
        services.AddSingleton<IClock, SystemClock>();

        services.AddHealthChecks().AddDbContextCheck<AppDbContext>("database");
        return services;
    }
}
