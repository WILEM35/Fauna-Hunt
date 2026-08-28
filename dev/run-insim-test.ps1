# Run the in-sim translator's tests.
#
# No node on this machine, so headless Chrome is the JavaScript runtime. The
# page writes its results into the DOM and --dump-dom brings them back.

$ErrorActionPreference = "Stop"
$page = Join-Path $PSScriptRoot "insim_test.html"
$chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
if (-not (Test-Path $chrome)) {
    $chrome = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
}
if (-not (Test-Path $chrome)) {
    Write-Host "No Chrome or Edge found to run the tests with." -ForegroundColor Red
    exit 1
}

$dom = & $chrome --headless=new --disable-gpu --no-sandbox --virtual-time-budget=4000 `
    --dump-dom ("file:///" + $page.Replace("\", "/")) 2>$null | Out-String

if ($dom -match '(?s)<pre id="out">(.*?)</pre>') {
    $text = [System.Net.WebUtility]::HtmlDecode($Matches[1])
    Write-Host $text
    if ($text -match "ALL PASSED") { exit 0 }
    exit 1
}
Write-Host "Could not read the results out of the page." -ForegroundColor Red
exit 1
