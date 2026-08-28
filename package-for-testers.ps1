# Fauna Hunt -- wrap the delivered add-on into a zip for testers.
#
# Run build.ps1 first. This takes the delivered package, drops the tester
# README beside it, and writes a versioned zip into the finished-products
# folder that OneDrive share links are created from.

$ErrorActionPreference = "Stop"

# Versioning is MAJOR.MINOR.PATCH:
#   1.0.1, 1.0.2 ...  fixes and small tweaks
#   1.1.0             a real new feature or a noticeable change to how it plays
#   2.0.0             a rewrite, or something that breaks existing saves
#
# The number lives in ONE place -- the package definition -- and is read from
# there, so the zip name can never drift from what the sim reports.
$PackageDef = "C:\Tools\fauna-hunt\PackageDefinitions\wilem35-fauna-hunt.xml"
$Version    = ([xml](Get-Content $PackageDef)).AssetPackage.Version
if (-not $Version) {
    Write-Host "Could not read the version out of $PackageDef" -ForegroundColor Red
    exit 1
}
Write-Host "Packaging version $Version" -ForegroundColor Cyan

$Delivered  = "C:\FS2020\Add-ons\Utilities\wilem35-fauna-hunt"
$Readme     = "C:\Tools\fauna-hunt\dist\README.txt"
$Staging    = "C:\Tools\fauna-hunt\dist\stage"
# Finished, shareable builds land here. Kept relative to the user profile so
# this script carries no personal paths into the public repository.
$OutputDir  = Join-Path $env:USERPROFILE "OneDrive\Desktop\App Download"
$Zip        = Join-Path $OutputDir "FaunaHunt-v$Version.zip"

if (-not (Test-Path $Delivered)) {
    Write-Host "No delivered package at $Delivered - run build.ps1 first." -ForegroundColor Red
    exit 1
}

# The service must be in the delivered copy, or testers get a game with no
# data behind it.
foreach ($needed in @("manifest.json", "Service\FaunaHuntService.exe",
                      "Service\SimConnect.dll", "Service\species.json",
                      "InGamePanels\InGamePanel_FaunaHunt.spb")) {
    if (-not (Test-Path (Join-Path $Delivered $needed))) {
        Write-Host "Delivered package is missing $needed - rebuild first." -ForegroundColor Red
        exit 1
    }
}

if (Test-Path $Staging) { Remove-Item $Staging -Recurse -Force }
New-Item -ItemType Directory -Path $Staging -Force | Out-Null

# The delivered folder holds a running-able exe. If a copy of the service is
# running from there it locks the file, and robocopy's DEFAULT behaviour is a
# million retries thirty seconds apart -- so the script appears to hang forever
# rather than failing. Check first, and cap the retries regardless.
$svc = Get-Process -Name "FaunaHuntService" -ErrorAction SilentlyContinue
if ($svc) {
    # It only reads the sim and serves the panel, so closing it costs nothing
    # but a restart -- and leaving it running silently blocks the whole build.
    Write-Host "Closing $($svc.Count) running FaunaHuntService instance(s)..." -ForegroundColor Yellow
    Stop-Process -Name "FaunaHuntService" -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    if (Get-Process -Name "FaunaHuntService" -ErrorAction SilentlyContinue) {
        Write-Host "Could not close it. Close the window by hand and re-run." -ForegroundColor Red
        exit 1
    }
    Write-Host "  closed - restart it after the build" -ForegroundColor Yellow
}

Write-Host "Staging..." -ForegroundColor Cyan
Copy-Item $Readme (Join-Path $Staging "README - Read Me First.txt") -Force
$null = robocopy $Delivered (Join-Path $Staging "wilem35-fauna-hunt") /MIR /R:2 /W:2 /NFL /NDL /NJH /NJS /NP
if ($LASTEXITCODE -ge 8) {
    Write-Host "robocopy failed with code $LASTEXITCODE" -ForegroundColor Red
    exit 1
}

# __pycache__ can be created just by running the service once, and would
# otherwise ship stale bytecode to testers.
Get-ChildItem -Path $Staging -Filter "__pycache__" -Recurse -Directory -ErrorAction SilentlyContinue |
    ForEach-Object { Remove-Item $_.FullName -Recurse -Force }

if (-not (Test-Path $OutputDir)) { New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null }
if (Test-Path $Zip) { Remove-Item $Zip -Force }

Write-Host "Compressing..." -ForegroundColor Cyan
Compress-Archive -Path (Join-Path $Staging "*") -DestinationPath $Zip -CompressionLevel Optimal

Remove-Item $Staging -Recurse -Force

$size = [math]::Round((Get-Item $Zip).Length / 1MB, 2)
Write-Host ""
Write-Host "Ready to share:" -ForegroundColor Green
Write-Host "  $Zip  ($size MB)"
Write-Host ""
Write-Host "Right-click it in OneDrive and pick Share to get a link." -ForegroundColor Yellow
