# LeetCode 训练台 · Windows 桌面应用

双击 `LeetCode训练台.exe` 打开：一个**无边框窗口**，标题栏由页面自己画（深色、带品牌和窗口按钮），
不再是浏览器那种浅灰标题条。

## 它是怎么工作的

1. 先探测 `http://127.0.0.1:5173`：已经在跑就直接用（比如你同时开着 `npm run dev`）；
2. 没在跑就用 Node 在后台静默启动 `server.mjs`（不弹黑框），托管 `app/dist` 静态产物，
   并把 `/api/deepseek/*` 反向代理到 DeepSeek（Key 从 `app/.env.local` 读取，不进前端产物）；
3. 首次运行做一次**进度迁移**（见下）；
4. 用 **WebView2** 打开 `http://127.0.0.1:5173`，窗口 `FormBorderStyle=None`，
   标题栏由前端 `components/TitleBar.tsx` 绘制：拖动 / 最小化 / 最大化 / 关闭都通过
   `chrome.webview.postMessage` 交给 C# 宿主执行（拖拽走 `WM_NCLBUTTONDOWN`，所以
   Aero Snap、双击最大化、贴边分屏都还是系统原生行为）。

> 为什么不用 Chrome 的 `--app` 窗口了：那条标题栏是 Chrome 自己画的，颜色跟随系统主题，
> 深色界面配一条浅灰框很突兀，而且外部改不了。

### 进度迁移（一次性）

旧版进度存在 **Chrome 的 localStorage**，WebView2 用独立 profile，看不到它。所以首次启动会：

1. 用 Chrome 打开 `/?migrate=1`（一个小窗口，约 2 秒后自动关闭）；
2. 页面把 `lc.progress.v1` 和 `lc.ui.*` POST 到本地服务的 `/__migrate`；
3. 宿主取回来写进 WebView2 的 localStorage，然后刷新。

迁移成功后在 `%LOCALAPPDATA%\LeetCode训练台\.migrated` 留个标记，之后不再执行。
**Chrome 里的数据不会被删**，两个界面可以并存；确认新界面没问题后，旧窗口可以不再用。

## 文件

| 文件 | 作用 |
|---|---|
| `LeetCode训练台.exe` | 启动器（编译产物，双击用这个） |
| `server.mjs` | 零依赖本地服务：静态托管 + DeepSeek 代理 |
| `LeetCode训练台.cs` | 启动器源码（C#，.NET Framework 4） |
| `app.ico` / `app.png` | 图标（`make_icon.py` 生成） |
| `Microsoft.Web.WebView2.Core.dll` | WebView2 SDK（编译和运行都需要） |
| `Microsoft.Web.WebView2.WinForms.dll` | WebView2 的 WinForms 控件 |
| `WebView2Loader.dll` | WebView2 原生加载器（x64） |
| `build.ps1` | 一键重建：`npm run build` → 生成图标 → 编译 exe |
| `创建桌面快捷方式.vbs` | 在桌面创建带图标的快捷方式 |

## 第一次使用

### 依赖：WebView2

- **运行时**：Windows 10/11 自带「Microsoft Edge WebView2 Runtime」；没有的话装一下。
- **SDK**：上面三个 dll 来自 NuGet 包 `Microsoft.Web.WebView2`（`lib/net462` 下两个托管 dll
  + `build/native/x64/WebView2Loader.dll`），已经放进 `launcher/`，不用每次重下。

```powershell
cd D:\2026\leetcode\launcher
.\build.ps1                  # 构建前端 + 图标 + exe（约 10 秒）
# 可选：双击 创建桌面快捷方式.vbs，在桌面放一个入口
```

之后双击 `LeetCode训练台.exe` 即可。

## 打包成安装程序

```powershell
cd D:\2026\leetcode\launcher
.\build.ps1                 # 先出前端产物 + exe
.\make_installer.ps1        # 再打成安装包（约 45MB）
```

产物 `LeetCode训练台-安装程序.exe` 是**自解压安装包**，双击即可安装：

- 装到 `%LOCALAPPDATA%\Programs\LeetCode训练台`（**不需要管理员权限**）；
- 桌面 + 开始菜单创建快捷方式；
- 在「设置 → 应用 → 已安装的应用」里出现，可正常卸载（卸载默认**保留学习进度**）；
- 内嵌 node 运行时，装完**不再依赖系统的 Node.js**；
- 支持 `/silent` 静默安装、`/uninstall` 卸载。

包体构成：`app/dist`（约 39MB，含 Pyodide）+ `node.exe`（88MB，压缩后约 25MB）+ 启动器（约 1MB），
zip 后 45MB 左右。安装后磁盘占用约 128MB。

> AI 功能的 `app/.env.local`（DeepSeek Key）**不打包** —— 安装包会被到处拷贝，Key 不该跟着走。
> 需要 AI 的用户自己在 `安装目录\app\.env.local` 里写 `DEEPSEEK_API_KEY=sk-...`。

## 常见问题

- **提示没装 Node.js**：训练台的服务端是 Node 写的。装一个 LTS 版 Node（≥ 18）即可。
- **端口 5173 被占用**：如果是训练台自己或 `npm run dev` 占着，启动器会直接复用，不报错；
  如果是别的程序，换端口就会换 origin、看不到进度，所以请先关掉那个程序。
- **AI 功能不可用**：需要 `app\.env.local` 里有 `DEEPSEEK_API_KEY=sk-...`，改完重启训练台。
- **想彻底删掉**：删除整个 `launcher` 目录即可；学习进度在浏览器里，不受影响（用浏览器设置里的导出备份更稳）。
- **改了前端代码**：重新跑一次 `.\build.ps1`（它会重跑 `npm run build`）。
- **题库重建了但打开还是旧数据**：老版本的静态服务把 `data/*.json` 也标成了「一年不可变」，
  浏览器会一直用缓存。现在已改成协商缓存（ETag + `no-cache`），并且前端请求带 `cache: 'no-store'`。
  如果还遇到，按 `Ctrl+Shift+R` 强刷一次；桌面版请关掉窗口重开（后台 Node 服务会被复用，新代码在下一次启动时生效）。
- **想换窗口尺寸**：改 `LeetCode训练台.cs` 里的 `--window-size=1460,960`，然后重新编译。

## 已知限制

- 关掉窗口后，后台的 Node 服务会继续留着（内存约 40MB），下次打开会直接复用；重启电脑后自动消失。
- 没有做代码签名，Windows SmartScreen 第一次可能提示「未知发布者」，选「仍要运行」。
- 多显示器下窗口位置固定在 `60,40`，需要的话改源码里的 `--window-position`。
