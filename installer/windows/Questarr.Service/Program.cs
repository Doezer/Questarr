using System.Diagnostics;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

// Minimal Windows service host for Questarr: it does not run any application
// logic itself. It just supervises `node dist/server/index.js` as a child
// process (the same entrypoint `npm start` uses), pipes its stdout/stderr to
// a log file under %ProgramData%\Questarr\logs, and stops it cleanly when the
// service is stopped. See installer/windows/README.txt for the on-disk layout.
await Host.CreateDefaultBuilder(args)
    .UseWindowsService(options => { options.ServiceName = "Questarr"; })
    .ConfigureServices(services => { services.AddHostedService<QuestarrWorker>(); })
    .Build()
    .RunAsync();

internal sealed class QuestarrWorker : BackgroundService
{
    private readonly ILogger<QuestarrWorker> logger;
    private Process? questarrProcess;

    public QuestarrWorker(ILogger<QuestarrWorker> logger)
    {
        this.logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // installDir is where the installer places the app payload (dist/,
        // migrations/, node_modules/, bin/node.exe, this .exe, ...). It is
        // used as the Node process's working directory so relative paths the
        // app already resolves from process.cwd() (package.json, migrations/,
        // the SSL file-browser root) behave the same as they do under
        // `npm start` or the Docker image's /app.
        var installDir = AppContext.BaseDirectory;

        // Questarr keeps its persistent state under %ProgramData%\Questarr so
        // it survives an uninstall/reinstall (installDir itself is removed on
        // uninstall). The installer creates {app}\data as an NTFS directory
        // junction pointing at programDataDir\data, so the app's own
        // cwd-relative "data/config.yaml" lookup (see server/config-loader.ts)
        // transparently lands in ProgramData too - mirroring how the Docker
        // image bind-mounts ./data to /app/data. dataDir below is the
        // ProgramData-side target of that junction.
        var programDataDir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
            "Questarr"
        );
        var dataDir = Path.Combine(programDataDir, "data");
        var logsDir = Path.Combine(programDataDir, "logs");
        var logPath = Path.Combine(logsDir, "questarr.log");
        var configPath = Path.Combine(programDataDir, "config.env");

        // Defense in depth: the installer already creates these directories
        // (and the {app}\data junction) at install time, but recreate them
        // here too in case ProgramData was cleared out from under a running
        // install.
        Directory.CreateDirectory(dataDir);
        Directory.CreateDirectory(logsDir);
        var configValues = ReadConfigFile(configPath);

        var nodeExe = Path.Combine(installDir, "bin", "node.exe");
        if (!File.Exists(nodeExe))
        {
            nodeExe = "node";
        }

        var serverScript = Path.Combine(installDir, "dist", "server", "index.js");
        if (!File.Exists(serverScript))
        {
            throw new FileNotFoundException("Questarr server entrypoint was not found.", serverScript);
        }

        var processStartInfo = new ProcessStartInfo
        {
            FileName = nodeExe,
            WorkingDirectory = installDir,
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true,
        };
        processStartInfo.ArgumentList.Add(serverScript);
        foreach (var (key, value) in configValues)
        {
            if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable(key)))
            {
                processStartInfo.Environment[key] = value;
            }
        }

        processStartInfo.Environment["NODE_ENV"] = "production";
        processStartInfo.Environment["PORT"] = GetEnvironmentValue("PORT", configValues, "5000");

        // Questarr only reads SQLITE_DB_PATH (there is no QUESTARR_DATA_DIR
        // env var in this app - see server/config.ts / server/db.ts), so
        // point it explicitly at the ProgramData-backed data directory
        // through the {app}\data junction, the same way the Docker image
        // sets SQLITE_DB_PATH=/app/data/sqlite.db.
        processStartInfo.Environment["SQLITE_DB_PATH"] = GetEnvironmentValue(
            "SQLITE_DB_PATH",
            configValues,
            Path.Combine(installDir, "data", "sqlite.db")
        );

        await using var logStream = new FileStream(
            logPath,
            FileMode.Append,
            FileAccess.Write,
            FileShare.ReadWrite
        );
        await using var logWriter = new StreamWriter(logStream) { AutoFlush = true };

        questarrProcess = new Process
        {
            StartInfo = processStartInfo,
            EnableRaisingEvents = true,
        };

        questarrProcess.OutputDataReceived += (_, eventArgs) => WriteProcessLog(logWriter, eventArgs.Data);
        questarrProcess.ErrorDataReceived += (_, eventArgs) => WriteProcessLog(logWriter, eventArgs.Data);

        logger.LogInformation("Starting Questarr from {InstallDir}", installDir);
        questarrProcess.Start();
        questarrProcess.BeginOutputReadLine();
        questarrProcess.BeginErrorReadLine();

        try
        {
            await questarrProcess.WaitForExitAsync(stoppingToken);
            if (!stoppingToken.IsCancellationRequested && questarrProcess.ExitCode != 0)
            {
                throw new InvalidOperationException(
                    $"Questarr exited unexpectedly with code {questarrProcess.ExitCode}."
                );
            }
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            StopQuestarrProcess();
        }
    }

    public override Task StopAsync(CancellationToken cancellationToken)
    {
        StopQuestarrProcess();
        return base.StopAsync(cancellationToken);
    }

    private static string GetEnvironmentValue(
        string name,
        IReadOnlyDictionary<string, string> configValues,
        string fallback
    )
    {
        var value = Environment.GetEnvironmentVariable(name);
        if (string.IsNullOrWhiteSpace(value) && configValues.TryGetValue(name, out var configValue))
        {
            value = configValue;
        }

        return string.IsNullOrWhiteSpace(value) ? fallback : value;
    }

    private static IReadOnlyDictionary<string, string> ReadConfigFile(string path)
    {
        var values = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        if (!File.Exists(path))
        {
            return values;
        }

        foreach (var rawLine in File.ReadAllLines(path))
        {
            var line = rawLine.Trim();
            if (line.Length == 0 || line.StartsWith("#", StringComparison.Ordinal))
            {
                continue;
            }

            var separatorIndex = line.IndexOf('=');
            if (separatorIndex <= 0)
            {
                continue;
            }

            var key = line[..separatorIndex].Trim();
            var value = line[(separatorIndex + 1)..].Trim().Trim('"');
            if (key.Length > 0)
            {
                values[key] = value;
            }
        }

        return values;
    }

    private static void WriteProcessLog(TextWriter writer, string? line)
    {
        if (line is null)
        {
            return;
        }

        lock (writer)
        {
            writer.WriteLine(line);
        }
    }

    private void StopQuestarrProcess()
    {
        if (questarrProcess is null || questarrProcess.HasExited)
        {
            return;
        }

        try
        {
            logger.LogInformation("Stopping Questarr process");
            questarrProcess.Kill(entireProcessTree: true);
            questarrProcess.WaitForExit(30000);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Failed to stop Questarr cleanly");
        }
    }
}
