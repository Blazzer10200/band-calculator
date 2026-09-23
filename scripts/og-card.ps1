# Renders the link-preview image (og.png, 1200x630) and the home-screen icon (icon-180.png) with headless Edge.
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$edge = @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $edge) { throw 'Microsoft Edge was not found.' }
$userData = Join-Path $env:TEMP ('og-card-' + [guid]::NewGuid())
New-Item -ItemType Directory $userData | Out-Null
function Render($page, $out, $size) {
  # Edge hands off to a background process when called directly, so wait on it explicitly.
  # Start-Process does not quote arguments, so render to a space-free temp path and move it into place.
  $url = ([uri](Join-Path $root $page)).AbsoluteUri
  $shot = Join-Path $userData ([IO.Path]::GetFileName($out))
  Start-Process -FilePath $edge -Wait -NoNewWindow -ArgumentList @('--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', "--user-data-dir=$userData", '--virtual-time-budget=4000', "--window-size=$size", "--screenshot=$shot", $url)
  if (-not (Test-Path $shot)) { throw "Render failed: $out" }
  Move-Item -Force $shot $out
}
Render 'scripts\og-card.html' (Join-Path $root 'og.png') '1200,630'
Render 'scripts\icon-card.html' (Join-Path $root 'icon-180.png') '180,180'
Remove-Item -Recurse -Force $userData -ErrorAction SilentlyContinue
Get-Item (Join-Path $root 'og.png'), (Join-Path $root 'icon-180.png') | Select-Object Name, Length
