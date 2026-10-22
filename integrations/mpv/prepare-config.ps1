param([Parameter(Mandatory)][string]$Upstream, [Parameter(Mandatory)][string]$Destination)
$ErrorActionPreference = 'Stop'
if (Test-Path -LiteralPath $Destination) { throw 'Choose an empty destination; existing playback history is never overwritten.' }
New-Item -ItemType Directory -Path $Destination | Out-Null
Copy-Item (Join-Path $Upstream 'src\common\*') $Destination -Recurse
Copy-Item (Join-Path $Upstream 'src\modern_glass\*') $Destination -Recurse -Force
foreach ($name in @('mpv.conf','input.conf')) { Copy-Item -LiteralPath (Join-Path $Upstream "src\$name") -Destination $Destination }
# Remove upstream's embedded shared subtitle API credential before applying the patch.
Get-ChildItem -LiteralPath $Destination -Recurse -File | Where-Object { $_.Extension -in @('.lua','.conf','.json','.txt','.md') } | ForEach-Object {
  $text = [IO.File]::ReadAllText($_.FullName)
  $clean = [regex]::Replace($text, '(api_token\s*=\s*)"[^"\r\n]+"', '$1""')
  [IO.File]::WriteAllText($_.FullName, $clean.Replace("`r`n", "`n"), [Text.UTF8Encoding]::new($false))
}
git -C $Destination apply --check (Join-Path $PSScriptRoot 'zh-TW.patch')
if ($LASTEXITCODE -ne 0) { throw 'Localization patch does not match this upstream revision.' }
git -C $Destination apply (Join-Path $PSScriptRoot 'zh-TW.patch')
if ($LASTEXITCODE -ne 0) { throw 'Localization patch failed.' }
"Prepared Traditional Chinese Modern Glass: $Destination"
