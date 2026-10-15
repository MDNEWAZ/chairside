# Runs the published API on this PC for client testing behind the Vercel front end (via a Cloudflare tunnel).
# Uses its own database, DentalStaff_Live, so development data is never touched.
# Usage: powershell -ExecutionPolicy Bypass -File deploy/start-live-local.ps1
$ErrorActionPreference = 'Stop'
$site = Join-Path $PSScriptRoot 'out/site'
if (-not (Test-Path (Join-Path $site 'DentalStaff.Api.dll'))) { throw 'Run deploy/build-release.ps1 first.' }

$env:ASPNETCORE_ENVIRONMENT = 'Production'
$env:ASPNETCORE_URLS = 'http://127.0.0.1:5300'          # only this PC; the tunnel is the way in
$env:ConnectionStrings__DentalStaff = 'Server=localhost\MSSQLSERVER01;Database=DentalStaff_Live;Trusted_Connection=True;TrustServerCertificate=True'
$env:Database__MigrateOnStartup = 'true'
$env:Demo__Enabled = 'true'
$env:Hosting__RequireHttps = 'false'                   # TLS ends at Cloudflare and Vercel
$env:Hosting__BehindProxy = 'true'                     # rate limits per visitor, not per proxy
$env:Logging__LogLevel__Default = 'Warning'           # no SQL text in the console
${env:Logging__LogLevel__Microsoft.Hosting.Lifetime} = 'Information'

Set-Location $site
dotnet DentalStaff.Api.dll
