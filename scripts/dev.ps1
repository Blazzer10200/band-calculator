param(
  [ValidateSet('status','start','restart')][string]$Action = 'status',
  [switch]$Sample,
  [ValidateRange(4174,4199)][int]$SamplePort = 4174
)
$ErrorActionPreference = 'Stop'
$ptoRoot = Split-Path $PSScriptRoot -Parent
$ptoPort = if ($Sample) { $SamplePort } else { 4173 }
$ptoEntry = if ($Sample) { Join-Path $PSScriptRoot 'sample-server.mjs' } else { Join-Path $ptoRoot 'server.mjs' }
$ptoUrl = "http://127.0.0.1:$ptoPort/"
$ptoLabel = if ($Sample) { 'Sample data (memory only)' } else { 'Local database' }
$ptoLogRoot = Join-Path $ptoRoot '.local'
$ptoPidFile = Join-Path $ptoLogRoot "dev-$ptoPort.json"
$ptoOut = Join-Path $ptoLogRoot "dev-$ptoPort.out.log"
$ptoErr = Join-Path $ptoLogRoot "dev-$ptoPort.err.log"

function Get-PtoListener {
  $connection = Get-NetTCPConnection -LocalPort $ptoPort -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($connection) { return Get-CimInstance Win32_Process -Filter "ProcessId = $($connection.OwningProcess)" }
}
function Get-PtoHealth {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri ($ptoUrl + 'api/session') -TimeoutSec 3
    $session = $response.Content | ConvertFrom-Json
    return ($response.StatusCode -eq 200 -and $session.development -eq $true)
  } catch { return $false }
}
function Test-PtoOwned($process) {
  if (!(Test-Path -LiteralPath $ptoPidFile)) { return $false }
  $record = Get-Content -LiteralPath $ptoPidFile -Raw | ConvertFrom-Json
  return ($record.pid -eq $process.ProcessId -and $record.entry -eq $ptoEntry -and
    $record.created -eq $process.CreationDate.ToUniversalTime().ToString('o') -and
    $process.CommandLine.Contains('"' + $ptoEntry + '"'))
}

$ptoExisting = Get-PtoListener
if ($ptoExisting) {
  $healthy = Get-PtoHealth
  $owned = Test-PtoOwned $ptoExisting
  if ($Action -eq 'restart') {
    if (!$owned) { throw "Port $ptoPort belongs to an existing process not started by this launcher. Inspect PID $($ptoExisting.ProcessId) before restarting it." }
    Stop-Process -Id $ptoExisting.ProcessId
    for ($attempt=0; $attempt -lt 30 -and (Get-PtoListener); $attempt++) { Start-Sleep -Milliseconds 100 }
    if (Get-PtoListener) { throw "Port $ptoPort is still occupied; no replacement started." }
  } else {
    [pscustomobject]@{ Preview=$ptoLabel; URL=$ptoUrl; PID=$ptoExisting.ProcessId; Healthy=$healthy; Managed=$owned; Result='Reused existing listener'; Log=if($owned){$ptoOut}else{'Started outside this launcher'} } | Format-List
    if (!$healthy) { throw "Port $ptoPort is occupied but the Band Calculator session endpoint is not healthy. No additional process started." }
    exit 0
  }
} elseif ($Action -eq 'status') {
  [pscustomobject]@{ Preview=$ptoLabel; URL=$ptoUrl; Result='Stopped' } | Format-List
  exit 0
}

if (!(Test-Path -LiteralPath $ptoLogRoot)) { New-Item -ItemType Directory -Path $ptoLogRoot | Out-Null }
$ptoNode = (Get-Command node -ErrorAction Stop).Source
$ptoArguments = '"' + $ptoEntry + '"' + $(if ($Sample) { " --port=$ptoPort" } else { '' })
$ptoStarted = Start-Process -FilePath $ptoNode -ArgumentList $ptoArguments -WorkingDirectory $ptoRoot -WindowStyle Hidden -RedirectStandardOutput $ptoOut -RedirectStandardError $ptoErr -PassThru
$ptoProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $($ptoStarted.Id)"
@{pid=$ptoStarted.Id;entry=$ptoEntry;created=$ptoProcess.CreationDate.ToUniversalTime().ToString('o')} | ConvertTo-Json | Set-Content -LiteralPath $ptoPidFile -Encoding UTF8
for ($attempt=0; $attempt -lt 40; $attempt++) {
  if ($ptoStarted.HasExited) { throw "Preview exited. Read $ptoErr" }
  if (Get-PtoHealth) {
    $listener = Get-PtoListener
    if ($listener.ProcessId -ne $ptoStarted.Id) { throw "A different process claimed port $ptoPort. Inspect the listener; no process was stopped." }
    [pscustomobject]@{ Preview=$ptoLabel; URL=$ptoUrl; PID=$ptoStarted.Id; Healthy=$true; Managed=$true; Result='Started'; Log=$ptoOut } | Format-List
    exit 0
  }
  Start-Sleep -Milliseconds 150
}
throw "Preview did not become ready. Read $ptoErr"
