# Public HTTPS address for the local live API (no Cloudflare account needed). The address changes on each start:
# rebuild and redeploy Vercel with the new address (deploy/build-vercel.ps1 -ApiOrigin https://<name>.trycloudflare.com).
& 'C:\Program Files (x86)\cloudflared\cloudflared.exe' tunnel --no-autoupdate --url http://127.0.0.1:5300 2>&1 |
  Tee-Object -FilePath (Join-Path $PSScriptRoot 'out/tunnel.log')
