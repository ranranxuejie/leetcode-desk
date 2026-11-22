# 打包成「可安装的 exe」：把 launcher + app/dist + node 运行时塞进一个自解压安装包。
#
# 用法：右键「使用 PowerShell 运行」，或在终端执行 .\make_installer.ps1
# 产物：launcher\LeetCode训练台-安装程序.exe（约 60MB，双击即装，不需要管理员权限）
#
# 依赖：本机要有 node.exe（默认用 C:\Program Files\nodejs\node.exe，或 PATH 里的 node）。
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $here
$app = Join-Path $root 'app'
$work = Join-Path $root '.tmp\installer'

Write-Host '[1/5] 检查前端产物…' -ForegroundColor Cyan
$dist = Join-Path $app 'dist'
if (-not (Test-Path (Join-Path $dist 'index.html'))) {
    throw "缺少 app\dist，请先在 app 目录执行 npm run build（或运行 launcher\build.ps1）。"
}

Write-Host '[2/5] 找 node 运行时…' -ForegroundColor Cyan
$nodeCandidates = @(
    (Join-Path $env:ProgramFiles 'nodejs\node.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'nodejs\node.exe'),
    (Get-Command node -ErrorAction SilentlyContinue).Source
)
$nodeExe = $nodeCandidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if (-not $nodeExe) { throw '找不到 node.exe（装一个 Node.js LTS，或把 node 加到 PATH）。' }
Write-Host ("    用这个：" + $nodeExe)

Write-Host '[3/5] 组装安装目录…' -ForegroundColor Cyan
if (Test-Path $work) { Remove-Item $work -Recurse -Force }
$stage = Join-Path $work 'stage'
New-Item -ItemType Directory -Force -Path (Join-Path $stage 'launcher') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $stage 'app\dist') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $stage 'node') | Out-Null

# 启动器需要的文件（源码和构建脚本不带进安装包）
foreach ($name in @('LeetCode训练台.exe', 'server.mjs', 'app.ico',
                    'Microsoft.Web.WebView2.Core.dll', 'Microsoft.Web.WebView2.WinForms.dll', 'WebView2Loader.dll')) {
    $src = Join-Path $here $name
    if (-not (Test-Path $src)) { throw "缺少 $name（先跑 build.ps1）。" }
    Copy-Item $src (Join-Path $stage "launcher\$name")
}

Copy-Item (Join-Path $dist '*') (Join-Path $stage 'app\dist') -Recurse -Force
Copy-Item $nodeExe (Join-Path $stage 'node\node.exe')

# 把 app 目录下的 .env.local（AI Key）一起带上？不带 —— 安装包会被到处拷，Key 不该跟着走。
# 需要 AI 功能的用户自己在 安装目录\app\.env.local 里写 DEEPSEEK_API_KEY。

Write-Host '[4/5] 打 zip 负载…' -ForegroundColor Cyan
$zip = Join-Path $work 'payload.zip'
Add-Type -AssemblyName System.IO.Compression.FileSystem
if (Test-Path $zip) { Remove-Item $zip -Force }
[System.IO.Compression.ZipFile]::CreateFromDirectory($stage, $zip, [System.IO.Compression.CompressionLevel]::Optimal, $false)
$zipMb = [math]::Round((Get-Item $zip).Length / 1MB, 1)
Write-Host ("    payload.zip = " + $zipMb + " MB")

Write-Host '[5/5] 编译安装程序…' -ForegroundColor Cyan
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { $csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe' }
if (-not (Test-Path $csc)) { throw '找不到 csc.exe（.NET Framework 4 编译器）' }

$out = Join-Path $here 'LeetCode训练台-安装程序.exe'
& $csc /nologo /target:winexe /optimize+ `
    "/out:$out" `
    "/win32icon:$(Join-Path $here 'app.ico')" `
    "/resource:$zip,payload.zip" `
    /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:System.IO.Compression.dll `
    /r:System.IO.Compression.FileSystem.dll /r:Microsoft.CSharp.dll `
    (Join-Path $here 'Setup.cs')
if ($LASTEXITCODE -ne 0) { throw "csc 编译失败（exit $LASTEXITCODE）" }

$exeMb = [math]::Round((Get-Item $out).Length / 1MB, 1)
Write-Host ''
Write-Host ('完成：' + $out) -ForegroundColor Green
Write-Host ("      大小 " + $exeMb + " MB；双击安装到 %LOCALAPPDATA%\Programs\LeetCode训练台")
Write-Host '      卸载：设置 → 应用 → 已安装的应用 → LeetCode 训练台（或 Setup.exe /uninstall）'
