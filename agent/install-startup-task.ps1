[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string]$CredentialPath = $env:GOOGLE_APPLICATION_CREDENTIALS,
    [switch]$StartNow
)

$ErrorActionPreference = 'Stop'
$taskName = 'KUSK Network Agent'
if (-not $CredentialPath -or -not (Test-Path -LiteralPath $CredentialPath -PathType Leaf)) {
    throw 'Set GOOGLE_APPLICATION_CREDENTIALS to a credential file outside the project.'
}

$credentialFile = (Resolve-Path -LiteralPath $CredentialPath).Path
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
if ($credentialFile.StartsWith($projectRoot + '\', [StringComparison]::OrdinalIgnoreCase)) {
    throw 'The credential file must be outside the project.'
}

$nodePath = (Get-Command node -ErrorAction Stop).Source
$nodeVersion = & $nodePath --version
if ([int]($nodeVersion.TrimStart('v').Split('.')[0]) -lt 22) {
    throw 'The Agent requires Node.js 22 or newer.'
}
$launcher = Join-Path $PSScriptRoot 'start-agent.ps1'
$existingTask = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existingTask -and -not ($existingTask.Actions.Arguments -match [regex]::Escape($launcher))) {
    throw 'A different task already uses this name. It has not been changed.'
}

$userId = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$arguments = '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy RemoteSigned ' +
    '-File "' + $launcher + '" -CredentialPath "' + $credentialFile + '" -NodePath "' + $nodePath + '"'
$powershellPath = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
$action = New-ScheduledTaskAction -Execute $powershellPath `
    -Argument $arguments -WorkingDirectory $PSScriptRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $userId
$principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew `
    -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries

if ($PSCmdlet.ShouldProcess($taskName, 'Register Agent startup task for the current user')) {
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
        -Principal $principal -Settings $settings -Force `
        -Description 'Monitor school network switches and publish a heartbeat every minute.' | Out-Null
    if ($StartNow) {
        Start-ScheduledTask -TaskName $taskName
    }
    Write-Output 'Agent task registered. It starts when this user signs in to Windows.'
}
