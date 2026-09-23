# Environment setup for the pdf skill (Windows).
#
# Checks what the build needs and installs what is missing. Idempotent: on a
# working environment it changes nothing. TeX Live / MiKTeX and LibreOffice are
# NOT installed here - they are large, deliberate installs (see setup.md).
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

$missing = New-Object System.Collections.Generic.List[string]

function Check-Group([string]$Label, [string[]]$Tools) {
    $absent = @($Tools | Where-Object { -not (Test-Tool $_) })
    if ($absent.Count -eq 0) {
        Write-Host "ok       $Label"
    }
    else {
        Write-Host "MISSING  $Label: $($absent -join ', ')"
        foreach ($tool in $absent) { [void]$missing.Add($tool) }
    }
}

Write-Host "== pdf skill environment (Windows) =="

if ((Test-Tool "latexmk") -or (Test-Tool "xelatex") -or (Test-Tool "pdflatex")) {
    Write-Host "ok       TeX distribution"
}
else {
    Write-Warning "no TeX distribution found - install MiKTeX (https://miktex.org/download) or TeX Live; see setup.md"
}

# Any one rasterizer satisfies the visual gate.
$raster = @("pdftoppm", "mutool", "magick", "gswin64c", "gs")
$rasterPresent = @($raster | Where-Object { Test-Tool $_ })
if ($rasterPresent.Count -gt 0) {
    Write-Host "ok       rasterize ($($rasterPresent -join ', '))"
}
else {
    Write-Host "MISSING  rasterize: $($raster -join ' / ')"
    [void]$missing.Add("poppler")
}

Check-Group "inspect"    @("pdfinfo", "pdffonts")
Check-Group "html path"  @("soffice")

$python = $null
if (Test-Tool "python") {
    $python = "python"
}
elseif (Test-Tool "python3") {
    $python = "python3"
}
else {
    Write-Host "MISSING  python"
    [void]$missing.Add("python")
}

if ($python) {
    Write-Host "ok       python $(& $python --version 2>&1)"
}

if ($missing.Count -eq 0) {
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
Write-Host "== installing missing pieces =="

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

# poppler provides pdftoppm / pdfinfo / pdffonts.
if (-not (Test-Tool "pdftoppm")) {
    if (Test-Tool "winget") {
        Install-WithWinget "XPDNZ1W1W2XQK2" "poppler tools"
    }
    else {
        Write-Warning "winget not found - install poppler manually (https://github.com/oschonrock/poppler-windows/releases) and add its bin\ to PATH"
    }
}

# The Python dependencies the scripts/ declare in their PEP 723 headers.
if ($python) {
    & $python -c "import pypdf, pdf2image, PIL" 2>$null
    if ($LASTEXITCODE -ne 0) {
        if ($Yes -or ((Read-Host "install python deps (pypdf, pdf2image, Pillow)? [y/N]") -match '^[yY]')) {
            try {
                & $python -m pip install pypdf pdf2image Pillow
                Write-Host "installed: python deps"
            }
            catch {
                Write-Warning "pip install failed - try: $python -m pip install --user pypdf pdf2image Pillow"
            }
        }
    }
}

Write-Host ""
Write-Host "== re-checking (open a NEW shell first so PATH changes apply) =="
& $PSCommandPath -CheckOnly
exit $LASTEXITCODE
