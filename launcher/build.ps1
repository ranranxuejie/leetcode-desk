# 一键重建：前端产物 + 图标 + exe（自绘边框版，依赖 WebView2）
# 用法：右键「使用 PowerShell 运行」，或在终端执行 .\build.ps1
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$app = Join-Path $here '..\app'

Write-Host '[1/5] 构建前端产物 (app/dist)…' -ForegroundColor Cyan
Push-Location $app
try {
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw "npm run build 失败（exit $LASTEXITCODE）" }
}
finally {
    Pop-Location
}

Write-Host '[2/5] 生成图标（app.ico + 网页图标）…' -ForegroundColor Cyan
& python (Join-Path $here 'make_icon.py')
if ($LASTEXITCODE -ne 0) { throw 'make_icon.py 失败' }

Write-Host '[3/5] 检查 WebView2 SDK 依赖…' -ForegroundColor Cyan
$deps = @(
    'Microsoft.Web.WebView2.Core.dll',
    'Microsoft.Web.WebView2.WinForms.dll',
    'WebView2Loader.dll'
)
foreach ($dep in $deps) {
    $path = Join-Path $here $dep
    if (-not (Test-Path $path)) {
        throw "缺少 $dep。它随 WebView2 SDK 一起提供，应放在 launcher\ 目录（见 launcher\README.md 的「依赖」一节）。"
    }
}

Write-Host '[4/5] 编译 LeetCode训练台.exe…' -ForegroundColor Cyan
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { $csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe' }
if (-not (Test-Path $csc)) { throw '找不到 csc.exe（.NET Framework 4 编译器）' }

$exe = Join-Path $here 'LeetCode训练台.exe'
& $csc /nologo /target:winexe /optimize+ `
    "/out:$exe" `
    "/win32icon:$(Join-Path $here 'app.ico')" `
    /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:System.Net.Http.dll `
    "/r:$(Join-Path $here 'Microsoft.Web.WebView2.Core.dll')" `
    "/r:$(Join-Path $here 'Microsoft.Web.WebView2.WinForms.dll')" `
    (Join-Path $here 'LeetCode训练台.cs')
if ($LASTEXITCODE -ne 0) { throw "csc 编译失败（exit $LASTEXITCODE）" }

Write-Host '[5/5] 完成' -ForegroundColor Green
Write-Host "  应用：$exe"
Write-Host '  双击即可打开；桌面快捷方式可运行 创建桌面快捷方式.ps1'
