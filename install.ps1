# Installs Fogline into Seelen UI and applies the recommended settings.
#   powershell -ExecutionPolicy Bypass -File install.ps1            # theme + settings + menu bar layout
#   powershell -ExecutionPolicy Bypass -File install.ps1 -ThemeOnly # theme files only
#   powershell -ExecutionPolicy Bypass -File install.ps1 -PinSettings # also pin System Settings to the Dock
# Seelen rewrites settings.json while running, so it is stopped first and relaunched at the end.
param([switch]$ThemeOnly, [switch]$PinSettings)
$ErrorActionPreference = 'Stop'

$data = Join-Path $env:APPDATA 'com.seelen.seelen-ui'
if (-not (Test-Path $data)) { throw "Seelen UI data folder not found: $data. Install and run Seelen UI once first." }

$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$wpf = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\WPF'
& $compiler /nologo /target:winexe /platform:x64 "/r:$wpf\UIAutomationClient.dll" "/r:$wpf\UIAutomationTypes.dll" "/r:$wpf\WindowsBase.dll" /r:System.Data.dll "/out:$PSScriptRoot\native\FoglineDisplay.exe" "$PSScriptRoot\native\FoglineDisplay.cs"
if ($LASTEXITCODE -ne 0) { throw 'FoglineDisplay compilation failed; no installed files were changed.' }

# Stop the watchdog first: otherwise it respawns the UI during file writes and restores stale state.
$seelenPackage = Get-AppxPackage 'Seelen.SeelenUI' | Select-Object -First 1
if (-not $seelenPackage) { throw 'Seelen UI package not found.' }
$serviceCli = Join-Path $seelenPackage.InstallLocation 'slu-service.exe'
$aumid = 'shell:AppsFolder\Seelen.SeelenUI_p6yyn03m1894e!App'
$restartNeeded = $false
try {
if (Get-Process slu-service -ErrorAction SilentlyContinue) {
  $restartNeeded = $true
  & $serviceCli stop
  # Some service versions return a nonzero code even after stopping. Check the actual process.
  for ($attempt=0; $attempt -lt 30 -and (Get-Process slu-service -ErrorAction SilentlyContinue); $attempt++) { Start-Sleep -Milliseconds 100 }
  if (Get-Process slu-service -ErrorAction SilentlyContinue) {
    Start-Process -FilePath $serviceCli -ArgumentList 'stop' -Verb RunAs -WindowStyle Hidden -Wait | Out-Null
  }
}
for ($attempt=0; $attempt -lt 50 -and (Get-Process slu-service -ErrorAction SilentlyContinue); $attempt++) { Start-Sleep -Milliseconds 100 }
if (Get-Process slu-service -ErrorAction SilentlyContinue) { throw 'The Seelen watchdog is still running; no installed files were changed.' }
$restartNeeded = $true
Get-Process seelen-ui -ErrorAction SilentlyContinue | Stop-Process -Force
Wait-Process seelen-ui -Timeout 15 -ErrorAction SilentlyContinue
for ($attempt=0; $attempt -lt 50 -and (Get-Process seelen-ui -ErrorAction SilentlyContinue); $attempt++) { Start-Sleep -Milliseconds 100 }
if (Get-Process seelen-ui -ErrorAction SilentlyContinue) { throw 'Seelen UI is still running; no installed files were changed.' }

$themeDir = Join-Path $data 'themes\fogline'
New-Item -ItemType Directory -Force $themeDir | Out-Null
Copy-Item (Join-Path $PSScriptRoot 'theme\*') $themeDir -Recurse -Force
"Theme   -> $themeDir"

$iconDir = Join-Path $data 'iconpacks\fogline-icons'
New-Item -ItemType Directory -Force $iconDir | Out-Null
Copy-Item (Join-Path $PSScriptRoot 'iconpack\*') $iconDir -Recurse -Force
$iconMetadata = Get-Content (Join-Path $iconDir 'metadata.yml') -Raw
[IO.File]::WriteAllText((Join-Path $iconDir 'metadata.yml'), $iconMetadata, [Text.UTF8Encoding]::new($false))
"Icons   -> $iconDir"

foreach ($name in 'fogline-launcher','fogline-search','fogline-input','fogline-tray','fogline-network','fogline-bluetooth','fogline-control','fogline-notifications','fogline-clock','fogline-battery') {
  $pluginDir = Join-Path $data "plugins\$name"
  New-Item -ItemType Directory -Force $pluginDir | Out-Null
  Copy-Item (Join-Path $PSScriptRoot "plugins\$name\*") $pluginDir -Recurse -Force
  "Plugin  -> $pluginDir"
}

foreach ($name in 'fogline-menu','fogline-lantern','fogline-input','fogline-net','fogline-bt','fogline-cc','fogline-cal','fogline-notifications','fogline-tray') {
  $widgetDir = Join-Path $data "widgets\$name"
  New-Item -ItemType Directory -Force $widgetDir | Out-Null
  foreach ($f in 'metadata.yml','index.html','index.js','index.css') { Copy-Item (Join-Path $PSScriptRoot "widgets\$name\$f") $widgetDir -Force }
  Copy-Item (Join-Path $PSScriptRoot "widgets\$name\i18n") $widgetDir -Recurse -Force
  "Widget  -> $widgetDir"
}

# Remove only the obsolete Fogline WEG override. The native Seelen WEG bundle
# depends on internal widget APIs and cannot be hosted as a ThirdParty overlay.
$wegTarget = Join-Path $data 'widgets\fogline-seelen-weg-override'
$markerPath = Join-Path $wegTarget 'MANAGED_BY_FOGLINE'
$managedByFogline = 'fogline-seelen-weg-override@2.8.10.0'
if ((Test-Path -LiteralPath $markerPath) -and
    ([IO.File]::ReadAllText($markerPath).Trim() -eq $managedByFogline)) {
  $widgetsRoot = [IO.Path]::GetFullPath((Join-Path $data 'widgets')).TrimEnd('\') + '\'
  $resolvedWegTarget = [IO.Path]::GetFullPath($wegTarget)
  if (-not $resolvedWegTarget.StartsWith($widgetsRoot, [StringComparison]::OrdinalIgnoreCase) -or
      [IO.Path]::GetFileName($resolvedWegTarget) -ne 'fogline-seelen-weg-override') {
    throw 'Refusing to remove an unexpected Fogline Dock override path.'
  }
  Remove-Item -LiteralPath $resolvedWegTarget -Recurse -Force
  'Removed the incompatible Fogline Dock override; Seelen UI will use its native WEG widget.'
} elseif (Test-Path -LiteralPath $wegTarget) {
  Write-Warning 'An unmarked Dock override was left untouched.'
}

$nativeDir = Join-Path $data 'fogline-native'
New-Item -ItemType Directory -Force $nativeDir | Out-Null
# A previous bridge restores its own color transform before exiting.
$runtimePath = Join-Path $nativeDir 'runtime.json'
if (Test-Path -LiteralPath $runtimePath) {
  $old = Get-Content -LiteralPath $runtimePath -Raw | ConvertFrom-Json
  try { Invoke-RestMethod -Uri "http://127.0.0.1:$($old.port)/exit" -Method Post -Headers @{ Authorization="Bearer $($old.token)" } -TimeoutSec 3 | Out-Null } catch { }
}
for ($attempt=0; $attempt -lt 50 -and (Get-Process FoglineDisplay -ErrorAction SilentlyContinue); $attempt++) { Start-Sleep -Milliseconds 100 }
if (Get-Process FoglineDisplay -ErrorAction SilentlyContinue) { throw 'The previous Fogline bridge is still running; its executable was not replaced.' }
# the binary is not committed: build it from source with the .NET Framework compiler every Windows 11 ships
$nativeExe = Join-Path $PSScriptRoot 'native\FoglineDisplay.exe'
$nativeSrc = Join-Path $PSScriptRoot 'native\FoglineDisplay.cs'
if (-not (Test-Path -LiteralPath $nativeExe) -or (Get-Item -LiteralPath $nativeSrc).LastWriteTime -gt (Get-Item -LiteralPath $nativeExe).LastWriteTime) {
  $csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
  $wpf = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\WPF'
  & $csc /nologo /target:winexe /platform:x64 /optimize+ "/r:$wpf\UIAutomationClient.dll" "/r:$wpf\UIAutomationTypes.dll" "/r:$wpf\WindowsBase.dll" /r:System.Data.dll "/out:$nativeExe" $nativeSrc
  if ($LASTEXITCODE -ne 0) { throw 'Could not compile native\FoglineDisplay.cs' }
}
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'native\FoglineDisplay.exe') -Destination $nativeDir -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'native\THIRD-PARTY.txt') -Destination $nativeDir -Force
$portProbe = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
$portProbe.Start()
$port = $portProbe.LocalEndpoint.Port
$portProbe.Stop()
$runtime = @{ program=(Join-Path $nativeDir 'FoglineDisplay.exe'); port=$port; token=([guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')) }
$runtimeJson = ConvertTo-Json $runtime -Compress
[IO.File]::WriteAllText($runtimePath, $runtimeJson, [Text.UTF8Encoding]::new($false))
# widgets that talk to the bridge get its address and token as a first line (never committed)
foreach ($w in 'fogline-cc', 'fogline-input', 'fogline-net', 'fogline-notifications', 'fogline-lantern') {
  $js = Get-Content (Join-Path $PSScriptRoot "widgets\$w\index.js") -Raw
  [IO.File]::WriteAllText((Join-Path $data "widgets\$w\index.js"), "window.foglineDisplay=$runtimeJson;`n$js", [Text.UTF8Encoding]::new($false))
}

if (-not $ThemeOnly) {
  $settingsPath = Join-Path $data 'settings.json'
  $settings = if (Test-Path $settingsPath) { Get-Content $settingsPath -Raw | ConvertFrom-Json } else { [pscustomobject]@{} }
  $example = Get-Content (Join-Path $PSScriptRoot 'settings.example.json') -Raw | ConvertFrom-Json

  # shallow merge at the top level, one level deeper for byWidget so other widget settings survive
  foreach ($p in $example.PSObject.Properties) {
    if ($p.Name -eq 'byWidget') { continue }
    # union keeps the user's own themes/icon packs; the last entry wins, so ours go after theirs
    if ($p.Name -in 'activeThemes','activeIconPacks') { $p.Value = @(@($settings.($p.Name)) + $p.Value | Where-Object { $_ } | Select-Object -Unique) }
    $settings | Add-Member -NotePropertyName $p.Name -NotePropertyValue $p.Value -Force
  }
  if (-not $settings.byWidget) { $settings | Add-Member -NotePropertyName byWidget -NotePropertyValue ([pscustomobject]@{}) -Force }
  foreach ($w in $example.byWidget.PSObject.Properties) {
    $cur = $settings.byWidget.($w.Name)
    if (-not $cur) { $settings.byWidget | Add-Member -NotePropertyName $w.Name -NotePropertyValue $w.Value -Force; continue }
    foreach ($k in $w.Value.PSObject.Properties) { $cur | Add-Member -NotePropertyName $k.Name -NotePropertyValue $k.Value -Force }
  }
  # UTF-8 without BOM on both Windows PowerShell 5.1 and PowerShell 7
  [IO.File]::WriteAllText($settingsPath, ($settings | ConvertTo-Json -Depth 50), (New-Object Text.UTF8Encoding $false))
  "Settings -> $settingsPath"

  $layoutDir = Join-Path $data 'data\seelen-fancy-toolbar'
  New-Item -ItemType Directory -Force $layoutDir | Out-Null
  # desktops have no battery, so the battery item (and its "plugged in" tooltip) is left out
  $hasBattery = [bool](Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue)
  $layout = (Get-Content (Join-Path $PSScriptRoot 'toolbar-layout.yml')) | Where-Object { $hasBattery -or $_ -notmatch 'fogline-battery' }
  [IO.File]::WriteAllLines((Join-Path $layoutDir 'state.yml'), [string[]]$layout, (New-Object Text.UTF8Encoding $false))
  "Menu bar layout -> $layoutDir\state.yml"
  $appsData = Join-Path $data 'data\seelen-apps-menu'
  New-Item -ItemType Directory -Path $appsData -Force | Out-Null
  [IO.File]::WriteAllText((Join-Path $appsData 'display_mode.json'), '"normal"', [Text.UTF8Encoding]::new($false))
  # macOS has no Show Desktop button in the Dock, so drop Seelen's default one
  $wegPath = Join-Path $data 'data\seelen-weg\state.yml'
  if (Test-Path $wegPath) {
    $raw = [IO.File]::ReadAllText($wegPath)
    $clean = $raw -replace "(?m)^- type: Plugin\r?\n  id: [0-9a-f-]+\r?\n  plugin: '@default/weg-show-desktop'\r?\n", ''
    if ($clean -ne $raw) { [IO.File]::WriteAllText($wegPath, $clean, [Text.UTF8Encoding]::new($false)); 'Dock    -> Show Desktop button removed' }
  }
  # opt-in: pin System Settings to the Dock (macOS keeps it near the end). Line-based, so the user's other pins stay untouched.
  if ($PinSettings) {
    $wegState = Join-Path $data 'data\seelen-weg\state.yml'
    if (Test-Path $wegState) {
      $lines = [System.Collections.Generic.List[string]](Get-Content $wegState)
      if (-not ($lines -match 'immersivecontrolpanel')) {
        $at = $lines.FindIndex({ param($l) $l -eq 'right:' -or $l -eq 'right: []' })
        if ($at -ge 0) {
          $entry = @(
            '- type: AppOrFile',
            "  id: $([guid]::NewGuid())",
            '  displayName: 設定',
            '  umid: windows.immersivecontrolpanel_cw5n1h2txyewy!microsoft.windows.immersivecontrolpanel',
            '  path: C:\Windows\ImmersiveControlPanel\SystemSettings.exe',
            '  pinned: true',
            '  preventPinning: false',
            '  relaunch: null'
          )
          if ($lines[$at] -eq 'right: []') { $lines[$at] = 'right: []' }
          $lines.InsertRange($at, [string[]]$entry)
          [IO.File]::WriteAllLines($wegState, $lines, (New-Object Text.UTF8Encoding $false))
          'Dock    -> System Settings pinned'
        }
      }
    }
  }

}

# Plugin tooltips run in a sandbox that cannot ask for the language, so the language from Seelen's settings
# (the Windows display language when unset) is written into them here. Run the installer again after changing it.
$settingsFile = Join-Path $data 'settings.json'
$tag = ''
if (Test-Path $settingsFile) { try { $tag = [string](Get-Content $settingsFile -Raw | ConvertFrom-Json).language } catch { } }
if (-not $tag) { $tag = (Get-UICulture).Name }
$langIndex = if ($tag -like 'ja*') { 1 } elseif ($tag -like 'zh*') { 2 } else { 0 }
foreach ($f in Get-ChildItem (Join-Path $data 'plugins\fogline-*') -Recurse -Include metadata.yml,template.js) {
  $text = [IO.File]::ReadAllText($f.FullName)
  $new = $text -replace 'const k = \d; // fogline:lang', "const k = $langIndex; // fogline:lang"
  if ($new -ne $text) { [IO.File]::WriteAllText($f.FullName, $new, [Text.UTF8Encoding]::new($false)) }
}


# Older versions started a blur helper for Flow Launcher; Flow is no longer part of Fogline, so tidy that up.
Get-Process FoglineGlass -ErrorAction SilentlyContinue | Stop-Process
Remove-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name 'FoglineGlass' -ErrorAction SilentlyContinue
$staleGlass = Join-Path $nativeDir 'FoglineGlass.exe'
if (Test-Path -LiteralPath $staleGlass) { [IO.File]::Delete($staleGlass) }
} finally {
  if ($restartNeeded -and -not (Get-Process seelen-ui -ErrorAction SilentlyContinue)) { Start-Process $aumid }
}
'Done. Seelen UI is running.'
