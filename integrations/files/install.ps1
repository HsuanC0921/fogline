param([switch]$Light)
# Fogline material for Files and QuickLook. Both keep their own settings files, so this only writes colours and the preview backdrop.
$ErrorActionPreference = 'Stop'
if (-not $PSBoundParameters.ContainsKey('Light')) {
  $Light = [bool](Get-ItemPropertyValue 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize' AppsUseLightTheme -ErrorAction SilentlyContinue)
}
# Same tints as theme\shared.css (--mat-regular): glass over the Files backdrop, a little denser in the sidebar.
$tint = if ($Light) { @{ Sidebar='#8CE5EAF4'; Surface='#66E5EAF4'; Window='#E6E5EAF4' } } else { @{ Sidebar='#7A242E42'; Surface='#52242E42'; Window='#D6242E42' } }

$files = Get-ChildItem (Join-Path $env:LOCALAPPDATA 'Packages') -Directory -Filter '49306atecsolution.FilesUWP*' | Select-Object -First 1
if ($files) {
  $settings = Join-Path $files.FullName 'LocalState\settings\user_settings.json'
  if (Test-Path -LiteralPath $settings) {
    $running = Get-Process Files -ErrorAction SilentlyContinue
    try {
    $running | Stop-Process; $running | Wait-Process -Timeout 10 -ErrorAction SilentlyContinue
    if (Get-Process Files -ErrorAction SilentlyContinue) { throw 'Files is still running; its settings were not changed.' }
    $text = [IO.File]::ReadAllText($settings)
    foreach ($entry in @{
      AppThemeSidebarBackgroundColor = $tint.Sidebar; AppThemeToolbarBackgroundColor = $tint.Surface
      AppThemeAddressBarBackgroundColor = $tint.Surface; AppThemeFileAreaBackgroundColor = $tint.Surface
      AppThemeFileAreaSecondaryBackgroundColor = $tint.Surface; AppThemeInfoPaneBackgroundColor = $tint.Surface
    }.GetEnumerator()) {
      $text = [regex]::Replace($text, '("' + $entry.Key + '"\s*:\s*)"[^"]*"', ('${1}"' + $entry.Value + '"'))
    }
    [IO.File]::WriteAllText($settings, $text, [Text.UTF8Encoding]::new($false))
    'Files       = themed'
    } finally {
      if ($running -and -not (Get-Process Files -ErrorAction SilentlyContinue)) { Start-Process 'shell:AppsFolder\49306atecsolution.FilesUWP_et10x9a9vyk8t!App' }
    }
  }
} else { 'Files       = not installed, skipped' }

# QuickLook: translucent window with the same tint, so the preview opens in the same material instead of a flat white sheet.
$ql = Join-Path $env:APPDATA 'pooi.moe\QuickLook\QuickLook.config'
if (Test-Path -LiteralPath $ql) {
  [xml]$xml = Get-Content -LiteralPath $ql -Raw
  foreach ($entry in @{ UseTransparency='True'; WindowBackdrop='Acrylic11'; WindowBackgroundColor=$tint.Window }.GetEnumerator()) {
    $node = $xml.Settings.SelectSingleNode($entry.Key)
    if (-not $node) { $node = $xml.CreateElement($entry.Key); [void]$xml.Settings.AppendChild($node) }
    $node.InnerText = $entry.Value
  }
  $xml.Save($ql)
  $quickLook = @(Get-Process QuickLook -ErrorAction SilentlyContinue)
  if ($quickLook.Count) {
    $path = $quickLook[0].Path
    $quickLook | Stop-Process
    $quickLook | Wait-Process -Timeout 10 -ErrorAction SilentlyContinue
    if (Get-Process QuickLook -ErrorAction SilentlyContinue) { throw 'QuickLook has not stopped; it was not started a second time.' }
    Start-Process -FilePath $path
  }
  'QuickLook   = themed'
} else { 'QuickLook   = not installed or never run, skipped' }
