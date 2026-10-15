[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$ConfigPath,
    [Parameter(Mandatory = $true)][string]$CredentialPath,
    [Parameter(Mandatory = $true)][string]$NodePath,
    [Alias('DailyTime')][ValidatePattern('^([01][0-9]|2[0-3]):[0-5][0-9]$')][string]$BackupTime = '02:00',
    [ValidateSet(1, 3)][int]$IntervalMonths = 1,
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'backup-schedule.ps1')
$configFile = (Resolve-Path -LiteralPath $ConfigPath).ProviderPath
$stateDirectory = Split-Path -Parent $configFile
$stateFile = Join-Path $stateDirectory 'status.json'
$logFile = Join-Path $stateDirectory 'backup.log'
$lockFile = Join-Path $stateDirectory 'backup.lock'
try {
    $lock = [System.IO.File]::Open($lockFile, 'OpenOrCreate', 'ReadWrite', 'None')
} catch [System.IO.IOException] {
    Write-Error 'Another backup is running or the backup lock is unavailable.'
    exit 1
}
$state = @{}
try {
    if (Test-Path -LiteralPath $stateFile) {
        $previous = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
        foreach ($property in $previous.PSObject.Properties) { $state[$property.Name] = $property.Value }
    }
    $now = Get-Date
    $due = Get-BackupScheduleDue -Now $now -Time $BackupTime -IntervalMonths $IntervalMonths
    if (-not $Force -and $state.lastSuccessfulBackupAt -and
        [datetime]::Parse($state.lastSuccessfulBackupAt).ToUniversalTime() -ge $due.ToUniversalTime() -and
        [datetime]::Parse($state.lastSuccessfulBackupAt).ToUniversalTime() -le $now.ToUniversalTime()) {
        Write-Output 'A verified backup already covers the current backup period.'
        exit 0
    }
    if (-not (Test-Path -LiteralPath $CredentialPath -PathType Leaf) -or -not (Test-Path -LiteralPath $NodePath -PathType Leaf)) {
        throw 'The credential file or Node.js is missing.'
    }
    if ((Test-Path -LiteralPath $logFile) -and (Get-Item -LiteralPath $logFile).Length -gt 10MB) {
        Move-Item -LiteralPath $logFile -Destination (Join-Path $stateDirectory 'backup.previous.log') -Force
    }
    $state.phase = 'running'
    $state.startedAt = (Get-Date).ToUniversalTime().ToString('o')
    $state.lastError = ''
    $state | ConvertTo-Json | Set-Content -LiteralPath $stateFile -Encoding UTF8
    $env:GOOGLE_APPLICATION_CREDENTIALS = $CredentialPath
    Set-Location -LiteralPath $PSScriptRoot
    $ErrorActionPreference = 'Continue'
    ('Backup started: ' + $state.startedAt) | Out-File -LiteralPath $logFile -Append -Encoding UTF8 -ErrorAction Stop
    $output = @(& $NodePath (Join-Path $PSScriptRoot 'backup-cli.js') run --config $configFile 2>&1 | ForEach-Object {
        $line = $_.ToString()
        $line | Out-File -LiteralPath $logFile -Append -Encoding UTF8 -ErrorAction Stop
        $line
    })
    $resultCode = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'
    if ($resultCode -ne 0) { throw 'Backup failed. See the private backup log.' }
    $summary = $output[-1].ToString() | ConvertFrom-Json
    if ($summary.status -ne 'verified') { throw 'Backup did not return a verified result.' }
    $state.phase = 'idle'
    $state.lastSuccessfulBackupAt = (Get-Date).ToUniversalTime().ToString('o')
    $state.snapshot = $summary.filename
    $state.documents = $summary.documents
    $state.objects = $summary.objects
    $state.bytes = $summary.bytes
    $state.copied = $summary.copied
    $state.reused = $summary.reused
    $state.lastError = ''
    $state | ConvertTo-Json | Set-Content -LiteralPath $stateFile -Encoding UTF8
    Write-Output ('Verified backup complete: ' + $summary.filename)
} catch {
    $ErrorActionPreference = 'Stop'
    $state.phase = 'failed'
    $state.lastError = $_.Exception.Message
    $state.lastFailureAt = (Get-Date).ToUniversalTime().ToString('o')
    $state | ConvertTo-Json | Set-Content -LiteralPath $stateFile -Encoding UTF8
    Write-Error $_.Exception.Message
    exit 1
} finally {
    $lock.Dispose()
}
