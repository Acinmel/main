# Rebuild better-sqlite3 for current Node. Stop "npm run dev:backend" first (Ctrl+C).
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $root

Write-Host '[rebuild-sqlite] If dev:backend is running, press Ctrl+C there first (else DLL may stay locked).' -ForegroundColor Yellow

$buildDir = Join-Path -Path $root -ChildPath 'node_modules\better-sqlite3\build'
if (Test-Path -LiteralPath $buildDir) {
    Remove-Item -LiteralPath $buildDir -Recurse -Force -ErrorAction SilentlyContinue
}
if (Test-Path -LiteralPath $buildDir) {
    Write-Host '[rebuild-sqlite] ERROR: could not delete build folder (in use). Close Cursor/IDE Node processes or taskkill node.exe, then retry.' -ForegroundColor Red
    exit 1
}

& npm rebuild better-sqlite3
exit $LASTEXITCODE
