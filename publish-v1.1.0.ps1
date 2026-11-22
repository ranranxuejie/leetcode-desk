# 代理恢复后，一条命令把讲解 + 安装包发到 GitHub
# 用法：先打开 Clash Verge（等 127.0.0.1:7897 起来），然后跑这个脚本
$ErrorActionPreference = 'Continue'
$env:GH_TOKEN = [Environment]::GetEnvironmentVariable('GH_TOKEN', 'User')
$env:HTTPS_PROXY = 'http://127.0.0.1:7897'
$env:HTTP_PROXY = 'http://127.0.0.1:7897'

if (-not (Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -eq 7897 })) {
    Write-Host '代理没开（127.0.0.1:7897），先打开 Clash Verge' -ForegroundColor Red
    exit 1
}

Write-Host '[1/3] 推送代码…' -ForegroundColor Cyan
git -c protocol.version=0 -c http.sslBackend=schannel push

Write-Host '[2/3] 打包安装程序…' -ForegroundColor Cyan
Push-Location launcher
powershell -NoProfile -ExecutionPolicy Bypass -File .\make_installer.ps1 | Select-Object -Last 2
Copy-Item 'LeetCode训练台-安装程序.exe' "$env:TEMP\LeetCode-Desk-Setup-1.1.0.exe" -Force
Pop-Location

Write-Host '[3/3] 建 Release v1.1.0…' -ForegroundColor Cyan
gh release create v1.1.0 "$env:TEMP\LeetCode-Desk-Setup-1.1.0.exe" `
    --title 'LeetCode 训练台 v1.1.0 · 全量讲解' `
    --notes-file .tmp\release-notes-v1.1.0.md --latest

Write-Host '完成：https://github.com/ranranxuejie/leetcode-desk/releases/tag/v1.1.0' -ForegroundColor Green
