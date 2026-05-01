# Restart all services in root docker-compose.yml
# Usage from repo root: powershell -ExecutionPolicy Bypass -File deploy/restart-all-local.ps1

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $repoRoot

function Find-DockerExe {
  $cmd = Get-Command docker -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $paths = @(
    "${env:ProgramFiles}\Docker\Docker\resources\bin\docker.exe",
    "${env:ProgramFiles(x86)}\Docker\Docker\resources\bin\docker.exe",
    "${env:LocalAppData}\Docker\resources\bin\docker.exe"
  )
  foreach ($p in $paths) {
    if (Test-Path -LiteralPath $p) { return $p }
  }
  return $null
}

$docker = Find-DockerExe
if (-not $docker) {
  Write-Host "[ERROR] docker not found. Install Docker Desktop and ensure it is in PATH."
  exit 1
}

Write-Host "[INFO] Using: $docker"
& $docker compose restart
if ($LASTEXITCODE -ne 0) {
  Write-Host "[WARN] restart failed, trying compose up -d ..."
  & $docker compose up -d
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

Write-Host "[OK] Restart complete."
& $docker compose ps
