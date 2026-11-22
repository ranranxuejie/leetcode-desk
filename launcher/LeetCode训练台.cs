// LeetCode 训练台 · Windows 启动器（自绘边框版）
//
// 双击后做四件事：
//   1. 探测 http://127.0.0.1:5173 —— 已经有服务就直接用；
//   2. 没有就用 node 悄悄起 launcher/server.mjs（不弹黑框），等端口就绪；
//   3. 首次运行时先把旧版（Chrome 窗口）的进度捞出来（见 ChromeMigrator）；
//   4. 用 WebView2 打开一个**无边框窗口**，标题栏由页面自己画：拖拽 / 最小化 / 最大化 / 关闭
//      通过 postMessage 交给宿主执行。
//
// 为什么不再用 Chrome 的 --app 窗口：那条标题栏是 Chrome 自己画的，颜色跟系统主题走，
// 深色界面配一条浅灰框很突兀，而且我们改不了它。
//
// 进度迁移：旧版进度存在 Chrome 的 localStorage，WebView2 用独立 profile、看不到它。
// 首次启动时临时开一个 Chrome 窗口打开 ?migrate=1，页面把 localStorage 里的进度 POST 到
// 本地服务的 /__migrate，宿主再把它写进 WebView2 的 localStorage。

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net.Http;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

internal static class Launcher
{
    internal const string Url = "http://127.0.0.1:5173/";
    internal const int Port = 5173;

    internal static string DataRoot
    {
        get
        {
            return Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "LeetCode训练台");
        }
    }

    [DllImport("user32.dll")]
    private static extern bool SetProcessDPIAware();

    [STAThread]
    private static void Main()
    {
        // 必须在创建任何窗口之前调用：否则高分屏下 WinForms 拿到的是虚拟化坐标，
        // 居中算出来的位置会把窗口摆到屏幕外（实测 y = -34）。
        try { SetProcessDPIAware(); } catch { }
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);

        string here = AppDomain.CurrentDomain.BaseDirectory;

        if (!IsUp(1500))
        {
            if (!StartServer(here))
            {
                MessageBox.Show(
                    "没能启动本地服务。\n\n请确认：\n1. 已安装 Node.js（命令行执行 node -v 能看到版本号）\n2. 训练台目录完整（launcher\\server.mjs 存在）",
                    "LeetCode 训练台", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }
            if (!WaitUp(20000))
            {
                MessageBox.Show(
                    "本地服务启动超时（20 秒）。\n\n请检查端口 5173 是否被其它程序占用，或手动在命令行运行：\nnode launcher\\server.mjs",
                    "LeetCode 训练台", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }
        }

        string payload = ChromeMigrator.RunIfNeeded();
        Application.Run(new ShellForm(here, payload));
    }

    // ---------------------------------------------------------------- 服务探测 / 启动

    private static bool IsUp(int timeoutMs)
    {
        try
        {
            using (var client = new HttpClient { Timeout = TimeSpan.FromMilliseconds(timeoutMs) })
            using (var response = client.GetAsync(Url).GetAwaiter().GetResult())
            {
                return response.IsSuccessStatusCode;
            }
        }
        catch
        {
            return false;
        }
    }

    private static bool WaitUp(int timeoutMs)
    {
        var watch = Stopwatch.StartNew();
        while (watch.ElapsedMilliseconds < timeoutMs)
        {
            if (IsUp(800)) return true;
            Thread.Sleep(250);
        }
        return false;
    }

    private static bool StartServer(string here)
    {
        string script = Path.Combine(here, "server.mjs");
        if (!File.Exists(script)) return false;

        // 安装包会把 node 运行时放在 ..\node\node.exe，优先用它（这样装了包就不再依赖系统 Node）
        // here 带结尾反斜杠（BaseDirectory），GetDirectoryName 会原样返回 launcher 目录，
        // 所以这里直接拼 ..\node\node.exe
        var candidates = new List<string> { Path.GetFullPath(Path.Combine(here, "..", "node", "node.exe")) };
        candidates.Add("node");
        candidates.Add(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "nodejs", "node.exe"));
        candidates.Add(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "nodejs", "node.exe"));

        foreach (var node in candidates)
        {
            try
            {
                var info = new ProcessStartInfo
                {
                    FileName = node,
                    Arguments = "\"" + script + "\"",
                    WorkingDirectory = here,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                };
                Process.Start(info);
                return true;
            }
            catch
            {
                // 换下一个候选
            }
        }
        return false;
    }
}

/// <summary>
/// 一次性进度迁移：用 Chrome 打开 ?migrate=1，页面把 localStorage POST 到本地服务，
/// 这里把 JSON 取回来交给 ShellForm 注入 WebView2。
/// </summary>
internal static class ChromeMigrator
{
    private static string MarkerPath
    {
        get { return Path.Combine(Launcher.DataRoot, ".migrated"); }
    }

    public static void MarkDone()
    {
        try
        {
            Directory.CreateDirectory(Launcher.DataRoot);
            File.WriteAllText(MarkerPath, DateTime.Now.ToString("s"));
        }
        catch
        {
            // 标记写不下就下次再试，不影响使用
        }
    }

    public static string RunIfNeeded()
    {
        try
        {
            if (File.Exists(MarkerPath)) return null;
        }
        catch
        {
            return null;
        }

        string baseUrl = "http://127.0.0.1:" + Launcher.Port;
        try
        {
            using (var client = new HttpClient { Timeout = TimeSpan.FromSeconds(4) })
            {
                client.PostAsync(baseUrl + "/__migrate/reset", null).GetAwaiter().GetResult();
            }
        }
        catch
        {
            return null; // 服务端还是老版本，跳过迁移
        }

        if (!LaunchChrome(baseUrl + "/?migrate=1")) return null;

        // 轮询等页面把数据 POST 上来（最多 12 秒）
        var watch = Stopwatch.StartNew();
        while (watch.ElapsedMilliseconds < 12000)
        {
            Thread.Sleep(400);
            try
            {
                using (var client = new HttpClient { Timeout = TimeSpan.FromSeconds(3) })
                {
                    string body = client.GetStringAsync(baseUrl + "/__migrate").GetAwaiter().GetResult();
                    if (!string.IsNullOrWhiteSpace(body) && body.Trim() != "{}")
                    {
                        MarkDone();
                        return body;
                    }
                }
            }
            catch
            {
                // 还没准备好
            }
        }
        MarkDone(); // 旧版没进度：标记完成，别每次都开窗口
        return null;
    }

    private static bool LaunchChrome(string migrateUrl)
    {
        var candidates = new List<string>
        {
            @"C:\Program Files\Google\Chrome\Application\chrome.exe",
            @"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
            @"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
            @"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        };
        foreach (var browser in candidates)
        {
            if (!File.Exists(browser)) continue;
            try
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = browser,
                    Arguments = "--app=" + migrateUrl + " --window-size=520,320 --window-position=240,180" +
                                " --no-first-run --no-default-browser-check",
                    UseShellExecute = false,
                });
                return true;
            }
            catch
            {
                // 换下一个浏览器
            }
        }
        return false;
    }
}

/// <summary>无边框窗口 + WebView2；标题栏交给页面绘制。</summary>
internal sealed class ShellForm : Form
{
    private const int WM_NCHITTEST = 0x0084;
    private const int WM_GETMINMAXINFO = 0x0024;
    private const int HTLEFT = 10, HTRIGHT = 11, HTTOP = 12, HTTOPLEFT = 13, HTTOPRIGHT = 14;
    private const int HTBOTTOM = 15, HTBOTTOMLEFT = 16, HTBOTTOMRIGHT = 17, HTCAPTION = 2;
    private const int RESIZE_EDGE = 6;
    private const int SM_CXSIZEFRAME = 32;
    private const int SM_CYSIZEFRAME = 33;
    private const int SM_CXPADDEDBORDER = 92;

    private readonly string _here;
    private readonly string _payload;
    private WebView2 _view;
    private bool _migrated;
    /// <summary>当前是不是浅色主题（窗口描边/底色要用；页面切换主题时会更新）</summary>
    private bool _light;
    /// <summary>是否处于 F11 真全屏（客户区铺满整块屏幕）</summary>
    private bool _fullscreen;
    private Rectangle _restoreBounds;

    public ShellForm(string here, string payload)
    {
        _here = here;
        _payload = payload;

        Text = "LeetCode 训练台";
        FormBorderStyle = FormBorderStyle.None;
        StartPosition = FormStartPosition.Manual;
        BackColor = Color.FromArgb(0x07, 0x09, 0x0B);
        MinimumSize = new Size(960, 640);
        KeyPreview = true;

        // 默认占工作区的 88% / 92%，居中（DPI 感知已开，这里拿到的是物理像素）
        var area = Screen.PrimaryScreen.WorkingArea;
        int w = Math.Min(1680, Math.Max(1100, (int)(area.Width * 0.88)));
        int h = Math.Min(1080, Math.Max(720, (int)(area.Height * 0.92)));
        Bounds = new Rectangle(area.X + (area.Width - w) / 2, area.Y + (area.Height - h) / 2, w, h);

        _view = new WebView2 { Dock = DockStyle.Fill };
        Controls.Add(_view);

        Load += async (s, e) => await InitAsync();
        Shown += (s, e) => ApplyFramePolish();
        Resize += (s, e) => PostMaximizedState();
    }

    // ---------------------------------------------------------------- 初始化

    private async Task InitAsync()
    {
        try
        {
            string dataDir = Path.Combine(Launcher.DataRoot, "WebView2");
            Directory.CreateDirectory(dataDir);

            // 只在显式设了 LC_SHELL_DEBUG=1 时开调试端口，方便用 CDP 验收（默认关闭）
            string debugPort = Environment.GetEnvironmentVariable("LC_SHELL_DEBUG");
            var options = string.IsNullOrEmpty(debugPort)
                ? null
                : new CoreWebView2EnvironmentOptions("--remote-debugging-port=" + debugPort);
            var env = await CoreWebView2Environment.CreateAsync(null, dataDir, options);
            await _view.EnsureCoreWebView2Async(env);

            var core = _view.CoreWebView2;
            core.Settings.AreDefaultContextMenusEnabled = false;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.AreDevToolsEnabled = true;
            core.Settings.IsZoomControlEnabled = false;

            // 让页面知道自己在壳里（决定要不要画自绘标题栏）
            await core.AddScriptToExecuteOnDocumentCreatedAsync(
                "window.__LC_SHELL__ = { platform: 'windows' };");

            core.WebMessageReceived += OnWebMessage;
            core.NavigationCompleted += async (s, e) =>
            {
                await OnNavigatedAsync();
                await SyncThemeFromPageAsync();
            };

            core.Navigate(Launcher.Url);
        }
        catch (Exception error)
        {
            MessageBox.Show(
                "界面初始化失败（WebView2）：\n" + error.Message +
                "\n\n这台机器需要安装「Microsoft Edge WebView2 Runtime」，Windows 10/11 通常自带。",
                "LeetCode 训练台", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            Close();
        }
    }

    private async Task OnNavigatedAsync()
    {
        if (_migrated) return;
        _migrated = true;
        if (string.IsNullOrEmpty(_payload)) return;
        try
        {
            string script =
                "(function(){var d=" + _payload + ";" +
                "for (var k in d) { if (Object.prototype.hasOwnProperty.call(d,k)) { localStorage.setItem(k, d[k]); } }" +
                "return Object.keys(d).length;})()";
            await _view.CoreWebView2.ExecuteScriptAsync(script);
            _view.CoreWebView2.Reload();
        }
        catch
        {
            // 迁移失败不影响使用
        }
    }

    /// <summary>
    /// 页面加载完问一次当前主题。消息通道有时序问题（页面可能在窗口 Shown 之前就发了），
    /// 这里补一刀，保证窗口描边和底色跟页面一致。
    /// </summary>
    private async Task SyncThemeFromPageAsync()
    {
        try
        {
            string raw = await _view.CoreWebView2.ExecuteScriptAsync(
                "document.documentElement.dataset.theme || ''");
            string theme = raw == null ? "" : raw.Trim('"');
            if (theme == "light") ApplyThemeColors(true);
            else if (theme == "dark") ApplyThemeColors(false);
        }
        catch
        {
            // 页面还没准备好，忽略
        }
    }

    /// <summary>把「是否已最大化」告诉页面，用来切换按钮图标。</summary>
    private void PostMaximizedState()
    {
        try
        {
            if (_view == null || _view.CoreWebView2 == null) return;
            string json = WindowState == FormWindowState.Maximized
                ? "{\"maximized\":true}"
                : "{\"maximized\":false}";
            _view.CoreWebView2.PostWebMessageAsJson(json);
        }
        catch
        {
            // 页面还没准备好，忽略
        }
    }

    // ---------------------------------------------------------------- 页面发来的消息

    private void OnWebMessage(object sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        string message;
        try
        {
            message = e.TryGetWebMessageAsString();
        }
        catch
        {
            return;
        }
        switch (message)
        {
            case "minimize":
                WindowState = FormWindowState.Minimized;
                break;
            case "maximize":
                WindowState = WindowState == FormWindowState.Maximized
                    ? FormWindowState.Normal
                    : FormWindowState.Maximized;
                break;
            case "close":
                Close();
                break;
            case "drag":
                ReleaseCapture();
                SendMessage(Handle, 0x00A1 /* WM_NCLBUTTONDOWN */, (IntPtr)HTCAPTION, IntPtr.Zero);
                break;
            case "theme:light":
                ApplyThemeColors(true);
                break;
            case "theme:dark":
                ApplyThemeColors(false);
                break;
            case "fullscreen":
                ToggleFullscreen();
                break;
        }
    }

    // ---------------------------------------------------------------- 无边框的缩放 / 圆角

    /// <summary>缩放边框（非客户区）厚度：SM_CXSIZEFRAME + SM_CXPADDEDBORDER</summary>
    private int FrameWidth
    {
        get { return GetSystemMetrics(SM_CXSIZEFRAME) + GetSystemMetrics(SM_CXPADDEDBORDER); }
    }

    private int FrameHeight
    {
        get { return GetSystemMetrics(SM_CYSIZEFRAME) + GetSystemMetrics(SM_CXPADDEDBORDER); }
    }

    /// <summary>
    /// F11 真全屏：客户区铺满整块显示器（含任务栏区域）。
    /// 最大化只到工作区（保留任务栏），两者不一样。
    /// </summary>
    private void ToggleFullscreen()
    {
        if (!_fullscreen)
        {
            _restoreBounds = Bounds;
            if (WindowState != FormWindowState.Normal) WindowState = FormWindowState.Normal;
            var screen = Screen.FromHandle(Handle);
            var b = screen.Bounds;
            // 同样要把边框厚度补上，否则四周会各留一条缝
            Bounds = new Rectangle(
                b.Left - FrameWidth,
                b.Top - FrameHeight,
                b.Width + FrameWidth * 2,
                b.Height + FrameHeight * 2);
            _fullscreen = true;
        }
        else
        {
            _fullscreen = false;
            Bounds = _restoreBounds;
        }
        PostMaximizedState();
    }

    protected override void OnResize(EventArgs e)
    {
        base.OnResize(e);
        // 最大化/还原时 DWM 的圆角要跟着关掉（全屏圆角会露出桌面）
        try
        {
            int round = (WindowState == FormWindowState.Maximized || _fullscreen) ? 1 /* DWMWCP_DONOTROUND */ : 2;
            DwmSetWindowAttribute(Handle, 33, ref round, sizeof(int));
        }
        catch
        {
            // 老系统忽略
        }
    }

    protected override CreateParams CreateParams
    {
        get
        {
            var cp = base.CreateParams;
            cp.Style |= 0x00040000; // WS_THICKFRAME：让 WM_NCHITTEST 的边缘命中能真正缩放
            return cp;
        }
    }

    protected override void WndProc(ref Message m)
    {
        if (m.Msg == WM_NCHITTEST)
        {
            base.WndProc(ref m);
            if ((int)m.Result == 1 /* HTCLIENT */)
            {
                Point p = PointToClient(new Point(
                    unchecked((short)(long)m.LParam),
                    unchecked((short)((long)m.LParam >> 16))));
                bool left = p.X <= RESIZE_EDGE;
                bool right = p.X >= ClientSize.Width - RESIZE_EDGE;
                bool top = p.Y <= RESIZE_EDGE;
                bool bottom = p.Y >= ClientSize.Height - RESIZE_EDGE;
                if (top && left) m.Result = (IntPtr)HTTOPLEFT;
                else if (top && right) m.Result = (IntPtr)HTTOPRIGHT;
                else if (bottom && left) m.Result = (IntPtr)HTBOTTOMLEFT;
                else if (bottom && right) m.Result = (IntPtr)HTBOTTOMRIGHT;
                else if (left) m.Result = (IntPtr)HTLEFT;
                else if (right) m.Result = (IntPtr)HTRIGHT;
                else if (top) m.Result = (IntPtr)HTTOP;
                else if (bottom) m.Result = (IntPtr)HTBOTTOM;
            }
            return;
        }

        if (m.Msg == WM_GETMINMAXINFO)
        {
            // 无边框窗口 + WS_THICKFRAME 时，窗口矩形包含一圈「缩放边框」（非客户区）。
            // 直接把 ptMaxSize 设成工作区，客户区就比工作区小一圈 —— 表现就是最大化后
            // 右侧和下侧各留一条缝。这里把边框厚度补进去，让**客户区**正好等于工作区。
            var info = (MINMAXINFO)Marshal.PtrToStructure(m.LParam, typeof(MINMAXINFO));
            var area = Screen.FromHandle(Handle).WorkingArea;
            int fw = FrameWidth;
            int fh = FrameHeight;
            info.ptMaxPosition.X = area.Left - fw;
            info.ptMaxPosition.Y = area.Top - fh;
            info.ptMaxSize.X = area.Width + fw * 2;
            info.ptMaxSize.Y = area.Height + fh * 2;
            Marshal.StructureToPtr(info, m.LParam, true);
        }

        base.WndProc(ref m);
    }

    /// <summary>
    /// 窗口描边 + 窗体底色跟着页面主题走。
    /// 不做的话，浅色模式下窗口四周会留一圈深色边（DWM 边框和 BackColor 还是深色）。
    /// </summary>
    private void ApplyThemeColors(bool light)
    {
        _light = light;
        // 和页面标题栏同一个色：深色 #07090b / 浅色 #efece6
        BackColor = light ? Color.FromArgb(0xEF, 0xEC, 0xE6) : Color.FromArgb(0x07, 0x09, 0x0B);
        try
        {
            // DWMWA_BORDER_COLOR 要 BGR：0x00BBGGRR
            int border = light ? unchecked((int)0x00E6ECEF) : unchecked((int)0x000B0907);
            DwmSetWindowAttribute(Handle, 34 /* DWMWA_BORDER_COLOR */, ref border, sizeof(int));
            // 关键：窗口的「深色窗体」标记要跟主题走。写死成 1 的话，浅色模式下
            // 非客户区（WS_THICKFRAME 留出的那圈边框）会被 DWM 涂成 #202020 深灰，
            // 就是用户看到的「最上端一条黑边」。
            int dark = light ? 0 : 1;
            DwmSetWindowAttribute(Handle, 20 /* DWMWA_USE_IMMERSIVE_DARK_MODE */, ref dark, sizeof(int));
        }
        catch
        {
            // 老系统没有这个属性，忽略
        }
    }

    private void ApplyFramePolish()
    {
        try
        {
            int round = 2; // DWMWCP_ROUND
            DwmSetWindowAttribute(Handle, 33 /* DWMWA_WINDOW_CORNER_PREFERENCE */, ref round, sizeof(int));
            // 0x00BBGGRR：跟着当前主题，别把浅色窗口刷成深色边
            int border = _light ? unchecked((int)0x00E6ECEF) : unchecked((int)0x000B0907);
            DwmSetWindowAttribute(Handle, 34 /* DWMWA_BORDER_COLOR */, ref border, sizeof(int));
            // 深色窗体标记由 ApplyThemeColors 按主题设置，这里只保证圆角和边框
            ApplyThemeColors(_light);
        }
        catch
        {
            // Win10 早期版本没有这些属性，忽略
        }
    }

    protected override void OnDpiChanged(DpiChangedEventArgs e)
    {
        base.OnDpiChanged(e);
        ApplyFramePolish();
    }

    // ---------------------------------------------------------------- P/Invoke

    [StructLayout(LayoutKind.Sequential)]
    private struct POINT { public int X; public int Y; }

    [StructLayout(LayoutKind.Sequential)]
    private struct MINMAXINFO
    {
        public POINT ptReserved;
        public POINT ptMaxSize;
        public POINT ptMaxPosition;
        public POINT ptMinTrackSize;
        public POINT ptMaxTrackSize;
    }

    [DllImport("user32.dll")]
    private static extern int GetSystemMetrics(int index);

    [DllImport("user32.dll")]
    private static extern bool ReleaseCapture();

    [DllImport("user32.dll")]
    private static extern IntPtr SendMessage(IntPtr hWnd, int msg, IntPtr wParam, IntPtr lParam);

    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);
}
