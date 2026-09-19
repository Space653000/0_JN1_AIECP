using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;

internal static class Program
{
    static int Main(string[] args)
    {
        var arch = RuntimeInformation.OSArchitecture;
        string? payload = arch switch
        {
            Architecture.X64 => "AI-Engineering-Control-Plane-Setup-x64.exe",
            Architecture.Arm64 => "AI-Engineering-Control-Plane-Setup-arm64.exe",
            _ => null
        };
        if (payload is null)
        {
            Console.Error.WriteLine($"Unsupported Windows architecture: {arch}");
            return 2;
        }

        var baseDir = AppContext.BaseDirectory;
        var source = Path.Combine(baseDir, "payloads", payload);
        if (!File.Exists(source))
        {
            Console.Error.WriteLine($"Required installer payload is missing: {payload}");
            return 3;
        }

        var temp = Path.Combine(Path.GetTempPath(), "AECP", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(temp);
        var target = Path.Combine(temp, payload);
        File.Copy(source, target, overwrite: true);

        using var child = Process.Start(new ProcessStartInfo
        {
            FileName = target,
            UseShellExecute = true,
            WorkingDirectory = temp
        });
        if (child is null) return 4;
        child.WaitForExit();
        return child.ExitCode;
    }
}
