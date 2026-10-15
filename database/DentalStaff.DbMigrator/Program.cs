using DentalStaff.Database;
using Microsoft.Extensions.Configuration;

// Creates the database if needed and applies every pending script.
// Connection string: appsettings.json, or env var ConnectionStrings__DentalStaff, or the first argument.
var configuration = new ConfigurationBuilder()
    .SetBasePath(AppContext.BaseDirectory)
    .AddJsonFile("appsettings.json", optional: true)
    .AddEnvironmentVariables()
    .Build();

var connectionString = args.FirstOrDefault() ?? configuration.GetConnectionString("DentalStaff");
if (string.IsNullOrWhiteSpace(connectionString))
{
    Console.Error.WriteLine("No connection string. Set ConnectionStrings__DentalStaff or pass it as the first argument.");
    return 1;
}

var result = DatabaseMigrator.Upgrade(connectionString, createDatabaseIfMissing: true, Console.WriteLine);
if (!result.Successful)
{
    Console.ForegroundColor = ConsoleColor.Red;
    Console.Error.WriteLine(result.Error);
    Console.ResetColor();
    return 2;
}

Console.ForegroundColor = ConsoleColor.Green;
Console.WriteLine("Database is up to date.");
Console.ResetColor();
return 0;
