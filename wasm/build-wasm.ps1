# Compile the probe module. Flags explained in C:\Tools\fauna-hunt\wasm\build-wasm.ps1.
$ErrorActionPreference = "Stop"
$SDK = "C:\MSFS 2024 SDK"
$src = "$PSScriptRoot\fauna_module.cpp"
$out = "$PSScriptRoot\..\PackageSources\Copys\fauna-hunt\Modules\FaunaHunt.wasm"
$obj = "$PSScriptRoot\fauna_module.o"

& "$SDK\WASM\llvm\bin\clang-cl.exe" -c --target=wasm32-unknown-wasi `
    "/clang:--sysroot=$SDK\WASM\wasi-sysroot" `
    "-I$SDK\WASM\wasi-sysroot\include" "-I$SDK\WASM\include" `
    "-I$SDK\SimConnect SDK\include" `
    -D_MSFS_WASM=1 -D__wasi__ -DNDEBUG -D_LIBCPP_HAS_NO_THREADS `
    /clang:-std=c++17 /clang:-O2 /clang:-fms-extensions /clang:-fno-stack-protector /GS- -o $obj $src
if ($LASTEXITCODE -ne 0) { exit 1 }

& "$SDK\WASM\llvm\bin\wasm-ld.exe" --no-entry --allow-undefined --export-dynamic `
    --export-table --export=module_init --export=module_deinit `
    --export=__wasm_call_ctors `
    --export=malloc --export=free -u malloc -u free `
    --export=GetExtensionVersion --export=GetExtensionVersionBuffer `
    --export=GetSimConnectVersion `
    -O2 --lto-O2 --stack-first -z stack-size=65536 `
    "-L$SDK\WASM\wasi-sysroot\lib\wasm32-wasi" "-L$SDK\WASM\lib" `
    "$SDK\WASM\WasmVersions\MSFS_WasmVersions.a" -lc -lc++ -lc++abi `
    -o $out $obj
if ($LASTEXITCODE -ne 0) { exit 1 }

Remove-Item $obj -Force -ErrorAction SilentlyContinue
Write-Host "Built $out ($((Get-Item $out).Length) bytes)" -ForegroundColor Green
