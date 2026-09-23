# Environment setup for the xlsx skill (Windows).
#
# Checks what the skill needs and installs what is missing. Idempotent: on a
# working environment it changes nothing. LibreOffice is offered explicitly,
# never installed silently and never substituted.
#
#   powershell -ExecutionPolicy Bypass -File setup_windows.ps1
#   powershell -ExecutionPolicy Bypass -File setup_windows.ps1 -CheckOnly
#   powershell -ExecutionPolicy Bypass -File setup_windows.ps1 -Yes

[CmdletBinding()]
param(
    [switch]$CheckOnly,
    [switch]$Yes
)

$ErrorActionPreference = "Stop"

function Test-Tool([string]$Name) {
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Get-Python {
    if (Test-Tool "python") { return "python" }
    if (Test-Tool "python3") { return "python3" }
    return $null
}

$python = Get-Python

Write-Host "== xlsx skill environment (Windows) =="

$needInstall = $false

if (-not $python) {
    Write-Host "MISSING  python"
    $needInstall = $true
}
else {
    Write-Host "ok       python $(& $python --version 2>&1)"
}

if ($python) {
    & $python -c "import openpyxl" 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "ok       openpyxl"
    }
    else {
        Write-Host "MISSING  openpyxl"
        $needInstall = $true
    }
}

if (Test-Tool "soffice") {
    Write-Host "ok       soffice"
}
else {
    Write-Host "MISSING  soffice (recalculation - install on demand, never substituted)"
    $needInstall = $true
}

if (-not $needInstall) {
    Write-Host ""
    Write-Host "environment ready"
    exit 0
}

if ($CheckOnly) {
    Write-Host ""
    Write-Host "-CheckOnly: nothing installed"
    exit 1
}

Write-Host ""
Write-Host "== installing =="

function Install-WithWinget([string]$PackageId, [string]$Description) {
    if (-not $Yes) {
        $reply = Read-Host "install $Description with winget? [y/N]"
        if ($reply -notmatch '^[yY]') {
            Write-Host "skipped: $Description"
            return
        }
    }
    try {
        winget install --id $PackageId --accept-source-agreements --accept-package-agreements --silent
        Write-Host "installed: $Description"
    }
    catch {
        Write-Warning "install failed: $Description - $($_.Exception.Message)"
    }
}

if (-not $python) {
    if (Test-Tool "winget") {
        Install-WithWinget "Python.Python.3.12" "Python"
        $python = Get-Python
    }
    else {
        Write-Warning "winget not found - install Python from https://python.org and add it to PATH"
    }
}

if ($python) {
    & $python -c "import openpyxl" 2>$null
    if ($LASTEXITCODE -ne 0) {
        if ($Yes -or ((Read-Host "install openpyxl? [y/N]") -match '^[yY]')) {
            try {
                & $python -m pip install openpyxl
                Write-Host "installed: openpyxl"
            }
            catch {
                Write-Warning "pip install failed - try: $python -m pip install --user openpyxl"
            }
        }
    }
}

if (-not (Test-Tool "soffice")) {
    if (Test-Tool "winget") {
        Install-WithWinget "TheDocumentFoundation.LibreOffice" "LibreOffice (recalculation)"
    }
    else {
        Write-Warning "winget not found - install LibreOffice from https://libreoffice.org and add its program\ directory to PATH"
    }
}

Write-Host ""
Write-Host "== re-checking (open a NEW shell first so PATH changes apply) =="
& $PSCommandPath -CheckOnly
exit $LASTEXITCODE
