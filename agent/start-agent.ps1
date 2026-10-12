[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$CredentialPath,
    [Parameter(Mandatory = $true)]
    [string]$NodePath
)

$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $CredentialPath -PathType Leaf)) {
    throw 'The Agent credential file is missing.'
}
if (-not (Test-Path -LiteralPath $NodePath -PathType Leaf)) {
    throw 'Node.js is missing.'
}

$env:GOOGLE_APPLICATION_CREDENTIALS = $CredentialPath
$logDirectory = Join-Path $PSScriptRoot 'logs'
New-Item -Path $logDirectory -ItemType Directory -Force | Out-Null
$logPath = Join-Path $logDirectory 'agent.log'
if ((Test-Path -LiteralPath $logPath) -and
    (Get-Item -LiteralPath $logPath).Length -gt 10MB) {
    Move-Item -LiteralPath $logPath -Destination (Join-Path $logDirectory 'agent.previous.log') -Force
}

Set-Location -LiteralPath $PSScriptRoot
$ErrorActionPreference = 'Continue'
& $NodePath (Join-Path $PSScriptRoot 'server.js') *>> $logPath
exit $LASTEXITCODE
