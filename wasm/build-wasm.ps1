# Build a WebAssembly module for MSFS -- WITHOUT Visual Studio.
#
# The SDK ships its own clang and linker, so the usual "install Visual Studio
# and the MSFS platform toolset" route is not the only one. These flags were
# arrived at by trial and are known to produce a loadable module; the two that
# are easy to get wrong:
#
#   * clang-cl silently IGNORES --sysroot. It has to be handed through with
#     the /clang: prefix or every wasi header is missing.
#   * MSFS_WindowsTypes.h uses __int64, a Microsoft extension that is off by
#     default when targeting wasi -- hence -fms-extensions.
#
# --allow-undefined is not optional: SimConnect_* and fs* are provided by the
# simulator at load time, so they are SUPPOSED to be unresolved here.

param([string]$Source = "$PSScriptRoot\feasibility_probe.cpp",
      [string]$Out    = "$PSScriptRoot\FaunaHunt.wasm")

$ErrorActionPreference = "Stop"
$SDK = "C:\MSFS 2024 SDK"
$obj = [System.IO.Path]::ChangeExtension($Out, ".o")

& "$SDK\WASM\llvm\bin\clang-cl.exe" -c `
    --target=wasm32-unknown-wasi `
    "/clang:--sysroot=$SDK\WASM\wasi-sysroot" `
    "-I$SDK\WASM\wasi-sysroot\include" `
    "-I$SDK\WASM\include" `
    "-I$SDK\SimConnect SDK\include" `
    -D_MSFS_WASM=1 -D__wasi__ -DNDEBUG -D_LIBCPP_HAS_NO_THREADS `
    /clang:-std=c++17 /clang:-O2 /clang:-fms-extensions `
    -o $obj $Source
if ($LASTEXITCODE -ne 0) { Write-Host "Compile failed." -ForegroundColor Red; exit 1 }

& "$SDK\WASM\llvm\bin\wasm-ld.exe" `
    --no-entry --allow-undefined --export-dynamic --export-table `
    --export=module_init --export=module_deinit `
    -O2 --lto-O2 --stack-first -z stack-size=65536 `
    "-L$SDK\WASM\wasi-sysroot\lib\wasm32-wasi" "-L$SDK\WASM\lib" `
    -lc -lc++ -lc++abi `
    -o $Out $obj
if ($LASTEXITCODE -ne 0) { Write-Host "Link failed." -ForegroundColor Red; exit 1 }

Remove-Item $obj -Force -ErrorAction SilentlyContinue
Write-Host "Built $Out ($((Get-Item $Out).Length) bytes)" -ForegroundColor Green
Write-Host "Check what the sim must provide it:" -ForegroundColor Yellow
Write-Host "  python C:\Tools\fauna-hunt\probe\wasm_imports.py `"$Out`""
