using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;

internal static class Program
{
    static int Main()
    {
        var payload = RuntimeInformation.OSArchitecture switch
        {
            Architecture.X64 => "AI-Engineering-Control-Plane-Setup-x64.exe",
            Architecture.Arm64 => "AI-Engineering-Control-Plane-Setup-arm64.exe",
            _ => null
        };
        if (payload is null) { Console.Error.WriteLine("Unsupported Windows architecture."); return 2; }

        var resource = Assembly.GetExecutingAssembly().GetManifestResourceNames();
        var name = Array.Find(resource, x => x.EndsWith(payload, StringComparison.OrdinalIgnoreCase));
        if (name is null) { Console.Error.WriteLine("Installer payload is missing."); return 3; }

        var temp = Path.Combine(Path.GetTempPath(), "AECP", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(temp);
        var target = Path.Combine(temp, payload);
        using (var input = Assembly.GetExecutingAssembly().GetManifestResourceStream(name)!)
        using (var output = File.Create(target)) input.CopyTo(output);

        var forwardedArgs = Environment.GetEnvironmentVariable("AECP_BOOTSTRAP_INSTALL_ARGS") ?? string.Empty;
        using var child = Process.Start(new ProcessStartInfo {
            FileName = target,
            Arguments = forwardedArgs,
            UseShellExecute = true,
            WorkingDirectory = temp
        });
        if (child is null) return 4;
        child.WaitForExit();
        return child.ExitCode;
    }
}
