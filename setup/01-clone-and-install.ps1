#Requires -Version 5.1
<#
.SYNOPSIS
  01 - Clones HandsFree (or updates an existing clone), installs npm deps,
  and creates .env from .env.example when missing.
.EXAMPLE
  .\setup\01-clone-and-install.ps1 -TargetDir "$HOME\HandsFree"
#>
param(
  [string]$RepoUrl = 'https://github.com/kushgbisen/HandsFree.git',
  [string]$Branch = 'dev',
  [string]$TargetDir = "$HOME\HandsFree"
)
$ErrorActionPreference = 'Stop'

function Write-Step([string]$msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-Ok([string]$msg) { Write-Host "  [OK] $msg" -ForegroundColor Green }

function Refresh-Path {
  $machine = [System.Environment]::GetEnvironmentVariable('Path', 'Machine')
  $user = [System.Environment]::GetEnvironmentVariable('Path', 'User')
  $env:Path = "$machine;$user"
}
Refresh-Path

if ($null -eq (Get-Command git -ErrorAction SilentlyContinue)) {
  throw 'git not found. Run setup\00-install-tools.ps1 first (or open a NEW terminal).'
}
if ($null -eq (Get-Command node -ErrorAction SilentlyContinue)) {
  throw 'node not found. Run setup\00-install-tools.ps1 first (or open a NEW terminal).'
}

# --- 1. Clone or update ---
Write-Step "Repo -> $TargetDir"
if ((Test-Path (Join-Path $TargetDir '.git')) -and (Test-Path (Join-Path $TargetDir '.git\HEAD'))) {
  Write-Host "  Existing clone found, pulling latest $Branch..."
  git -C $TargetDir fetch origin
  git -C $TargetDir checkout $Branch
  git -C $TargetDir pull --ff-only origin $Branch
  Write-Ok "updated $(git -C $TargetDir rev-parse --short HEAD)"
} elseif ((Test-Path $TargetDir) -and ((Get-ChildItem $TargetDir -Force | Measure-Object).Count -gt 0)) {
  throw "Target $TargetDir exists and is not empty (and not a git clone). Pick another -TargetDir."
} else {
  git clone -b $Branch $RepoUrl $TargetDir
  Write-Ok "cloned branch $Branch"
}

# --- 2. npm deps (clean, reproducible) ---
Write-Step 'npm dependencies (npm ci)'
Push-Location $TargetDir
try {
  npm ci
  Write-Ok 'node_modules installed (husky hooks included)'
} finally {
  Pop-Location
}

# --- 3. .env ---
Write-Step '.env'
$envFile = Join-Path $TargetDir '.env'
if (Test-Path $envFile) {
  Write-Host '  .env already exists, leaving it alone.'
} else {
  Copy-Item (Join-Path $TargetDir '.env.example') $envFile
  Write-Host '  Created .env from .env.example.'
}
Write-Host ''
Write-Host '  NEXT: edit .env and paste your key:' -ForegroundColor Yellow
Write-Host '    AISTUDIO_API_KEY=...   (free key: https://aistudio.google.com/app/apikey)'
Write-Host "    File: $envFile"
