$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$target = Join-Path $root 'start.bat'
$desktop = [Environment]::GetFolderPath('Desktop')
$path = Join-Path $desktop '网页镜像.lnk'

if (-not (Test-Path $target)) {
  throw "Missing start.bat: $target"
}

$ws = New-Object -ComObject WScript.Shell
$sc = $ws.CreateShortcut($path)
$sc.TargetPath = $target
$sc.WorkingDirectory = $root
$sc.WindowStyle = 7
$sc.Description = '网页镜像 - 站点归档 (Electron)'
$icon = Join-Path $root 'build\icon.ico'
if (-not (Test-Path $icon)) { $icon = Join-Path $root 'resources\icon.png' }
if (-not (Test-Path $icon)) { $icon = Join-Path $root 'resources\tray.png' }
if (Test-Path $icon) {
  $sc.IconLocation = "$icon,0"
} else {
  $sc.IconLocation = "$env:SystemRoot\System32\shell32.dll,3"
}
$sc.Save()

Write-Host "Desktop shortcut created: $path"
