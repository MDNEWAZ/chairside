using DbUp;
using DbUp.Engine;

namespace DentalStaff.Database;

/// <summary>
/// Applies every not-yet-run script in Scripts/ in name order, inside one transaction.
/// Used by the console migrator locally and by the API at start-up on hosts without remote database access.
/// </summary>
public static class DatabaseMigrator
{
    public static DatabaseUpgradeResult Upgrade(string connectionString, bool createDatabaseIfMissing, Action<string>? log = null)
    {
        if (createDatabaseIfMissing) EnsureDatabase.For.SqlDatabase(connectionString);

        var builder = DeployChanges.To
            .SqlDatabase(connectionString)
            .WithScriptsEmbeddedInAssembly(typeof(DatabaseMigrator).Assembly)
            .WithTransaction();
        builder = log is null ? builder.LogToNowhere() : builder.LogTo(new CallbackLog(log));
        return builder.Build().PerformUpgrade();
    }

    private sealed class CallbackLog(Action<string> write) : DbUp.Engine.Output.IUpgradeLog
    {
        public void LogTrace(string format, params object[] args) { }
        public void LogDebug(string format, params object[] args) { }
        public void LogInformation(string format, params object[] args) => write(string.Format(format, args));
        public void LogWarning(string format, params object[] args) => write("WARN " + string.Format(format, args));
        public void LogError(string format, params object[] args) => write("ERROR " + string.Format(format, args));
        public void LogError(Exception ex, string format, params object[] args) => write("ERROR " + string.Format(format, args) + " " + ex.Message);
    }
}
