# 在桌面创建「LeetCode 训练台」快捷方式（带图标）
# 右键本文件 →「使用 PowerShell 运行」；重复运行会覆盖旧快捷方式。
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$exe = Join-Path $here 'LeetCode训练台.exe'
$icon = Join-Path $here 'app.ico'

if (-not (Test-Path $exe)) {
    Write-Host '还没找到 LeetCode训练台.exe，请先运行 build.ps1 完成构建。' -ForegroundColor Yellow
    exit 1
}

$desktop = [Environment]::GetFolderPath('Desktop')
$linkPath = Join-Path $desktop 'LeetCode 训练台.lnk'
$shell = New-Object -ComObject WScript.Shell
$link = $shell.CreateShortcut($linkPath)
$link.TargetPath = $exe
$link.WorkingDirectory = $here
$link.Description = 'LeetCode 训练台 · 本地刷题工作台'
if (Test-Path $icon) { $link.IconLocation = $icon }
$link.Save()

Write-Host "桌面快捷方式已创建：$linkPath" -ForegroundColor Green
