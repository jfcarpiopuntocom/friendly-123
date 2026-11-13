# deploy.ps1 — despliega friendly123-relay-capa1 con el perfil aislado de wrangler (no toca el login principal).
$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot
$env:XDG_CONFIG_HOME = "C:\Users\JFC\.wrangler-f123-aparte"
npx --yes wrangler@latest whoami
if ($LASTEXITCODE -ne 0) { npx --yes wrangler@latest login }
# --config is required: the repo root has its own wrangler.jsonc (site assets) that would be deployed instead.
npx --yes wrangler@latest deploy --config "$PSScriptRoot\wrangler.toml"
