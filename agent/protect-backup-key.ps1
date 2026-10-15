[CmdletBinding(DefaultParameterSetName = 'Protect')]
param(
    [string]$KeyFile = (Join-Path $env:USERPROFILE '.config\kusk-network-manager\backup\backup-key.json'),
    [Parameter(Mandatory = $true, ParameterSetName = 'Protect')][string]$RecoveryDirectory,
    [Parameter(Mandatory = $true, ParameterSetName = 'Recover')][string]$RecoveryFile
)

$ErrorActionPreference = 'Stop'
$node = (Get-Command node -ErrorAction Stop).Source
$recovering = $PSCmdlet.ParameterSetName -eq 'Recover'
if ($recovering) {
    if (Test-Path -LiteralPath $KeyFile) { throw 'The output key file already exists. It has not been overwritten.' }
    $parent = (Resolve-Path -LiteralPath (Split-Path -Parent $KeyFile)).ProviderPath
    $keyPath = Join-Path $parent (Split-Path -Leaf $KeyFile)
    $target = (Resolve-Path -LiteralPath $RecoveryFile).ProviderPath
    $action = 'recover-key'
    Write-Output 'Enter the existing recovery password. The new key must be in a restricted private folder.'
} else {
    $keyPath = (Resolve-Path -LiteralPath $KeyFile).ProviderPath
    $destination = (Resolve-Path -LiteralPath $RecoveryDirectory).ProviderPath
    $keyInfo = Get-Content -LiteralPath $keyPath -Raw | ConvertFrom-Json
    $target = Join-Path $destination ('NetworkManager-recovery-' + $keyInfo.id + '.nmrecovery')
    if (Test-Path -LiteralPath $target) { throw 'A recovery key already exists at this path. It has not been overwritten.' }
    $action = 'seal-key'
    Write-Output 'Set a separate recovery password of at least 16 characters. Do not reuse an account password.'
}
$first = Read-Host 'Recovery password (hidden)' -AsSecureString
$second = Read-Host 'Confirm recovery password (hidden)' -AsSecureString
$firstPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($first)
$secondPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($second)
try {
    $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($firstPointer)
    if ($password -cne [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secondPointer)) { throw 'Passwords do not match.' }
    if ($password.Length -lt 16) { throw 'Recovery password must contain at least 16 characters.' }
    $start = New-Object System.Diagnostics.ProcessStartInfo
    $start.FileName = $node
    $start.Arguments = '"' + (Join-Path $PSScriptRoot 'backup-cli.js') + '" ' + $action + ' --key-file "' + $keyPath + '" --recovery-file "' + $target + '"'
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardInput = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $start
    [void]$process.Start()
    $passwordBytes = [System.Text.Encoding]::UTF8.GetBytes($password)
    try {
        $process.StandardInput.BaseStream.Write($passwordBytes, 0, $passwordBytes.Length)
        $process.StandardInput.BaseStream.Flush()
        $process.StandardInput.Close()
    } finally { [Array]::Clear($passwordBytes, 0, $passwordBytes.Length) }
    $output = $process.StandardOutput.ReadToEnd()
    $errors = $process.StandardError.ReadToEnd()
    $process.WaitForExit()
    if ($process.ExitCode -ne 0) { throw $errors }
    Write-Output $output.Trim()
    if ($recovering) { Write-Output ('Recovered private key: ' + $keyPath) }
    else { Write-Output ('Recovery file: ' + $target) }
} finally {
    $password = $null
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($firstPointer)
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secondPointer)
    $first.Dispose()
    $second.Dispose()
    if ($process) { $process.Dispose() }
}
