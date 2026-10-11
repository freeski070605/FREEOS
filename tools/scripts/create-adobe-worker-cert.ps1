param([Parameter(Mandatory=$true)][string]$DnsName, [Parameter(Mandatory=$true)][string]$IpAddress)
$ErrorActionPreference = 'Stop'
$openssl = Get-Command openssl -ErrorAction SilentlyContinue
if (-not $openssl) { throw 'OpenSSL is required to create the AIO worker certificate. Install it and rerun this script.' }
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$dir = Join-Path $repo 'generated\adobe-worker\tls'
New-Item -ItemType Directory -Path $dir -Force | Out-Null
$cert = Join-Path $dir 'worker-cert.pem'
$key = Join-Path $dir 'worker-key.pem'
if ((Test-Path -LiteralPath $cert) -or (Test-Path -LiteralPath $key)) { throw "TLS files already exist at $dir. Move them aside deliberately before generating replacements." }
& $openssl.Source req -x509 -newkey rsa:3072 -sha256 -days 365 -nodes -keyout $key -out $cert -subj "/CN=$DnsName" -addext "subjectAltName=DNS:$DnsName,IP:$IpAddress" -addext 'extendedKeyUsage=serverAuth'
if ($LASTEXITCODE -ne 0) { throw 'OpenSSL certificate generation failed.' }
$envPath = Join-Path $repo '.env'
if (-not (Test-Path -LiteralPath $envPath)) { throw 'Run setup-adobe-worker.ps1 first.' }
$lines = @(Get-Content -LiteralPath $envPath)
foreach ($pair in @(@('FREEOS_ADOBE_TLS_CERT',$cert),@('FREEOS_ADOBE_TLS_KEY',$key))) {
  $name = $pair[0]; $value = $pair[1]
  $exists = @($lines | Where-Object { $_ -match "^$name=" }).Count -gt 0
  $lines = @($lines | ForEach-Object { if ($_ -match "^$name=") { "$name=$value" } else { $_ } })
  if (-not $exists) { $lines += "$name=$value" }
}
[System.IO.File]::WriteAllLines($envPath, $lines)
Write-Host "Certificate created: $cert"
Write-Host "Private key created: $key (keep on AIO only)"
Write-Host 'Copy worker-cert.pem to the laptop and set NODE_EXTRA_CA_CERTS to that copied path. Match FREEOS_ADOBE_WORKER_URL host to the certificate DNS name or IP.'
