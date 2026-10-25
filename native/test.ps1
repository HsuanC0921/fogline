# Run after compiling FoglineDisplay.exe. Loads its pure helpers without starting the bridge or changing Windows.
$ErrorActionPreference = 'Stop'
$assembly = [Reflection.Assembly]::LoadFile((Join-Path $PSScriptRoot 'FoglineDisplay.exe'))
$bridge = $assembly.GetType('FoglineDisplay', $true)
$flags = [Reflection.BindingFlags]'Static,NonPublic'
$quote = $bridge.GetMethod('Q', $flags)
$errorJson = $bridge.GetMethod('JsonError', $flags)
$samples = @('', '一般文字', 'O''Reilly', 'C:\files\"quoted"', "first`r`nsecond`tcolumn", '😀')
$samples += -join (0..31 | ForEach-Object { [char]$_ })
$checks = 0
foreach ($sample in $samples) {
    $json = $quote.Invoke($null, @($sample))
    if ((ConvertFrom-Json -InputObject $json) -cne $sample) { throw 'JSON string round-trip failed' }
    $json = $errorJson.Invoke($null, @($sample))
    if ((ConvertFrom-Json -InputObject $json).error -cne $sample) { throw 'JSON error round-trip failed' }
    $checks += 2
}

$rectType = $bridge.GetNestedType('NativeRect', [Reflection.BindingFlags]::NonPublic)
function New-Rect([int[]]$Bounds) {
    $rect = [Activator]::CreateInstance($rectType)
    $fields = @('left','top','right','bottom')
    for ($i=0; $i -lt 4; $i++) { $rectType.GetField($fields[$i]).SetValue($rect, $Bounds[$i]) }
    return $rect
}
$covers = $bridge.GetMethod('CoversMonitor', $flags)
$cases = @(
    @{ Name='exact full screen'; Monitor=@(0,0,1920,1080); Window=@(0,0,1920,1080); Expected=$true },
    @{ Name='maximized with menu bar'; Monitor=@(0,0,1920,1080); Window=@(0,48,1920,1080); Expected=$false },
    @{ Name='maximized with taskbar'; Monitor=@(0,0,1920,1080); Window=@(0,0,1920,1032); Expected=$false },
    @{ Name='two-pixel rounding'; Monitor=@(0,0,1920,1080); Window=@(2,2,1918,1078); Expected=$true },
    @{ Name='three-pixel gap'; Monitor=@(0,0,1920,1080); Window=@(3,0,1920,1080); Expected=$false },
    @{ Name='negative-origin second monitor'; Monitor=@(-2560,-1440,0,0); Window=@(-2560,-1440,0,0); Expected=$true },
    @{ Name='window on a different monitor'; Monitor=@(-2560,0,0,1440); Window=@(0,0,2560,1440); Expected=$false },
    @{ Name='empty window'; Monitor=@(0,0,1920,1080); Window=@(0,0,0,0); Expected=$false }
)
foreach ($case in $cases) {
    $actual = $covers.Invoke($null, @((New-Rect $case.Window), (New-Rect $case.Monitor)))
    if ($actual -ne $case.Expected) { throw "Fullscreen bounds failed: $($case.Name)" }
    $checks++
}
"Passed $checks native checks (JSON round-trip and fullscreen geometry)."
