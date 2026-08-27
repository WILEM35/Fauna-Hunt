# Fauna Hunt -- build the MSFS package and deliver it to the Add-on Linker folder.
#
# Layout:
#   C:\Tools\fauna-hunt                      working folder, all source lives here
#     PackageSources\Copys\...\Panel         the panel (canonical -- edit in place)
#     PackageSources\Copys\...\Service       the Python service, shipped in the package
#     probe\                                 dev-only recon tools, never shipped
#     dev\                                   dev-only test harness, never shipped
#   C:\FS2020\Add-ons\Utilities\wilem35-fauna-hunt
#                                            finished add-on, linked into Community
#                                            by Add-on Linker. Nothing is edited here.
#
# Three SDK quirks, all handled below:
#   * fspackagetool builds by launching its own copy of the game. If the sim is
#     already open it just attaches to that instance and silently builds nothing.
#   * its incremental caching skips real changes, so the output folders are
#     deleted before every rebuild.
#   * it STAYS ALIVE after the build is done. The game instance it launches
#     comes up with an error and sits there until you close that window by
#     hand. The package is finished well before that, so never wait on the
#     process to exit -- check the files on disk, which is what this does.

$ErrorActionPreference = "Stop"

$ProjectDir  = "C:\Tools\fauna-hunt"
$ProjectXml  = "$ProjectDir\fauna-hunt.xml"
$BuiltPkg    = "$ProjectDir\Packages\wilem35-fauna-hunt"
$DeliverTo   = "C:\FS2020\Add-ons\Utilities\wilem35-fauna-hunt"
$PackageTool = "C:\MSFS 2024 SDK\Tools\bin\fspackagetool.exe"

$running = Get-Process -Name @("FlightSimulator2024", "FlightSimulator") -ErrorAction SilentlyContinue
if ($running) {
    Write-Host "Microsoft Flight Simulator is running ($($running[0].ProcessName))." -ForegroundColor Red
    Write-Host "Close the sim completely, then run this again." -ForegroundColor Red
    Write-Host "The build launches its own game instance and cannot share one." -ForegroundColor Yellow
    exit 1
}

if (-not (Test-Path $PackageTool)) {
    Write-Host "fspackagetool not found at $PackageTool" -ForegroundColor Red
    exit 1
}

# __pycache__ would otherwise be copied into the shipped package.
Get-ChildItem -Path "$ProjectDir\PackageSources" -Filter "__pycache__" -Recurse -Directory -ErrorAction SilentlyContinue |
    ForEach-Object { Remove-Item $_.FullName -Recurse -Force }

Write-Host "Clearing build caches..." -ForegroundColor Cyan
foreach ($dir in @("Packages", "PackagesMetadata", "_PackageInt")) {
    $path = Join-Path $ProjectDir $dir
    if (Test-Path $path) { Remove-Item $path -Recurse -Force }
}

Write-Host "Building package (the SDK launches the sim internally)..." -ForegroundColor Cyan
Push-Location $ProjectDir
try {
    & $PackageTool $ProjectXml -rebuild -nopause
    $buildExit = $LASTEXITCODE
} finally {
    Pop-Location
}

# Deliberately NOT treated as failure. The tool returns whatever code the game
# exits with -- routinely non-zero on a perfectly clean build. The artefacts on
# disk are the only trustworthy signal.
if ($buildExit -ne 0) {
    Write-Host "(tool exited $buildExit - that is the sim's own exit code, not the build)" -ForegroundColor DarkGray
}

if (-not (Test-Path $BuiltPkg)) {
    Write-Host "No package was produced at $BuiltPkg" -ForegroundColor Red
    exit 1
}

$problems = 0

$spb = Join-Path $BuiltPkg "InGamePanels\InGamePanel_FaunaHunt.spb"
if (Test-Path $spb) {
    Write-Host "SPB compiled OK ($((Get-Item $spb).Length) bytes)" -ForegroundColor Green
} else {
    Write-Host "WARNING: no .spb produced - the toolbar button will not appear." -ForegroundColor Yellow
    $problems++
}

# The exe, the DLL and the species table are what a tester actually needs --
# none of them have Python or the MSFS SDK installed.
foreach ($needed in @("Service\FaunaHuntService.exe", "Service\SimConnect.dll",
                      "Service\species.json")) {
    if (Test-Path (Join-Path $BuiltPkg $needed)) {
        Write-Host "Included: $needed" -ForegroundColor Green
    } else {
        Write-Host "WARNING: missing from package: $needed" -ForegroundColor Yellow
        $problems++
    }
}

Write-Host "Delivering to $DeliverTo ..." -ForegroundColor Cyan
# /MIR so removed files disappear from the delivered copy too. robocopy uses
# exit codes 0-7 for success; 8+ is a real failure.
$null = robocopy $BuiltPkg $DeliverTo /MIR /NFL /NDL /NJH /NJS /NP
if ($LASTEXITCODE -ge 8) {
    Write-Host "robocopy failed with code $LASTEXITCODE" -ForegroundColor Red
    exit 1
}

Write-Host ""
if ($problems -eq 0) {
    Write-Host "Done. Add-on delivered to:" -ForegroundColor Green
} else {
    Write-Host "Delivered with $problems warning(s):" -ForegroundColor Yellow
}
Write-Host "  $DeliverTo"
Write-Host "Run the service from:" -ForegroundColor Green
Write-Host "  $DeliverTo\Service\fauna_service.py"
Write-Host ""
Write-Host "Link it with Add-on Linker if it is not linked already, then FULLY" -ForegroundColor Yellow
Write-Host "close and reopen the sim (the SDK build breaks the next launch)." -ForegroundColor Yellow
