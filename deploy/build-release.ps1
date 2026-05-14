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
  [System.IO.File]::WriteAllLines($FullPath, $Lines, $encoding)
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

Require-File "compose.runtime.yml"
Require-File "frontend/Dockerfile"
Require-File "backend/Dockerfile"
Require-File "deploy/deploy-runtime.sh"
Require-File "deploy/rollback.sh"
Require-File "deploy/artifact-frontend.Dockerfile"
Require-File "deploy/artifact-backend.Dockerfile"

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
New-Item -ItemType Directory -Force -Path (Join-Path $PkgDir "backend/DY-DOWNLOADER/dist") | Out-Null

Write-Host ">>> Packaging build artifacts"
Copy-DirectoryContents "frontend/dist" (Join-Path $PkgDir "frontend/dist")
Copy-Item -LiteralPath "frontend/deploy/nginx-web.conf" -Destination (Join-Path $PkgDir "frontend/nginx-web.conf") -Force
Copy-Item -LiteralPath "deploy/artifact-frontend.Dockerfile" -Destination (Join-Path $PkgDir "frontend/Dockerfile") -Force

Copy-DirectoryContents "backend/dist" (Join-Path $PkgDir "backend/dist")
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

$BuildTimeUtc = [DateTime]::UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ")
Write-Utf8NoBom (Join-Path $PkgDir "VERSION") @(
  "APP_VERSION=$AppVersion",
  "GIT_COMMIT=$GitCommit",
  "BUILD_TIME_UTC=$BuildTimeUtc",
  "VITE_API_BASE_URL=$ViteApiBaseUrl"
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
