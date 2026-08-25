# deploy.ps1 — despliega el relay de sync en TU cuenta de Cloudflare.
# JFC 2026-08-25: en PowerShell 5.1 el "&&" da error de sintaxis; por eso esto
# es un script que entra a la carpeta y corre wrangler sin encadenar comandos.
#
# COMO USARLO (una sola vez, y cada vez que cambie el relay):
#   1) Abre PowerShell en esta carpeta (Shift+click derecho -> "Abrir ventana
#      de PowerShell aqui"), o corre:
#         powershell -ExecutionPolicy Bypass -File .\deploy.ps1
#   2) La PRIMERA vez te va a abrir el navegador para iniciar sesion en
#      Cloudflare (wrangler login). Aceptas y listo.
#
# Si "npx" no existe: instala Node.js LTS desde https://nodejs.org y reabre
# PowerShell.

$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

Write-Host "== friendly123-sync-relay: iniciando sesion en Cloudflare (si hace falta) ==" -ForegroundColor Cyan
# whoami falla si no hay sesion; en ese caso, login.
npx --yes wrangler@latest whoami
if ($LASTEXITCODE -ne 0) {
  npx --yes wrangler@latest login
}

Write-Host "== Desplegando el relay ==" -ForegroundColor Cyan
npx --yes wrangler@latest deploy

Write-Host ""
Write-Host "Listo. El relay quedo en:" -ForegroundColor Green
Write-Host "  https://friendly123-sync-relay.<tu-subdominio>.workers.dev/health" -ForegroundColor Green
Write-Host "Abre esa URL en el navegador: debe responder 'friendly123-sync-relay ok'."
