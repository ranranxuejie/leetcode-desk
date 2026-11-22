// LeetCode 训练台 · 安装程序
//
// 一个自解压安装包：本 exe 里嵌了 payload.zip（launcher + app/dist + node 运行时），
// 运行后解压到 %LOCALAPPDATA%\Programs\LeetCode训练台，创建桌面/开始菜单快捷方式，
// 并写入「应用和功能」里的卸载项。不需要管理员权限，卸载时默认保留学习进度。
//
// 用法：
//   Setup.exe              安装（有界面）
//   Setup.exe /uninstall   卸载
//   Setup.exe /silent      静默安装（不弹界面，用于批量部署）

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Windows.Forms;
using Microsoft.Win32;

internal static class Installer
{
    private const string AppName = "LeetCode训练台";
    private const string DisplayName = "LeetCode 训练台";
    private const string Version = "1.0.0";
    private const string UninstallKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\LeetCodeTrainingDesk";
    private const string PayloadResource = "payload.zip";

    internal static string InstallDir
    {
        get
        {
            return Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "Programs", AppName);
        }
    }

    internal static string ExePath
    {
        get { return Path.Combine(InstallDir, "launcher", "LeetCode训练台.exe"); }
    }

    private static bool _silent;

    [STAThread]
    private static void Main(string[] args)
    {
        _silent = Array.IndexOf(args, "/silent") >= 0 || Array.IndexOf(args, "-s") >= 0;
        bool uninstall = Array.IndexOf(args, "/uninstall") >= 0;

        try { SetProcessDPIAware(); } catch { }
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);

        if (uninstall)
        {
            Application.Run(new UninstallForm());
            return;
        }
        if (_silent)
        {
            try
            {
                Install(null);
            }
            catch (Exception error)
            {
                // 静默安装不能弹模态框（会把自动化/无界面安装卡住），写日志就好
                try
                {
                    string logDir = Path.Combine(
                        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "LeetCode训练台");
                    Directory.CreateDirectory(logDir);
                    File.WriteAllText(Path.Combine(logDir, "install-error.log"),
                        DateTime.Now.ToString("s") + "  " + error.ToString());
                }
                catch { }
            }
            return;
        }
        Application.Run(new InstallForm());
    }

    [System.Runtime.InteropServices.DllImport("user32.dll")]
    private static extern bool SetProcessDPIAware();

    // ---------------------------------------------------------------- 安装 / 卸载逻辑

    internal static void Install(Action<int, string> progress)
    {
        if (progress != null) progress(0, "准备安装…");
        // 覆盖安装时先关掉正在跑的实例：不然 exe / node 被占用，解压会失败
        KillRunning();
        Directory.CreateDirectory(InstallDir);

        if (progress != null) progress(5, "解压文件…");
        ExtractPayload(InstallDir, percent => { if (progress != null) progress(5 + percent * 8 / 10, "解压文件…"); });

        if (progress != null) progress(88, "创建快捷方式…");
        CreateShortcuts();

        if (progress != null) progress(94, "写入卸载信息…");
        WriteUninstallEntry();

        if (progress != null) progress(100, "安装完成");
    }

    private static void ExtractPayload(string target, Action<int> onPercent)
    {
        Assembly assembly = Assembly.GetExecutingAssembly();
        using (Stream stream = assembly.GetManifestResourceStream(PayloadResource))
        {
            if (stream == null) throw new InvalidOperationException("安装包损坏：找不到内嵌数据");
            using (var archive = new ZipArchive(stream, ZipArchiveMode.Read))
            {
                int total = archive.Entries.Count;
                int index = 0;
                foreach (ZipArchiveEntry entry in archive.Entries)
                {
                    index += 1;
                    string destination = Path.GetFullPath(Path.Combine(target, entry.FullName));
                    if (!destination.StartsWith(Path.GetFullPath(target), StringComparison.OrdinalIgnoreCase))
                    {
                        continue; // 防目录穿越
                    }
                    if (string.IsNullOrEmpty(entry.Name))
                    {
                        Directory.CreateDirectory(destination);
                    }
                    else
                    {
                        Directory.CreateDirectory(Path.GetDirectoryName(destination));
                        entry.ExtractToFile(destination, true);
                    }
                    if (onPercent != null && index % 20 == 0)
                    {
                        onPercent(index * 100 / Math.Max(1, total));
                    }
                }
            }
        }
    }

    private static void CreateShortcuts()
    {
        string desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
        string startMenu = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            @"Microsoft\Windows\Start Menu\Programs");
        TryCreateShortcut(Path.Combine(desktop, DisplayName + ".lnk"));
        TryCreateShortcut(Path.Combine(startMenu, DisplayName + ".lnk"));
    }

    private static void TryCreateShortcut(string linkPath)
    {
        try
        {
            object shell = Activator.CreateInstance(Type.GetTypeFromProgID("WScript.Shell"));
            dynamic shortcut = shell.GetType().InvokeMember(
                "CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { linkPath });
            shortcut.TargetPath = ExePath;
            shortcut.WorkingDirectory = InstallDir;
            shortcut.IconLocation = ExePath + ",0";
            shortcut.Description = DisplayName;
            shortcut.Save();
        }
        catch
        {
            // 快捷方式失败不影响主功能
        }
    }

    private static void WriteUninstallEntry()
    {
        try
        {
            using (RegistryKey key = Registry.CurrentUser.CreateSubKey(UninstallKey))
            {
                if (key == null) return;
                key.SetValue("DisplayName", DisplayName);
                key.SetValue("DisplayVersion", Version);
                key.SetValue("Publisher", "本地构建");
                key.SetValue("InstallLocation", InstallDir);
                key.SetValue("DisplayIcon", ExePath + ",0");
                key.SetValue("UninstallString", "\"" + Application.ExecutablePath + "\" /uninstall");
                key.SetValue("NoModify", 1, RegistryValueKind.DWord);
                key.SetValue("NoRepair", 1, RegistryValueKind.DWord);
                key.SetValue("EstimatedSize", EstimateSizeKb(), RegistryValueKind.DWord);
            }
        }
        catch
        {
            // 注册表写不进去就只影响「应用和功能」里的显示
        }
    }

    private static int EstimateSizeKb()
    {
        try
        {
            long total = 0;
            foreach (string file in Directory.GetFiles(InstallDir, "*", SearchOption.AllDirectories))
            {
                total += new FileInfo(file).Length;
            }
            return (int)(total / 1024);
        }
        catch
        {
            return 0;
        }
    }

    /// <summary>关掉正在运行的训练台（含它拉起来的 node 服务）。</summary>
    private static void KillRunning()
    {
        foreach (Process process in Process.GetProcessesByName("LeetCode训练台"))
        {
            try { process.Kill(); process.WaitForExit(3000); } catch { }
        }
        foreach (Process process in Process.GetProcessesByName("node"))
        {
            try
            {
                string path = process.MainModule == null ? "" : process.MainModule.FileName;
                if (path != null && path.StartsWith(InstallDir, StringComparison.OrdinalIgnoreCase))
                {
                    process.Kill();
                    process.WaitForExit(3000);
                }
            }
            catch { }
        }
        System.Threading.Thread.Sleep(400);
    }

    internal static void Uninstall()
    {
        // 先关掉正在跑的实例
        foreach (Process process in Process.GetProcessesByName("LeetCode训练台"))
        {
            try { process.Kill(); process.WaitForExit(3000); } catch { }
        }

        string desktop = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), DisplayName + ".lnk");
        string startMenu = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            @"Microsoft\Windows\Start Menu\Programs", DisplayName + ".lnk");
        TryDeleteFile(desktop);
        TryDeleteFile(startMenu);

        try { Registry.CurrentUser.DeleteSubKeyTree(UninstallKey, false); } catch { }

        try
        {
            if (Directory.Exists(InstallDir)) Directory.Delete(InstallDir, true);
        }
        catch
        {
            // 有文件被占用（比如刚关掉的窗口还没释放），让用户手动删
        }
    }

    private static void TryDeleteFile(string path)
    {
        try { if (File.Exists(path)) File.Delete(path); } catch { }
    }
}

/// <summary>安装界面：深色，和主应用一个气质。</summary>
internal sealed class InstallForm : Form
{
    private readonly Label _status;
    private readonly ProgressBar _bar;
    private readonly Button _action;
    private readonly Label _path;
    private bool _done;

    public InstallForm()
    {
        Text = "安装 LeetCode 训练台";
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = false;
        StartPosition = FormStartPosition.CenterScreen;
        ClientSize = new Size(460, 250);
        BackColor = Color.FromArgb(10, 12, 15);
        ForeColor = Color.FromArgb(233, 237, 242);
        Font = new Font("Microsoft YaHei UI", 9f);

        var title = new Label
        {
            Text = "LeetCode 训练台",
            Font = new Font("Microsoft YaHei UI", 15f, FontStyle.Bold),
            ForeColor = Color.FromArgb(245, 165, 36),
            AutoSize = true,
            Location = new Point(24, 22),
        };
        var subtitle = new Label
        {
            Text = "本地题库 + 代码练习 + AI 精讲，全部离线可用。",
            ForeColor = Color.FromArgb(163, 173, 185),
            AutoSize = true,
            Location = new Point(26, 60),
        };
        _path = new Label
        {
            Text = "安装到：" + Installer.InstallDir,
            ForeColor = Color.FromArgb(125, 136, 148),
            AutoSize = false,
            Size = new Size(410, 34),
            Location = new Point(26, 86),
        };
        _status = new Label
        {
            Text = "点「开始安装」写入文件并创建快捷方式。不需要管理员权限。",
            ForeColor = Color.FromArgb(163, 173, 185),
            AutoSize = false,
            Size = new Size(410, 20),
            Location = new Point(26, 122),
        };
        _bar = new ProgressBar
        {
            Location = new Point(26, 148),
            Size = new Size(408, 6),
            Style = ProgressBarStyle.Continuous,
        };
        _action = new Button
        {
            Text = "开始安装",
            Size = new Size(120, 34),
            Location = new Point(314, 190),
            FlatStyle = FlatStyle.Flat,
            BackColor = Color.FromArgb(245, 165, 36),
            ForeColor = Color.FromArgb(26, 18, 6),
        };
        _action.FlatAppearance.BorderSize = 0;
        _action.Click += (s, e) => OnAction();

        Controls.Add(title);
        Controls.Add(subtitle);
        Controls.Add(_path);
        Controls.Add(_status);
        Controls.Add(_bar);
        Controls.Add(_action);
    }

    private void OnAction()
    {
        if (_done)
        {
            try { Process.Start(new ProcessStartInfo { FileName = Installer.ExePath, UseShellExecute = true }); } catch { }
            Close();
            return;
        }

        _action.Enabled = false;
        _action.Text = "安装中…";
        var worker = new System.ComponentModel.BackgroundWorker();
        worker.DoWork += (s, e) =>
        {
            Installer.Install((percent, message) =>
            {
                BeginInvoke(new Action(() =>
                {
                    _bar.Value = Math.Max(0, Math.Min(100, percent));
                    _status.Text = message;
                }));
            });
        };
        worker.RunWorkerCompleted += (s, e) =>
        {
            _action.Enabled = true;
            if (e.Error != null)
            {
                _status.Text = "安装失败：" + e.Error.Message;
                _action.Text = "重试";
                return;
            }
            _bar.Value = 100;
            _status.Text = "安装完成，桌面和开始菜单都放好了快捷方式。";
            _action.Text = "启动训练台";
            _done = true;
        };
        worker.RunWorkerAsync();
    }
}

/// <summary>卸载界面：默认保留学习进度。</summary>
internal sealed class UninstallForm : Form
{
    public UninstallForm()
    {
        Text = "卸载 LeetCode 训练台";
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = false;
        StartPosition = FormStartPosition.CenterScreen;
        ClientSize = new Size(460, 210);
        BackColor = Color.FromArgb(10, 12, 15);
        ForeColor = Color.FromArgb(233, 237, 242);
        Font = new Font("Microsoft YaHei UI", 9f);

        var title = new Label
        {
            Text = "卸载 LeetCode 训练台",
            Font = new Font("Microsoft YaHei UI", 13f, FontStyle.Bold),
            ForeColor = Color.FromArgb(245, 165, 36),
            AutoSize = true,
            Location = new Point(24, 22),
        };
        var body = new Label
        {
            Text = "会删除程序文件和快捷方式。\n\n学习进度存在浏览器数据里，默认保留 —— 重新安装后进度还在。",
            ForeColor = Color.FromArgb(163, 173, 185),
            AutoSize = false,
            Size = new Size(410, 80),
            Location = new Point(26, 60),
        };
        var keep = new CheckBox
        {
            Text = "同时删除学习进度（不可恢复）",
            ForeColor = Color.FromArgb(163, 173, 185),
            Location = new Point(26, 136),
            AutoSize = true,
        };
        var remove = new Button
        {
            Text = "卸载",
            Size = new Size(100, 32),
            Location = new Point(334, 164),
            FlatStyle = FlatStyle.Flat,
            BackColor = Color.FromArgb(192, 57, 43),
            ForeColor = Color.White,
        };
        remove.FlatAppearance.BorderSize = 0;
        remove.Click += (s, e) =>
        {
            try
            {
                Installer.Uninstall();
                if (keep.Checked)
                {
                    string data = Path.Combine(
                        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "LeetCode训练台");
                    if (Directory.Exists(data)) Directory.Delete(data, true);
                }
            }
            catch { }
            Close();
        };
        var cancel = new Button
        {
            Text = "取消",
            Size = new Size(80, 32),
            Location = new Point(242, 164),
            FlatStyle = FlatStyle.Flat,
            BackColor = Color.FromArgb(23, 28, 34),
            ForeColor = Color.FromArgb(233, 237, 242),
        };
        cancel.FlatAppearance.BorderColor = Color.FromArgb(43, 51, 61);
        cancel.Click += (s, e) => Close();

        Controls.Add(title);
        Controls.Add(body);
        Controls.Add(keep);
        Controls.Add(cancel);
        Controls.Add(remove);
    }
}
