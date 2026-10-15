# Builds one deployable site: the ASP.NET Core API with the Angular app in wwwroot, zipped for upload.
# Usage (from the repository root):  powershell -ExecutionPolicy Bypass -File deploy/build-release.ps1
# Put your real settings in deploy/appsettings.Production.json first (copy the template; that file is git-ignored).
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$out = Join-Path $PSScriptRoot 'out'
$site = Join-Path $out 'site'

Remove-Item $out -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $site | Out-Null

Write-Host '1/4 Building the Angular app' -ForegroundColor Cyan
Push-Location (Join-Path $root 'web')
npx ng build --configuration production
if ($LASTEXITCODE -ne 0) { throw 'Angular build failed' }
Pop-Location

Write-Host '2/4 Publishing the API' -ForegroundColor Cyan
dotnet publish (Join-Path $root 'src/DentalStaff.Api') -c Release -o $site --nologo
if ($LASTEXITCODE -ne 0) { throw 'dotnet publish failed' }

Write-Host '3/4 Copying the web app into wwwroot' -ForegroundColor Cyan
$wwwroot = Join-Path $site 'wwwroot'
New-Item -ItemType Directory -Force $wwwroot | Out-Null
Copy-Item (Join-Path $root 'web/dist/dentalstaff-web/browser/*') $wwwroot -Recurse -Force
Remove-Item (Join-Path $site 'appsettings.Development.json') -ErrorAction SilentlyContinue

$prod = Join-Path $PSScriptRoot 'appsettings.Production.json'
if (Test-Path $prod) {
  Copy-Item $prod (Join-Path $site 'appsettings.Production.json') -Force
} else {
  Write-Warning 'deploy/appsettings.Production.json not found: the site will need its connection string set on the host.'
}

Write-Host '4/4 Zipping' -ForegroundColor Cyan
$zip = Join-Path $out 'chairside-site.zip'
Compress-Archive -Path (Join-Path $site '*') -DestinationPath $zip -Force
Write-Host "Done: $zip" -ForegroundColor Green
