# Fauna Hunt -- build the data service into a standalone executable.
#
# Run this only when the service source changes. build.ps1 just packages
# whatever is already sitting in PackageSources\...\Service.
#
# WHY --onedir AND NOT --onefile
#
# A one-file build wraps everything in a self-extracting stub that unpacks to
# a temp folder and runs from there. That behaviour is indistinguishable from
# how a lot of real malware works, so heuristic engines flag it: the one-file
# build scored 6/70 on VirusTotal, Microsoft Defender among them, every one of
# them an ML verdict rather than a signature match. Defender flagging it means
# testers' machines quarantine it, and flightsim.to rejects anything above 0/0.
#
# A folder build has no stub. The exe is an ordinary program sitting beside its
# libraries, which is what it actually is.
#
# --noupx matters for the same reason: UPX compression is another strong
# malware signal, and PyInstaller will use it silently if it finds it.

$ErrorActionPreference = "Stop"

$ProjectDir = "C:\Tools\fauna-hunt"
$ServiceDir = "$ProjectDir\PackageSources\Copys\fauna-hunt\Service"
$BuildDir   = "$ProjectDir\service-build"
$VersionRes = "$BuildDir\version_info.txt"

Push-Location $ServiceDir
try {
    Write-Host "Building the service executable (folder build)..." -ForegroundColor Cyan

    foreach ($stale in @("$BuildDir\work", "$BuildDir\out", "$ServiceDir\__pycache__")) {
        if (Test-Path $stale) { Remove-Item $stale -Recurse -Force }
    }

    python -m PyInstaller `
        --onedir `
        --console `
        --noupx `
        --name FaunaHuntService `
        --version-file $VersionRes `
        --distpath "$BuildDir\out" `
        --workpath "$BuildDir\work" `
        --specpath $BuildDir `
        --clean --noconfirm `
        fauna_service.py

    if ($LASTEXITCODE -ne 0) {
        Write-Host "PyInstaller failed." -ForegroundColor Red
        exit 1
    }
} finally {
    Pop-Location
}

$built = "$BuildDir\out\FaunaHuntService"
if (-not (Test-Path "$built\FaunaHuntService.exe")) {
    Write-Host "No executable was produced." -ForegroundColor Red
    exit 1
}

# The frozen app resolves species.json and SimConnect.dll next to its own exe,
# so the folder build has to land as the Service folder itself rather than in
# a subfolder -- otherwise it starts and immediately cannot find its data.
Write-Host "Installing into the package's Service folder..." -ForegroundColor Cyan
foreach ($old in @("$ServiceDir\FaunaHuntService.exe", "$ServiceDir\_internal")) {
    if (Test-Path $old) { Remove-Item $old -Recurse -Force }
}
Copy-Item "$built\*" $ServiceDir -Recurse -Force

foreach ($needed in @("FaunaHuntService.exe", "species.json", "SimConnect.dll")) {
    $path = Join-Path $ServiceDir $needed
    if (Test-Path $path) {
        Write-Host "  $needed" -ForegroundColor Green
    } else {
        Write-Host "  MISSING: $needed" -ForegroundColor Red
    }
}

Remove-Item "$BuildDir\work", "$BuildDir\out" -Recurse -Force -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "Done. Now scan it before shipping:" -ForegroundColor Yellow
Write-Host "  $ServiceDir\FaunaHuntService.exe"
Write-Host "flightsim.to needs 0/0 on VirusTotal - any detection is a rejection."
