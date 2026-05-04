param(
  [switch]$SkipBuild,
  [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Test-IsAdministrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$commandParts = @(
  "Set-Location '$repoRoot'"
)

if (-not $SkipBuild) {
  $commandParts += "npm run build"
}

$commandParts += "npx electron-builder --config electron-builder.config.cjs --win"
$commandText = [string]::Join('; ', $commandParts)

if ($DryRun) {
  if (Test-IsAdministrator) {
    Write-Output "elevated"
  }
  else {
    Write-Output "needs-elevation"
  }

  Write-Output $commandText
  exit 0
}

if (-not (Test-IsAdministrator)) {
  $argumentList = @(
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    "`"$PSCommandPath`""
  )

  if ($SkipBuild) {
    $argumentList += "-SkipBuild"
  }

  $process = Start-Process -FilePath "powershell.exe" -Verb RunAs -ArgumentList $argumentList -Wait -PassThru
  exit $process.ExitCode
}

Set-Location $repoRoot

if (-not $SkipBuild) {
  npm run build

  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }
}

npx electron-builder --config electron-builder.config.cjs --win
exit $LASTEXITCODE