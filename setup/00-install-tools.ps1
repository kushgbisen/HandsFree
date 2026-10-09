#Requires -Version 5.1
<#
.SYNOPSIS
  00 - Installs Scoop, Git, Node.js LTS and Google Chrome on Windows.
  Idempotent: skips anything already installed. No admin rights needed.
#>
$ErrorActionPreference = 'Stop'

function Write-Step([string]$msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-Ok([string]$msg) { Write-Host "  [OK] $msg" -ForegroundColor Green }
function Write-Skip([string]$msg) { Write-Host "  [SKIP] $msg" -ForegroundColor Yellow }

function Refresh-Path {
  $machine = [System.Environment]::GetEnvironmentVariable('Path', 'Machine')
  $user = [System.Environment]::GetEnvironmentVariable('Path', 'User')
  $env:Path = "$machine;$user"
}

function Has-Command([string]$name) {
  return $null -ne (Get-Command $name -ErrorAction SilentlyContinue)
}

# --- 1. Scoop ---
Write-Step 'Scoop package manager'
if (Has-Command 'scoop') {
  Write-Skip "scoop already installed ($(scoop --version))"
} else {
  Write-Host '  Installing Scoop (CurrentUser, no admin)...'
  Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser -Force
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Invoke-RestMethod get.scoop.sh | Invoke-Expression
  Refresh-Path
  Write-Ok "scoop $(scoop --version)"
}

# --- 2. Git ---
Write-Step 'Git'
if (Has-Command 'git') {
  Write-Skip "git already installed ($(git --version))"
} else {
  scoop install git
  Refresh-Path
  Write-Ok "$(git --version)"
}

# --- 3. Node.js LTS (repo requires Node >= 20) ---
Write-Step 'Node.js LTS'
$nodeOk = $false
if (Has-Command 'node') {
  $v = (node --version) -replace '^v', ''
  $major = [int]($v.Split('.')[0])
  if ($major -ge 20) {
    $nodeOk = $true
    Write-Skip "node v$v already installed"
  } else {
    Write-Host "  node v$v too old, upgrading..."
  }
}
if (-not $nodeOk) {
  scoop install nodejs-lts
  Refresh-Path
  Write-Ok "$(node --version) / $(npm --version)"
}

# --- 4. Google Chrome (runs the extension + mic) ---
Write-Step 'Google Chrome'
$chromePaths = @(
  "$env:USERPROFILE\scoop\apps\googlechrome\current\chrome.exe",
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe"
)
$found = $chromePaths | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($found) {
  Write-Skip "chrome already installed ($found)"
} else {
  $buckets = scoop bucket list 2>$null
  if ($buckets -notmatch 'extras') { scoop bucket add extras }
  scoop install googlechrome
  Refresh-Path
  Write-Ok 'chrome installed via scoop'
}

Refresh-Path
Write-Host ''
Write-Ok 'Tools ready. If a later step says a command is missing, open a NEW terminal and re-run.'
