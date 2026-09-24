param(
  [Parameter(Mandatory=$true)][string]$PackagePath,
  [Parameter(Mandatory=$true)][ValidateSet('x64','arm64')][string]$ExpectedArchitecture,
  [string]$ExpectedIdentityName = '',
  [string]$ExpectedPublisher = '',
  [string]$EvidencePath = ''
)

$ErrorActionPreference = 'Stop'
$resolved = (Resolve-Path $PackagePath).Path
if ([IO.Path]::GetExtension($resolved) -notin @('.appx','.msix')) {
  throw "Store package must be .appx or .msix: $resolved"
}

$temp = Join-Path $env:RUNNER_TEMP ("aecp-store-" + [guid]::NewGuid().ToString('N'))
$zip = Join-Path $temp 'package.zip'
$expanded = Join-Path $temp 'expanded'
New-Item -ItemType Directory -Force -Path $temp,$expanded | Out-Null

try {
  Copy-Item $resolved $zip
  Expand-Archive -Path $zip -DestinationPath $expanded -Force
  $manifestPath = Join-Path $expanded 'AppxManifest.xml'
  if (-not (Test-Path $manifestPath)) { throw 'AppxManifest.xml is missing from Store package.' }

  [xml]$manifest = Get-Content $manifestPath -Raw
  $identity = $manifest.SelectSingleNode("/*[local-name()='Package']/*[local-name()='Identity']")
  if (-not $identity) { throw 'Package Identity is missing from AppxManifest.xml.' }

  $name = [string]$identity.GetAttribute('Name')
  $publisher = [string]$identity.GetAttribute('Publisher')
  $architecture = [string]$identity.GetAttribute('ProcessorArchitecture')
  if ([string]::IsNullOrWhiteSpace($name)) { throw 'Store package Identity.Name is empty.' }
  if ([string]::IsNullOrWhiteSpace($publisher)) { throw 'Store package Identity.Publisher is empty.' }
  if ($ExpectedIdentityName -and $name -ne $ExpectedIdentityName) {
    throw "Identity.Name '$name' does not match expected '$ExpectedIdentityName'."
  }
  if ($ExpectedPublisher -and $publisher -ne $ExpectedPublisher) {
    throw "Identity.Publisher '$publisher' does not match expected '$ExpectedPublisher'."
  }
  if ($architecture.ToLowerInvariant() -ne $ExpectedArchitecture.ToLowerInvariant()) {
    throw "ProcessorArchitecture '$architecture' does not match expected '$ExpectedArchitecture'."
  }

  $application = $manifest.SelectSingleNode("/*[local-name()='Package']/*[local-name()='Applications']/*[local-name()='Application']")
  if (-not $application) { throw 'Store package Application entry is missing.' }
  $executable = [string]$application.GetAttribute('Executable')
  if ([string]::IsNullOrWhiteSpace($executable)) { throw 'Store package Application.Executable is empty.' }

  $capabilityNames = @($manifest.SelectNodes("//*[local-name()='Capability']") | ForEach-Object { [string]$_.GetAttribute('Name') })
  if ($capabilityNames -notcontains 'runFullTrust') { throw 'Electron Store package must declare runFullTrust capability.' }

  $evidence = [ordered]@{
    schema = 'aecp.store-package-evidence/v1'
    package = [IO.Path]::GetFileName($resolved)
    sha256 = (Get-FileHash $resolved -Algorithm SHA256).Hash.ToLowerInvariant()
    identityName = $name
    publisher = $publisher
    processorArchitecture = $architecture
    executable = $executable
    capabilities = $capabilityNames
    manifestSha256 = (Get-FileHash $manifestPath -Algorithm SHA256).Hash.ToLowerInvariant()
    validatedAt = (Get-Date).ToUniversalTime().ToString('o')
  }

  $json = $evidence | ConvertTo-Json -Depth 5
  if ($EvidencePath) {
    $parent = Split-Path -Parent $EvidencePath
    if ($parent) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
    $json | Out-File -Encoding utf8 $EvidencePath
  }
  $json
} finally {
  Remove-Item $temp -Recurse -Force -ErrorAction SilentlyContinue
}
