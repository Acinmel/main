# 将 backend/.env 中的密钥合并到仓库根 .env（Docker / 线上用）
# 用法：在仓库根目录  powershell -ExecutionPolicy Bypass -File deploy/sync-root-env-from-backend.ps1
# 已存在根 .env 时：只覆盖/追加列出的键，不删除你手写的其它行

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
if (-not (Test-Path (Join-Path $repoRoot 'docker-compose.yml'))) {
  Write-Error '请在仓库根目录执行（deploy 的上一级需含 docker-compose.yml）'
}
Set-Location $repoRoot

$backendEnv = Join-Path $repoRoot 'backend\.env'
if (-not (Test-Path $backendEnv)) {
  Write-Error "未找到 $backendEnv"
}

function Parse-DotEnv($path) {
  $map = @{}
  Get-Content -LiteralPath $path -Encoding UTF8 | ForEach-Object {
    $line = $_.Trim()
    if ($line -eq '' -or $line.StartsWith('#')) { return }
    $i = $line.IndexOf('=')
    if ($i -lt 1) { return }
    $k = $line.Substring(0, $i).Trim()
    $v = $line.Substring($i + 1)
    $map[$k] = $v
  }
  return $map
}

$be = Parse-DotEnv (Resolve-Path $backendEnv)
$keysToSync = @(
  'ARK_API_KEY', 'ARK_BASE_URL', 'ARK_IMAGE_MODEL',
  'SEEDREAM_HTTP_URL', 'SEEDREAM_API_KEY',
  'DIGITAL_HUMAN_API_URL', 'DIGITAL_HUMAN_API_KEY',
  'DY_DOWNLOADER_COOKIE', 'OPENAI_API_KEY'
)

$rootEnvPath = Join-Path $repoRoot '.env'
$lines = @()
if (Test-Path $rootEnvPath) {
  $lines = @(Get-Content -LiteralPath $rootEnvPath -Encoding UTF8)
}

$present = @{}
foreach ($line in $lines) {
  if ($line -match '^\s*([^#=]+)=') { $present[$Matches[1].Trim()] = $true }
}

$appends = @()
foreach ($k in $keysToSync) {
  if (-not $be.ContainsKey($k) -or [string]::IsNullOrWhiteSpace($be[$k])) { continue }
  $newLine = "$k=$($be[$k])"
  if ($present[$k]) {
    $lines = $lines | ForEach-Object {
      if ($_ -match "^\s*$([regex]::Escape($k))=") { $newLine } else { $_ }
    }
  } else {
    $appends += $newLine
    $present[$k] = $true
  }
}

if ($appends.Count -gt 0) {
  $lines += ''
  $lines += '# --- sync-root-env-from-backend ---'
  $lines += $appends
}

Set-Content -LiteralPath $rootEnvPath -Value $lines -Encoding UTF8
Write-Host "已写入: $rootEnvPath"
