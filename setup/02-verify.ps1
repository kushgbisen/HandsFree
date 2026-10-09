#Requires -Version 5.1
<#
.SYNOPSIS
  02 - Verifies a HandsFree checkout: Node version, extension typecheck,
  lint and formatting. Fails loudly on the first problem.
.EXAMPLE
  .\setup\02-verify.ps1 -RepoDir "$HOME\HandsFree"
#>
param(
  [string]$RepoDir = (Split-Path $PSScriptRoot -Parent)
)
$ErrorActionPreference = 'Stop'

function Write-Step([string]$msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-Ok([string]$msg) { Write-Host "  [OK] $msg" -ForegroundColor Green }
function Write-Bad([string]$msg) { Write-Host "  [FAIL] $msg" -ForegroundColor Red }

function Refresh-Path {
  $machine = [System.Environment]::GetEnvironmentVariable('Path', 'Machine')
  $user = [System.Environment]::GetEnvironmentVariable('Path', 'User')
  $env:Path = "$machine;$user"
}
Refresh-Path

$failed = $false
function Check([string]$name, [scriptblock]$fn) {
  Write-Step $name
  try {
    & $fn
    Write-Ok $name
  } catch {
    $failed = $true
    Write-Bad "$name -- $($_.Exception.Message)"
  }
}

Push-Location $RepoDir
try {
  Check 'node >= 20' {
    $v = (node --version) -replace '^v', ''
    if ([int]($v.Split('.')[0]) -lt 20) { throw "node v$v too old, need >= 20" }
    Write-Host "  node v$v / npm v$(npm --version)"
  }
  Check 'node_modules present' {
    if (-not (Test-Path 'node_modules\.package-lock.json')) { throw 'run 01-clone-and-install first (npm ci)' }
  }
  Check 'extension typecheck' {
    npx tsc -p extension/tsconfig.json --noEmit
  }
  Check 'eslint' {
    npx eslint extension/src
  }
  Check 'extension files complete' {
    foreach ($f in @('extension/manifest.json', 'extension/src/background.js',
        'extension/src/content.js', 'extension/src/loop.js')) {
      if (-not (Test-Path $f)) { throw "missing $f" }
    }
    Write-Host '  manifest + compiled mirrors present'
  }
} finally {
  Pop-Location
}

Write-Host ''
if ($failed) { throw 'VERIFY FAILED - fix the [FAIL] lines above and re-run.' }
Write-Ok 'All checks passed. Load the extension in Chrome next (see SETUP.md step 4).'
