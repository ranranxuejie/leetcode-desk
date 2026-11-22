# 发布到 GitHub（一键）
#
# 先决条件（二选一）：
#   A. 已安装 GitHub CLI 并登录：  gh auth login
#   B. 或者手动在网页上建好空仓库，然后把这个脚本里 $remote 改成你的地址
#
# 用法：
#   .\publish-to-github.ps1                       # 用默认仓库名 leetcode-desk，公开
#   .\publish-to-github.ps1 -Repo my-name -Private
#
# 脚本做的事：检查是否登录 → 建仓库（已存在就跳过）→ 推 main 分支 → 打印结果。
# 密钥安全：推送前会再扫一遍「不该进仓库的文件」，发现就中止。
param(
    [string]$Repo = 'leetcode-desk',
    [switch]$Private
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Push-Location $root
try {
    Write-Host '[1/4] 检查 git 仓库…' -ForegroundColor Cyan
    if (-not (Test-Path (Join-Path $root '.git'))) {
        throw '这里还不是 git 仓库。先跑一次：git init; git add -A; git commit -m "init"'
    }

    Write-Host '[2/4] 扫描不该提交的文件…' -ForegroundColor Cyan
    $tracked = git ls-files
    $bad = $tracked | Where-Object {
        $_ -match '(^|/)\.env($|\.)|\.key$|(^|/)node_modules/|^\.tmp/|(^|/)dist/|\.exe$|\.dll$'
    }
    if ($bad) {
        Write-Host '发现这些文件被 git 跟踪了，先移出索引再发布：' -ForegroundColor Red
        $bad | Select-Object -First 10 | ForEach-Object { Write-Host "  $_" -ForegroundColor Red }
        throw '中止：请先 git rm --cached 这些文件，并确认 .gitignore 生效'
    }
    $keyHit = git grep -I -l 'sk-[0-9a-f]\{20,\}' 2>$null
    if ($keyHit) {
        Write-Host '仓库里出现疑似真实 Key 的字面量：' -ForegroundColor Red
        $keyHit | ForEach-Object { Write-Host "  $_" -ForegroundColor Red }
        throw '中止：请把 Key 换成占位符（sk-xxx）'
    }
    Write-Host '      通过：没有 .env / 密钥 / 构建产物' -ForegroundColor Green

    Write-Host '[3/4] 检查 GitHub 登录状态…' -ForegroundColor Cyan
    $authOk = $false
    try {
        $ErrorActionPreference = 'Continue'
        $null = gh auth status 2>&1
        $authOk = ($LASTEXITCODE -eq 0)
    } catch {
        $authOk = $false
    } finally {
        $ErrorActionPreference = 'Stop'
    }
    if (-not $authOk) {
        Write-Host '      还没登录 GitHub。运行下面这行，登录后再跑一次本脚本：' -ForegroundColor Yellow
        Write-Host '        gh auth login' -ForegroundColor Yellow
        exit 1
    }
    $owner = (gh api user --jq .login)
    Write-Host "      已登录：$owner"

    Write-Host '[4/4] 建仓库并推送…' -ForegroundColor Cyan
    $visibility = if ($Private) { '--private' } else { '--public' }
    $existing = gh repo view "$owner/$Repo" --json name 2>$null
    if ($existing) {
        Write-Host "      仓库 $owner/$Repo 已存在，直接推送"
    } else {
        gh repo create $Repo $visibility --description '本地 LeetCode 刷题工具：全量题库 + AI 精讲 + 边界用例判题 + 桌面版' --source . --remote origin
    }

    $remote = git remote get-url origin 2>$null
    if (-not $remote) { git remote add origin "https://github.com/$owner/$Repo.git" }
    git branch -M main 2>$null
    # 这台机器上 git 走代理时，默认 HTTP/2 + openssl 会被中途重置；
    # 实测 protocol v0 + schannel 才稳（连几百字节的小分支也会被重置，所以不是体积问题）
    git -c protocol.version=0 -c http.sslBackend=schannel push -u origin main

    Write-Host ''
    Write-Host ("完成：https://github.com/" + $owner + "/" + $Repo) -ForegroundColor Green
}
finally {
    Pop-Location
}
