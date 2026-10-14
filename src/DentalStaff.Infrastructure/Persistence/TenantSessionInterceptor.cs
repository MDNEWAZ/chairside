using System.Data.Common;
using DentalStaff.Application.Common;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace DentalStaff.Infrastructure.Persistence;

/// <summary>
/// Copies the tenant and user into SESSION_CONTEXT each time EF opens a connection. Row-level
/// security (script 0003) filters every tenant table by ClinicId, and audit triggers (0004) read UserId.
/// Keys are read-only for the life of the session, so later SQL on the same connection cannot switch tenant.
/// Pooled connections are reset when reused, which clears the keys.
/// </summary>
public sealed class TenantSessionInterceptor(ITenantContext tenant) : DbConnectionInterceptor
{
    public override void ConnectionOpened(DbConnection connection, ConnectionEndEventData eventData)
    {
        using var command = Build(connection);
        command?.ExecuteNonQuery();
    }

    public override async Task ConnectionOpenedAsync(DbConnection connection, ConnectionEndEventData eventData, CancellationToken cancellationToken = default)
    {
        await using var command = Build(connection);
        if (command is not null) await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private DbCommand? Build(DbConnection connection)
    {
        if (tenant.ClinicId is not { } clinicId) return null;

        var command = connection.CreateCommand();
        command.CommandText = tenant.UserId is null
            ? "EXEC sp_set_session_context @key = N'ClinicId', @value = @clinicId, @read_only = 1;"
            : "EXEC sp_set_session_context @key = N'ClinicId', @value = @clinicId, @read_only = 1;" +
              "EXEC sp_set_session_context @key = N'UserId', @value = @userId, @read_only = 1;";
        command.Parameters.Add(new SqlParameter("@clinicId", clinicId));
        if (tenant.UserId is { } userId) command.Parameters.Add(new SqlParameter("@userId", userId));
        return command;
    }
}

public sealed class TenantContext : ITenantContext
{
    public Guid? ClinicId { get; private set; }
    public int? UserId { get; private set; }

    public void Set(Guid clinicId, int? userId)
    {
        ClinicId = clinicId;
        UserId = userId;
    }
}
