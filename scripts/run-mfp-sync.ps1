# Wrapper fuer den Windows Task Scheduler: laedt .env, ruft mfp-sync/sync.py auf, loggt nach scripts/logs/.
# Hinweis: mfp-sync/cookies.txt laeuft alle paar Wochen ab -> dann schlaegt dieser Task fehl,
# bis die Datei manuell neu exportiert wird (siehe CLAUDE.md).
$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $root ".env"
$logDir = Join-Path $root "scripts\logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logFile = Join-Path $logDir "mfp-sync.log"

Get-Content $envFile | ForEach-Object {
    if ($_ -match '^\s*#') { return }
    if ($_ -match '^\s*$') { return }
    if ($_ -match '^([^=]+)="?(.*?)"?$') {
        [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2], "Process")
    }
}

Set-Location (Join-Path $root "mfp-sync")
$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
Add-Content -Path $logFile -Value "`n=== $timestamp ===" -Encoding utf8
$env:PYTHONIOENCODING = "utf-8"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
try {
    $output = python sync.py --days 3 2>&1 | Out-String
} catch {
    $output = "Wrapper-Fehler: $_"
}
Add-Content -Path $logFile -Value $output -Encoding utf8
