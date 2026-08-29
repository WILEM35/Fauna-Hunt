# Fauna Hunt -- build the MSFS package and deliver it to the Add-on Linker folder.
#
# Layout:
#   C:\Tools\fauna-hunt                      working folder, all source lives here
#     PackageSources\Copys\...\Panel         the panel (canonical -- edit in place)
#     wasm\fauna_module.cpp                   the module that reads the sim
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

# Stamp the package version into the panel so Settings can show which build
# is actually running. Without it, a stale build is indistinguishable from
# a bug that will not die -- which cost a test cycle.
$verXml = [xml](Get-Content "$ProjectDir\PackageDefinitions\wilem35-fauna-hunt.xml")
$version = $verXml.AssetPackage.Version
$panelJs = "$ProjectDir\PackageSources\Copys\fauna-hunt\Panel\html_ui\InGamePanels\FaunaHunt\FaunaHunt.js"
(Get-Content $panelJs -Raw) -replace 'const PANEL_VERSION = "[^"]*";', "const PANEL_VERSION = ""$version"";" |
    Set-Content $panelJs -NoNewline -Encoding utf8
Write-Host "Panel stamped as version $version" -ForegroundColor Cyan

# The panel carries its own copy of the species table. Regenerated every
# build so it can never drift from data/species.json.
Write-Host "Generating the panel's species table..." -ForegroundColor Cyan
& python "$ProjectDir\probe\make_species_js.py"
if ($LASTEXITCODE -ne 0) {
    Write-Host "Could not generate the species table." -ForegroundColor Red
    exit 1
}

Write-Host "Checking the panel scripts..." -ForegroundColor Cyan
& python "$ProjectDir\probe\check_js.py"
if ($LASTEXITCODE -ne 0) {
    Write-Host "Panel scripts did not pass. Not building." -ForegroundColor Red
    exit 1
}

# The in-sim module. This is what replaces the helper program.
Write-Host "Building the in-sim module..." -ForegroundColor Cyan
& "$ProjectDir\wasm\build-wasm.ps1"
if ($LASTEXITCODE -ne 0) {
    Write-Host "Module build failed." -ForegroundColor Red
    exit 1
}

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
    # The sim is checked before the build starts, but it can be LAUNCHED while
    # the build runs -- the tool then attaches to it and silently builds
    # nothing. That looks identical to a real failure, so say which it was.
    $now = Get-Process -Name @("FlightSimulator2024", "FlightSimulator") -ErrorAction SilentlyContinue
    if ($now) {
        Write-Host ""
        Write-Host "Microsoft Flight Simulator started WHILE this was building." -ForegroundColor Yellow
        Write-Host "The build tool attached to it and produced nothing. Close the" -ForegroundColor Yellow
        Write-Host "sim and run this again - nothing is wrong with the project." -ForegroundColor Yellow
    }
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

# What a player actually needs: the module that reads the sim, and the panel
# that shows it. There is no program to run any more.
foreach ($needed in @("modules\FaunaHunt.wasm",
                      "html_ui\InGamePanels\FaunaHunt\FaunaSpeciesData.js",
                      "html_ui\InGamePanels\FaunaHunt\FaunaInSim.js",
                      "html_ui\InGamePanels\FaunaHunt\FaunaHunt.js")) {
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
$null = robocopy $BuiltPkg $DeliverTo /MIR /R:2 /W:2 /NFL /NDL /NJH /NJS /NP
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
Write-Host ""
Write-Host "Link it with Add-on Linker if it is not linked already, then FULLY" -ForegroundColor Yellow
Write-Host "close and reopen the sim (the SDK build breaks the next launch)." -ForegroundColor Yellow
