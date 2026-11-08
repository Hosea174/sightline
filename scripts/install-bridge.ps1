param([Parameter(Mandatory=$true)][ValidatePattern('^[a-p]{32}$')][string]$ExtensionId)
$ErrorActionPreference='Stop'
$bridge = (Resolve-Path (Join-Path $PSScriptRoot '../src-tauri/target/release/sightline-bridge.exe')).Path
$directory = Join-Path $env:LOCALAPPDATA 'Sightline'
New-Item -ItemType Directory -Force -Path $directory | Out-Null
$manifest = Join-Path $directory 'native-host.json'
$content = @{name='com.sightline.capture';description='Sightline local capture bridge';path=$bridge;type='stdio';allowed_origins=@("chrome-extension://$ExtensionId/")} | ConvertTo-Json -Depth 4
[System.IO.File]::WriteAllText($manifest, $content, [System.Text.UTF8Encoding]::new($false))
foreach($key in @('HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.sightline.capture','HKCU:\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\com.sightline.capture')) {New-Item -Path $key -Force | Out-Null; Set-Item -Path $key -Value $manifest}
Write-Output 'Sightline native messaging host registered for Chrome and Brave.'
