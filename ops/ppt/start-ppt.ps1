param(
    [int]$Port = 37623,
    [int]$HealthTimeoutSeconds = 90
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
$appRoot = Join-Path $projectRoot "ppt-app"
$runtimeRoot = Join-Path $projectRoot "data\ppt"
$pidPath = Join-Path $runtimeRoot "ppt-app.pid"
$stdoutPath = Join-Path $runtimeRoot "ppt-app.out.log"
$stderrPath = Join-Path $runtimeRoot "ppt-app.err.log"
$healthUrl = "http://127.0.0.1:$Port/ppt/api/health"

function Test-TcpEndpoint([string]$ComputerName, [int]$TargetPort) {
    $client = [System.Net.Sockets.TcpClient]::new()
    try {
        $task = $client.ConnectAsync($ComputerName, $TargetPort)
        return $task.Wait(2000) -and $client.Connected
    } catch {
        return $false
    } finally {
        $client.Dispose()
    }
}

function Test-PptHealth {
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri $healthUrl -TimeoutSec 3
        return $response.StatusCode -ge 200 -and $response.StatusCode -lt 300
    } catch {
        return $false
    }
}

function Stop-StartedProcess([int]$ProcessId) {
    $descendants = @()
    $frontier = @($ProcessId)
    while ($frontier.Count -gt 0) {
        $parents = $frontier
        $frontier = @()
        foreach ($parentId in $parents) {
            $children = @(Get-CimInstance Win32_Process -Filter ("ParentProcessId = {0}" -f $parentId) -ErrorAction SilentlyContinue)
            foreach ($child in $children) {
                $descendants += [int]$child.ProcessId
                $frontier += [int]$child.ProcessId
            }
        }
    }
    foreach ($id in (@($descendants) + $ProcessId | Select-Object -Unique | Sort-Object -Descending)) {
        Stop-Process -Id $id -Force -ErrorAction SilentlyContinue
    }
}

if (-not (Test-Path (Join-Path $appRoot "package.json") -PathType Leaf)) {
    throw "PPT application was not found at $appRoot."
}

New-Item -ItemType Directory -Force $runtimeRoot | Out-Null


$listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listener) {
    $recordedProcessId = 0
    if (Test-Path $pidPath -PathType Leaf) {
        [void][int]::TryParse((Get-Content $pidPath -Raw).Trim(), [ref]$recordedProcessId)
    }
    $recordedProcess = if ($recordedProcessId -gt 0) {
        Get-CimInstance Win32_Process -Filter ("ProcessId = {0}" -f $recordedProcessId) -ErrorAction SilentlyContinue
    } else { $null }
    if ($recordedProcess -and ([string]$recordedProcess.CommandLine).IndexOf($appRoot, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
        Write-Host "Restarting the managed PPT sidecar..."
        Stop-StartedProcess $recordedProcessId
        Remove-Item $pidPath -Force -ErrorAction SilentlyContinue
        $releaseDeadline = [DateTime]::UtcNow.AddSeconds(5)
        while ([DateTime]::UtcNow -lt $releaseDeadline -and (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)) {
            Start-Sleep -Milliseconds 200
        }
        if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
            throw "The managed PPT sidecar did not release port $Port."
        }
    } elseif (Test-PptHealth) {
        Write-Host "PPT is already available on port $Port."
        exit 0
    } else {
        $owner = Get-CimInstance Win32_Process -Filter ("ProcessId = {0}" -f $listener.OwningProcess) -ErrorAction SilentlyContinue
        $description = if ($owner) { $owner.CommandLine } else { "unknown process" }
        throw "Port $Port is occupied by another or unhealthy process (PID $($listener.OwningProcess)): $description"
    }
}

$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
$npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $nodeCommand -or -not $npmCommand) {
    throw "Node.js and npm are required to start the PPT sidecar."
}

if ([string]::IsNullOrWhiteSpace($env:PPT_DATABASE_URL) -or -not $env:PPT_DATABASE_URL.StartsWith("mysql://")) {
    throw "PPT_DATABASE_URL must point to MySQL 8.0. Configure it before starting PPT."
}
if ([string]::IsNullOrWhiteSpace($env:PPT_INTERNAL_TOKEN)) {
    $env:PPT_INTERNAL_TOKEN = [guid]::NewGuid().ToString("N")
}

$env:DATABASE_URL = $env:PPT_DATABASE_URL
$env:PPT_INTERNAL_URL = if ($env:PPT_LINGDRAW_INTERNAL_URL) { $env:PPT_LINGDRAW_INTERNAL_URL } else { "http://127.0.0.1:37621" }
$env:AUTH_SECRET = if ($env:AUTH_SECRET) { $env:AUTH_SECRET } else { $env:PPT_INTERNAL_TOKEN }
$env:NEXT_TELEMETRY_DISABLED = "1"
$env:PORT = [string]$Port
$env:HOSTNAME = "127.0.0.1"

$storagePath = if ([string]::IsNullOrWhiteSpace($env:PPT_STORAGE_PATH)) {
    Join-Path $runtimeRoot "storage"
} elseif ([System.IO.Path]::IsPathRooted($env:PPT_STORAGE_PATH)) {
    $env:PPT_STORAGE_PATH
} else {
    Join-Path $projectRoot $env:PPT_STORAGE_PATH
}
$storagePath = [System.IO.Path]::GetFullPath($storagePath)
New-Item -ItemType Directory -Force $storagePath | Out-Null
$env:PPT_STORAGE_PATH = $storagePath
$env:LOCAL_STORAGE_PATH = $storagePath
$env:STORAGE_PROVIDER = if ($env:STORAGE_PROVIDER) { $env:STORAGE_PROVIDER } else { "local" }

try {
    $databaseUri = [Uri]$env:PPT_DATABASE_URL
} catch {
    throw "PPT_DATABASE_URL is not a valid MySQL URL."
}
$databaseHost = $databaseUri.Host
$databasePort = if ($databaseUri.Port -gt 0) { $databaseUri.Port } else { 3306 }

if (-not (Test-TcpEndpoint $databaseHost $databasePort)) {
    throw "PPT MySQL is unavailable. Run start-windows.bat or start the configured MySQL 8.0 instance."
}

$nextCli = Join-Path $appRoot "node_modules\next\dist\bin\next"
$packageLockPath = Join-Path $appRoot "package-lock.json"
$dependencyMarkerPath = Join-Path $appRoot "node_modules\.lingdraw-package-lock.sha256"
$packageLockHash = (Get-FileHash $packageLockPath -Algorithm SHA256).Hash
$installedPackageLockHash = if (Test-Path $dependencyMarkerPath -PathType Leaf) {
    (Get-Content $dependencyMarkerPath -Raw).Trim()
} else { "" }
if (-not (Test-Path $nextCli -PathType Leaf) -or $installedPackageLockHash -ne $packageLockHash) {
    Write-Host "Installing PPT dependencies from package-lock.json..."
    & $npmCommand.Source ci --prefix $appRoot
    if ($LASTEXITCODE -ne 0) {
        throw "npm ci failed for the PPT application."
    }
    Set-Content -Path $dependencyMarkerPath -Value $packageLockHash -Encoding ascii
}

Write-Host "Applying PPT database migrations..."
& $npmCommand.Source --prefix $appRoot run db:deploy
if ($LASTEXITCODE -ne 0) {
    throw "PPT database migration failed."
}

Write-Host "Seeding PPT system resources..."
& $npmCommand.Source --prefix $appRoot run db:seed
if ($LASTEXITCODE -ne 0) {
    throw "PPT database seed failed."
}

Write-Host "Building the production PPT application..."
& $npmCommand.Source --prefix $appRoot run db:generate
if ($LASTEXITCODE -ne 0) {
    throw "PPT Prisma client generation failed."
}
& $npmCommand.Source --prefix $appRoot run build
if ($LASTEXITCODE -ne 0) {
    throw "PPT production build failed."
}

$standaloneRoot = Join-Path $appRoot ".next\standalone"
$standaloneServer = Join-Path $standaloneRoot "server.js"
if (-not (Test-Path $standaloneServer -PathType Leaf)) {
    throw "PPT standalone build did not produce $standaloneServer."
}
$publicPath = Join-Path $appRoot "public"
if (Test-Path $publicPath -PathType Container) {
    Copy-Item -Path $publicPath -Destination $standaloneRoot -Recurse -Force
}
$standaloneNextRoot = Join-Path $standaloneRoot ".next"
New-Item -ItemType Directory -Force $standaloneNextRoot | Out-Null
Copy-Item -Path (Join-Path $appRoot ".next\static") -Destination $standaloneNextRoot -Recurse -Force

Remove-Item $stdoutPath, $stderrPath -Force -ErrorAction SilentlyContinue
$env:NODE_ENV = "production"
$quotedStandaloneServer = '"' + $standaloneServer + '"'
$pptProcess = Start-Process -FilePath $nodeCommand.Source `
    -ArgumentList @($quotedStandaloneServer) `
    -WorkingDirectory $standaloneRoot `
    -RedirectStandardOutput $stdoutPath `
    -RedirectStandardError $stderrPath `
    -WindowStyle Hidden `
    -PassThru
Set-Content -Path $pidPath -Value $pptProcess.Id -Encoding ascii

$healthDeadline = [DateTime]::UtcNow.AddSeconds($HealthTimeoutSeconds)
while ([DateTime]::UtcNow -lt $healthDeadline) {
    if ($pptProcess.HasExited) { break }
    if (Test-PptHealth) {
        Write-Host "PPT is ready at http://127.0.0.1:$Port/ppt/projects"
        exit 0
    }
    Start-Sleep -Milliseconds 500
}

Stop-StartedProcess $pptProcess.Id
Remove-Item $pidPath -Force -ErrorAction SilentlyContinue
$recentError = if (Test-Path $stderrPath) { (Get-Content $stderrPath -Tail 20 -ErrorAction SilentlyContinue) -join [Environment]::NewLine } else { "" }
if ($recentError) { Write-Host $recentError }
throw "PPT did not pass its health check within $HealthTimeoutSeconds seconds."
