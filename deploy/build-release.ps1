param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^\d{8}-\d{3}$')]
  [string]$AppVersion,

  [switch]$AllowDirty,
  [switch]$RunBackendTests,
  [switch]$CleanInstall,
  [string]$ViteApiBaseUrl = "/api"
)

$ErrorActionPreference = "Stop"

function Require-Command {
  param([string]$Name)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Missing required command: $Name"
  }
}

function Require-File {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "Missing required file: $Path"
  }
}

function Copy-DirectoryContents {
  param(
    [string]$Source,
    [string]$Destination
  )
  New-Item -ItemType Directory -Force -Path $Destination | Out-Null
  Copy-Item -Path (Join-Path $Source "*") -Destination $Destination -Recurse -Force
}

function Write-Utf8NoBom {
  param(
    [string]$Path,
    [string[]]$Lines
  )
  $encoding = New-Object System.Text.UTF8Encoding($false)
  $FullPath = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Path)
  [System.IO.File]::WriteAllText($FullPath, (($Lines -join "`n") + "`n"), $encoding)
}

function Convert-TextFilesToLf {
  param([string[]]$Paths)
  $encoding = New-Object System.Text.UTF8Encoding($false)
  foreach ($Path in $Paths) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
      continue
    }
    $FullPath = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Path)
    $Text = [System.IO.File]::ReadAllText($FullPath)
    $Text = $Text -replace "`r`n", "`n" -replace "`r", "`n"
    [System.IO.File]::WriteAllText($FullPath, $Text, $encoding)
  }
}

function Invoke-Step {
  param(
    [string]$Command,
    [string[]]$Arguments
  )
  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed: $Command $($Arguments -join ' ')"
  }
}

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $Root

Require-Command npm
Require-Command git
Require-Command node

Require-File "compose.runtime.yml"
Require-File "frontend/Dockerfile"
Require-File "backend/Dockerfile"
Require-File "deploy/deploy-runtime.sh"
Require-File "deploy/rollback.sh"
Require-File "deploy/setup-https-nginx.sh"
Require-File "deploy/nginx-host-reverse-proxy.conf"
Require-File "deploy/artifact-frontend.Dockerfile"
Require-File "deploy/artifact-backend.Dockerfile"
Require-File "scripts/preflight-check.sh"
Require-File "scripts/run-migrations.sh"
Require-File "scripts/smoke-test.sh"
Require-File "scripts/verify-runtime.sh"
Require-File "scripts/verify-release-routes.js"
Require-File "database/migrations/20260517_001_widen_runtime_text_columns.sql"

$GitCommit = "unknown"
try {
  git rev-parse --is-inside-work-tree *> $null
  $GitCommit = (git rev-parse HEAD).Trim()
  $Dirty = git status --short
  if ($Dirty -and -not $AllowDirty) {
    Write-Error "Working tree is not clean. Commit/stash changes or pass -AllowDirty for an explicit test package."
  }
}
catch {
  $GitCommit = "unknown"
}

Write-Host ">>> Running build verification"
if ($CleanInstall) {
  Invoke-Step npm @("--prefix", "frontend", "ci")
  Invoke-Step npm @("--prefix", "backend/DY-DOWNLOADER", "ci")
  Invoke-Step npm @("--prefix", "backend", "ci")
}
Invoke-Step npm @("--prefix", "frontend", "run", "build")
Invoke-Step npm @("--prefix", "backend/DY-DOWNLOADER", "run", "build")
Invoke-Step npm @("--prefix", "backend", "run", "build")
Invoke-Step node @("scripts/verify-release-routes.js", "--backend-dist-dir", "backend/dist", "--context", "backend-dist")

if ($RunBackendTests) {
  Invoke-Step npm @("--prefix", "backend", "run", "test")
}

$OutDir = Join-Path $Root "dist-release"
$PkgName = "shuziren-release-$AppVersion"
$PkgDir = Join-Path $OutDir $PkgName
$ZipPath = Join-Path $OutDir "$PkgName.zip"
$ShaPath = Join-Path $OutDir "$PkgName.zip.sha256"

if (Test-Path -LiteralPath $PkgDir) {
  Remove-Item -LiteralPath $PkgDir -Recurse -Force
}
Remove-Item -LiteralPath $ZipPath, $ShaPath -Force -ErrorAction SilentlyContinue

New-Item -ItemType Directory -Force -Path (Join-Path $PkgDir "frontend/dist") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $PkgDir "backend/dist") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $PkgDir "backend/scripts") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $PkgDir "backend/DY-DOWNLOADER/dist") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $PkgDir "scripts") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $PkgDir "deploy") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $PkgDir "database/migrations") | Out-Null

Write-Host ">>> Packaging build artifacts"
Copy-DirectoryContents "frontend/dist" (Join-Path $PkgDir "frontend/dist")
Copy-Item -LiteralPath "frontend/deploy/nginx-web.conf" -Destination (Join-Path $PkgDir "frontend/nginx-web.conf") -Force
Copy-Item -LiteralPath "deploy/artifact-frontend.Dockerfile" -Destination (Join-Path $PkgDir "frontend/Dockerfile") -Force

Copy-DirectoryContents "backend/dist" (Join-Path $PkgDir "backend/dist")
Copy-DirectoryContents "backend/scripts" (Join-Path $PkgDir "backend/scripts")
Copy-Item -LiteralPath "backend/package.json", "backend/package-lock.json" -Destination (Join-Path $PkgDir "backend") -Force
Copy-Item -LiteralPath "backend/DY-DOWNLOADER/package.json", "backend/DY-DOWNLOADER/package-lock.json" -Destination (Join-Path $PkgDir "backend/DY-DOWNLOADER") -Force
Copy-DirectoryContents "backend/DY-DOWNLOADER/dist" (Join-Path $PkgDir "backend/DY-DOWNLOADER/dist")
if (Test-Path -LiteralPath "backend/DY-DOWNLOADER/README.md") {
  Copy-Item -LiteralPath "backend/DY-DOWNLOADER/README.md" -Destination (Join-Path $PkgDir "backend/DY-DOWNLOADER") -Force
}
if (Test-Path -LiteralPath "backend/DY-DOWNLOADER/LICENSE") {
  Copy-Item -LiteralPath "backend/DY-DOWNLOADER/LICENSE" -Destination (Join-Path $PkgDir "backend/DY-DOWNLOADER") -Force
}
Copy-Item -LiteralPath "deploy/artifact-backend.Dockerfile" -Destination (Join-Path $PkgDir "backend/Dockerfile") -Force

Copy-Item -LiteralPath "compose.runtime.yml" -Destination (Join-Path $PkgDir "compose.runtime.yml") -Force
Copy-Item -LiteralPath "deploy/deploy-runtime.sh" -Destination (Join-Path $PkgDir "deploy-runtime.sh") -Force
Copy-Item -LiteralPath "deploy/rollback.sh" -Destination (Join-Path $PkgDir "rollback.sh") -Force
Copy-Item -LiteralPath "deploy/setup-https-nginx.sh", "deploy/nginx-host-reverse-proxy.conf" -Destination (Join-Path $PkgDir "deploy") -Force
Copy-Item -LiteralPath "scripts/preflight-check.sh", "scripts/run-migrations.sh", "scripts/smoke-test.sh", "scripts/verify-runtime.sh" -Destination (Join-Path $PkgDir "scripts") -Force
Copy-DirectoryContents "database/migrations" (Join-Path $PkgDir "database/migrations")
Invoke-Step node @("scripts/verify-release-routes.js", "--backend-dist-dir", (Join-Path $PkgDir "backend/dist"), "--context", "package-dist")

$BuildTimeUtc = [DateTime]::UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ")
Write-Utf8NoBom (Join-Path $PkgDir "VERSION") @(
  "APP_VERSION=$AppVersion",
  "GIT_COMMIT=$GitCommit",
  "BUILD_TIME_UTC=$BuildTimeUtc",
  "VITE_API_BASE_URL=$ViteApiBaseUrl"
)

$IncludedFiles = Get-ChildItem -LiteralPath $PkgDir -Recurse -File |
  Where-Object { $_.Name -ne "BUILD_INFO.json" -and $_.Name -ne "SHA256SUMS" } |
  Sort-Object FullName |
  ForEach-Object { $_.FullName.Substring($PkgDir.Length).TrimStart('\', '/') -replace '\\', '/' }
$BuildInfo = [ordered]@{
  buildTime = $BuildTimeUtc
  gitCommit = $GitCommit
  version = $AppVersion
  includedFiles = $IncludedFiles
}
$BuildInfoJson = $BuildInfo | ConvertTo-Json -Depth 5
Write-Utf8NoBom (Join-Path $PkgDir "backend/BUILD_INFO.json") ($BuildInfoJson -split "`r?`n")

Convert-TextFilesToLf @(
  (Join-Path $PkgDir "deploy-runtime.sh"),
  (Join-Path $PkgDir "rollback.sh"),
  (Join-Path $PkgDir "deploy/setup-https-nginx.sh"),
  (Join-Path $PkgDir "deploy/nginx-host-reverse-proxy.conf"),
  (Join-Path $PkgDir "compose.runtime.yml"),
  (Join-Path $PkgDir "VERSION"),
  (Join-Path $PkgDir "frontend/Dockerfile"),
  (Join-Path $PkgDir "backend/Dockerfile"),
  (Join-Path $PkgDir "backend/BUILD_INFO.json"),
  (Join-Path $PkgDir "scripts/preflight-check.sh"),
  (Join-Path $PkgDir "scripts/run-migrations.sh"),
  (Join-Path $PkgDir "scripts/smoke-test.sh"),
  (Join-Path $PkgDir "scripts/verify-runtime.sh"),
  (Join-Path $PkgDir "database/migrations/20260517_001_widen_runtime_text_columns.sql")
)

$ChecksumLines = Get-ChildItem -LiteralPath $PkgDir -Recurse -File |
  Where-Object { $_.Name -ne "SHA256SUMS" } |
  Sort-Object FullName |
  ForEach-Object {
    $Relative = $_.FullName.Substring($PkgDir.Length).TrimStart('\', '/') -replace '\\', '/'
    $Hash = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    "$Hash  ./$Relative"
  }
Write-Utf8NoBom (Join-Path $PkgDir "SHA256SUMS") $ChecksumLines

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$Archive = [System.IO.Compression.ZipFile]::Open($ZipPath, [System.IO.Compression.ZipArchiveMode]::Create)
try {
  Get-ChildItem -LiteralPath $PkgDir -Recurse -File | ForEach-Object {
    $Relative = $_.FullName.Substring($OutDir.Length).TrimStart('\', '/') -replace '\\', '/'
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($Archive, $_.FullName, $Relative, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
  }
}
finally {
  $Archive.Dispose()
}

$ZipHash = (Get-FileHash -LiteralPath $ZipPath -Algorithm SHA256).Hash.ToLowerInvariant()
Write-Utf8NoBom $ShaPath @("$ZipHash  $PkgName.zip")

Write-Host ">>> Release package created:"
Write-Host "    $ZipPath"
Write-Host "    $ShaPath"
Write-Host ">>> Upload only the .zip file to the server."
