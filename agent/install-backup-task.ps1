[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [Parameter(Mandatory = $true)][string]$BackupRoot,
    [string]$CredentialPath = $env:GOOGLE_APPLICATION_CREDENTIALS,
    [string]$Time = '02:00',
    [ValidateSet(1, 3)][int]$IntervalMonths = 1,
    [switch]$StartNow
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'backup-schedule.ps1')
$taskName = 'KUSK Network Backup'
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$root = (Resolve-Path -LiteralPath $BackupRoot).ProviderPath
$credential = (Resolve-Path -LiteralPath $CredentialPath).ProviderPath
foreach ($candidate in @($root, $credential)) {
    if ($candidate -eq $projectRoot -or $candidate.StartsWith($projectRoot + '\', [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Backup storage and credentials must be outside the project.'
    }
}
if (-not (Test-Path -LiteralPath $root -PathType Container)) { throw 'The school backup folder is not available.' }
if ($Time -notmatch '^([01][0-9]|2[0-3]):[0-5][0-9]$') { throw 'Time must use HH:mm format.' }
$node = (Get-Command node -ErrorAction Stop).Source
if ([int]((& $node --version).TrimStart('v').Split('.')[0]) -lt 22) { throw 'Node.js 22 or newer is required.' }
$launcher = Join-Path $PSScriptRoot 'start-backup.ps1'
$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing -and -not ($existing.Actions.Arguments -match [regex]::Escape($launcher))) {
    throw 'A different task already uses this name. It has not been changed.'
}
$stateDirectory = Join-Path $env:USERPROFILE '.config\kusk-network-manager\backup'
$destination = Join-Path $root 'NetworkManager'
$keyFile = Join-Path $stateDirectory 'backup-key.json'
$configFile = Join-Path $stateDirectory 'config.json'
if ($existing -and $existing.State -eq 'Running') { throw 'Wait for the current backup to finish before changing its schedule.' }
if ($PSCmdlet.ShouldProcess($taskName, 'Create an encrypted backup destination and register a monthly backup task')) {
    New-Item -ItemType Directory -Path $stateDirectory -Force | Out-Null
    $user = [System.Security.Principal.WindowsIdentity]::GetCurrent()
    $allowedSids = @($user.User.Value, 'S-1-5-18')
    $existingAcl = Get-Acl -LiteralPath $stateDirectory
    $unexpected = @($existingAcl.Access | Where-Object {
        $_.AccessControlType -eq 'Allow' -and $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value -notin $allowedSids
    })
    if (-not $existingAcl.AreAccessRulesProtected -or $unexpected.Count) {
        $acl = New-Object System.Security.AccessControl.DirectorySecurity
        $acl.SetAccessRuleProtection($true, $false)
        foreach ($sid in @($user.User, [System.Security.Principal.SecurityIdentifier]'S-1-5-18')) {
            $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
            $acl.AddAccessRule($rule)
        }
        Set-Acl -LiteralPath $stateDirectory -AclObject $acl
    }
    New-Item -ItemType Directory -Path $destination -Force | Out-Null
    if (-not (Test-Path -LiteralPath $keyFile)) {
        & $node (Join-Path $PSScriptRoot 'backup-cli.js') init-key --key-file $keyFile
        if ($LASTEXITCODE -ne 0) { throw 'Unable to create the backup recovery key.' }
    }
    @{ projectId = 'kusk-network-manager'; bucket = 'kusk-network-manager.firebasestorage.app';
        destination = $destination; keyFile = $keyFile } | ConvertTo-Json |
        Set-Content -LiteralPath $configFile -Encoding UTF8
    $arguments = '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy RemoteSigned -File "' + $launcher +
        '" -ConfigPath "' + $configFile + '" -CredentialPath "' + $credential + '" -NodePath "' + $node + '" -BackupTime "' + $Time + '" -IntervalMonths ' + $IntervalMonths
    $definition = New-BackupTaskXml -Execute (Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe') `
        -Arguments $arguments -WorkingDirectory $PSScriptRoot -UserId $user.Name -Time $Time -IntervalMonths $IntervalMonths
    Register-ScheduledTask -TaskName $taskName -Xml $definition -Force | Out-Null
    if ($StartNow) { Start-ScheduledTask -TaskName $taskName }
    Write-Output ('Backup task registered on day 1 every ' + $IntervalMonths + ' month(s) at ' + $Time + ' local time, with sign-in catch-up. Destination: ' + $destination)
}
