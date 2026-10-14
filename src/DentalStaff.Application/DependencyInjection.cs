using DentalStaff.Application.Common;
using DentalStaff.Application.Features;
using Microsoft.Extensions.DependencyInjection;

namespace DentalStaff.Application;

public static class DependencyInjection
{
    public static IServiceCollection AddApplication(this IServiceCollection services)
    {
        services.AddScoped<Access>();
        services.AddScoped<ClinicScope>();
        services.AddScoped<Notifier>();
        services.AddScoped<AuthService>();
        services.AddScoped<ClinicService>();
        services.AddScoped<StaffService>();
        services.AddScoped<ScheduleService>();
        services.AddScoped<LeaveService>();
        services.AddScoped<AttendanceService>();
        services.AddScoped<DashboardService>();
        services.AddScoped<NotificationService>();
        services.AddScoped<AuditService>();
        return services;
    }
}
