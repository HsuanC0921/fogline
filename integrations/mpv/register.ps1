# Registers an existing mpv installation for this user. Keeps Windows UserChoice intact.
param([string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'Programs\mpv'))
$ErrorActionPreference = 'Stop'
$exe = Join-Path $InstallDir 'mpv.exe'
if (-not (Test-Path -LiteralPath $exe)) { throw "mpv.exe not found: $exe" }
$command = '"' + $exe + '" -- "%1"'
$icon = Join-Path $InstallDir 'installer\mpv-icon.ico'
$classes = 'HKCU:\Software\Classes'
$programs = @('io.mpv.file', 'Applications\mpv.exe')
# Redirect existing umpv ProgIDs without rewriting protected file-type choices.
foreach ($hive in @('HKLM:\Software\Classes', $classes)) {
  $programs += Get-ChildItem -LiteralPath $hive -ErrorAction SilentlyContinue |
    Where-Object { $_.PSChildName -like 'io.umpv.*' } | ForEach-Object { $_.PSChildName }
}
foreach ($id in ($programs | Select-Object -Unique)) {
  foreach ($verb in @('open','play')) {
    $key = Join-Path $classes "$id\shell\$verb\command"
    New-Item -Path $key -Force | Out-Null
    Set-Item -LiteralPath $key -Value $command
  }
  $key = Join-Path $classes "$id\DefaultIcon"
  New-Item -Path $key -Force | Out-Null
  Set-Item -LiteralPath $key -Value ('"' + $icon + '"')
}
foreach ($name in @('mpv.exe','umpv.exe')) {
  $key = "HKCU:\Software\Microsoft\Windows\CurrentVersion\App Paths\$name"
  New-Item -Path $key -Force | Out-Null
  Set-Item -LiteralPath $key -Value $exe
}
$shell = New-Object -ComObject WScript.Shell
$programsDir = [Environment]::GetFolderPath('Programs')
foreach ($name in @('mpv.lnk','umpv.lnk')) {
  $link = $shell.CreateShortcut((Join-Path $programsDir $name))
  $link.TargetPath = $exe; $link.WorkingDirectory = $InstallDir
  $link.IconLocation = $icon; $link.Description = 'mpv · Fogline / 繁體中文'; $link.Save()
}
"Registered mpv: $exe"
