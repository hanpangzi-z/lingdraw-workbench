param(
    [int]$Port = 37623,
    [switch]$PidFileOnly
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
$appRoot = Join-Path $projectRoot "ppt-app"
$runtimeRoot = Join-Path $projectRoot "data\ppt"
$pidPath = Join-Path $runtimeRoot "ppt-app.pid"
$targetIds = [System.Collections.Generic.HashSet[int]]::new()



function Add-ProcessTree([int]$RootProcessId) {
    if (-not $targetIds.Add($RootProcessId)) { return }
    $children = @(Get-CimInstance Win32_Process -Filter ("ParentProcessId = {0}" -f $RootProcessId) -ErrorAction SilentlyContinue)
    foreach ($child in $children) {
        Add-ProcessTree ([int]$child.ProcessId)
    }
}

function Test-ManagedPptProcess([int]$ProcessId) {
    $process = Get-CimInstance Win32_Process -Filter ("ProcessId = {0}" -f $ProcessId) -ErrorAction SilentlyContinue
    if (-not $process) { return $false }
    $commandLine = [string]$process.CommandLine
    $isNextProcess = $commandLine -match "next[\\/]dist[\\/]" -or $commandLine -match "\.next[\\/]standalone[\\/]server\.js"
    return $commandLine.IndexOf($appRoot, [StringComparison]::OrdinalIgnoreCase) -ge 0 -and $isNextProcess
}

$rootProcessId = 0
if (Test-Path $pidPath -PathType Leaf) {
    [void][int]::TryParse((Get-Content $pidPath -Raw).Trim(), [ref]$rootProcessId)
}

if ($rootProcessId -gt 0 -and (Test-ManagedPptProcess $rootProcessId)) {
    Add-ProcessTree $rootProcessId
} elseif (-not $PidFileOnly) {
    $listeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
    foreach ($listener in $listeners) {
        if (-not (Test-ManagedPptProcess ([int]$listener.OwningProcess))) {
            throw "Port $Port is used by a process that is not the managed PPT sidecar; nothing was stopped."
        }
        Add-ProcessTree ([int]$listener.OwningProcess)
    }
}

if ($targetIds.Count -gt 0) {
    $orderedIds = @($targetIds) | Sort-Object -Descending
    foreach ($processId in $orderedIds) {
        if (Get-Process -Id $processId -ErrorAction SilentlyContinue) {
            Write-Host "Stopping PPT (PID $processId)..."
            & taskkill.exe /PID $processId /T 2>$null | Out-Null
        }
    }
    $deadline = [DateTime]::UtcNow.AddSeconds(5)
    while ([DateTime]::UtcNow -lt $deadline -and ($orderedIds | Where-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue })) {
        Start-Sleep -Milliseconds 200
    }
    foreach ($processId in $orderedIds) {
        Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
    }
    Write-Host "PPT sidecar stopped."
} elseif (-not $PidFileOnly) {
    Write-Host "PPT is not running on port $Port."
}
Remove-Item $pidPath -Force -ErrorAction SilentlyContinue

# Shared MySQL lifecycle is managed by stop-windows.bat.
