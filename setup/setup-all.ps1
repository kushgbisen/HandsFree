#Requires -Version 5.1
<#
.SYNOPSIS
  Full HandsFree setup on Windows in one command. Run from inside the clone:
    .\setup\setup-all.ps1
  or bootstrap a bare machine (see SETUP.md).
.EXAMPLE
  .\setup\setup-all.ps1 -TargetDir "$HOME\HandsFree"
#>
param(
  [string]$RepoUrl = 'https://github.com/kushgbisen/HandsFree.git',
  [string]$Branch = 'dev',
  [string]$TargetDir = (Split-Path $PSScriptRoot -Parent)
)
$ErrorActionPreference = 'Stop'

Write-Host 'HandsFree full setup' -ForegroundColor Cyan
Write-Host "  target: $TargetDir"

& (Join-Path $PSScriptRoot '00-install-tools.ps1')
& (Join-Path $PSScriptRoot '01-clone-and-install.ps1') -RepoUrl $RepoUrl -Branch $Branch -TargetDir $TargetDir
& (Join-Path $PSScriptRoot '02-verify.ps1') -RepoDir $TargetDir

Write-Host ''
Write-Host 'Setup complete.' -ForegroundColor Green
Write-Host '  1. Paste your key into ' -NoNewline
Write-Host "$TargetDir\.env" -ForegroundColor Yellow
Write-Host '  2. Load the extension: chrome://extensions -> Developer mode -> Load unpacked'
Write-Host "     folder: $TargetDir\extension"
Write-Host '  3. Click the toolbar icon -> provider + key -> Test -> Save'
Write-Host '  Details: SETUP.md'
