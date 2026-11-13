# =====================================================================
# Gera o pacote das funções Lambda do Xylo:  C:\Xylo\aws\xylo-lambda.zip
#
# Como usar (PowerShell, dentro da pasta C:\Xylo):
#     powershell -ExecutionPolicy Bypass -File aws\empacotar.ps1
#
# O mesmo .zip vai nas 4 funções (xylo-api, xylo-ia, xylo-rotinas, xylo-backup).
# NÃO inclui o .env (as senhas ficam nas variáveis de cada função, na AWS).
# =====================================================================
$ErrorActionPreference = 'Stop'
$raiz    = Split-Path -Parent $PSScriptRoot
$backend = Join-Path $raiz 'backend'
$temp    = Join-Path $env:TEMP 'xylo-lambda'
$destino = Join-Path $PSScriptRoot 'xylo-lambda.zip'

Write-Host '1/3 Copiando o backend (sem .env e sem node_modules)...'
if (Test-Path $temp) { Remove-Item $temp -Recurse -Force }
New-Item -ItemType Directory $temp | Out-Null
Get-ChildItem $backend -Force | Where-Object { $_.Name -notin @('node_modules', '.env', '.env.local', 'backup.log') } |
  Copy-Item -Destination $temp -Recurse -Force

Write-Host '2/3 Instalando só as dependências de produção...'
Push-Location $temp
npm install --omit=dev --no-audit --no-fund | Out-Host
if ($LASTEXITCODE -ne 0) { Pop-Location; throw 'npm install falhou' }
Pop-Location

Write-Host '3/3 Compactando...'
if (Test-Path $destino) { Remove-Item $destino -Force }
# NÃO usamos o Compress-Archive: no Windows PowerShell ele grava as pastas com "\"
# (src\app.js) e no Linux da AWS isso vira um arquivo com esse nome, não uma pasta.
# Aqui cada arquivo entra com "/" e o lambda.js fica na RAIZ do zip.
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$base = (Resolve-Path $temp).Path.TrimEnd('\') + '\'
$zip = [System.IO.Compression.ZipFile]::Open($destino, [System.IO.Compression.ZipArchiveMode]::Create)
try {
  Get-ChildItem $temp -Recurse -File -Force | ForEach-Object {
    $nome = $_.FullName.Substring($base.Length).Replace('\', '/')
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $_.FullName, $nome, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
  }
} finally {
  $zip.Dispose()
}
Remove-Item $temp -Recurse -Force

$mb = [math]::Round((Get-Item $destino).Length / 1MB, 1)
Write-Host ""
Write-Host "Pronto: $destino ($mb MB)" -ForegroundColor Green
Write-Host 'Envie em cada função: Lambda > função > Código > Fazer upload de > Arquivo .zip'