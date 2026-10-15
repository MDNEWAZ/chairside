# Builds the Angular app as a static Vercel site that forwards /api to the ASP.NET Core API host.
# Usage (from the repository root):
#   powershell -ExecutionPolicy Bypass -File deploy/build-vercel.ps1 -ApiOrigin https://your-api.runasp.net
# Then deploy the folder:  npx vercel deploy deploy/out/vercel --prod
# The browser only ever talks to the Vercel domain, so the SameSite=Strict sign-in cookie keeps working.
param([Parameter(Mandatory = $true)][string]$ApiOrigin)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$out = Join-Path $PSScriptRoot 'out/vercel'
$ApiOrigin = $ApiOrigin.TrimEnd('/')
if ($ApiOrigin -notmatch '^https?://[^/]+$') { throw 'ApiOrigin must look like https://host (no path).' }

Write-Host '1/2 Building the Angular app' -ForegroundColor Cyan
Push-Location (Join-Path $root 'web')
npx ng build --configuration production
if ($LASTEXITCODE -ne 0) { throw 'Angular build failed' }
Pop-Location

Write-Host '2/2 Preparing the Vercel folder' -ForegroundColor Cyan
# Keep the .vercel link folder (project binding) between builds; replace everything else.
if (Test-Path $out) { Get-ChildItem $out -Force | Where-Object Name -ne '.vercel' | Remove-Item -Recurse -Force }
New-Item -ItemType Directory -Force $out | Out-Null
Copy-Item (Join-Path $root 'web/dist/dentalstaff-web/browser/*') $out -Recurse -Force
(Get-Content (Join-Path $PSScriptRoot 'vercel.template.json') -Raw).Replace('__API_ORIGIN__', $ApiOrigin) |
  ForEach-Object { [IO.File]::WriteAllText((Join-Path $out 'vercel.json'), $_, (New-Object Text.UTF8Encoding $false)) }
Write-Host "Done: $out  (API: $ApiOrigin)" -ForegroundColor Green
