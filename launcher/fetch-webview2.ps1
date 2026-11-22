# 下载 WebView2 SDK 到 launcher/（三个 dll 不进 git 仓库，克隆后跑一次这个脚本）
#
# 为什么需要：桌面版用 WebView2 渲染，编译要引用 Microsoft.Web.WebView2.Core.dll 和
# .WinForms.dll，运行时还要 WebView2Loader.dll。这三个文件来自微软的 NuGet 包，
# 不适合提交到仓库，所以用脚本按需拉取。
#
# 用法：右键「使用 PowerShell 运行」，或在终端执行 .\fetch-webview2.ps1
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$version = '1.0.4370.26'
$url = "https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/$version/microsoft.web.webview2.$version.nupkg"
$tmp = Join-Path $env:TEMP ("webview2-" + [guid]::NewGuid().ToString('n'))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

Write-Host "[1/3] 下载 WebView2 SDK $version …" -ForegroundColor Cyan
$nupkg = Join-Path $tmp 'webview2.nupkg'
Invoke-WebRequest $url -OutFile $nupkg -TimeoutSec 180
Write-Host ("      " + [math]::Round((Get-Item $nupkg).Length / 1MB, 1) + " MB")

Write-Host '[2/3] 解压需要的三个文件…' -ForegroundColor Cyan
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead($nupkg)
$wanted = @(
    'lib/net462/Microsoft.Web.WebView2.Core.dll',
    'lib/net462/Microsoft.Web.WebView2.WinForms.dll',
    'build/native/x64/WebView2Loader.dll'
)
foreach ($name in $wanted) {
    $entry = $zip.Entries | Where-Object { $_.FullName -eq $name }
    if (-not $entry) { throw "包结构变了，找不到 $name" }
    $target = Join-Path $here ([System.IO.Path]::GetFileName($name))
    [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $target, $true)
    Write-Host "      -> $([System.IO.Path]::GetFileName($name))"
}
$zip.Dispose()
Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue

Write-Host '[3/3] 完成' -ForegroundColor Green
Write-Host '  现在可以运行 .\build.ps1 编译桌面版了。'
