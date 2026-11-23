# =====================================================================
# Gera o pacote das funções Lambda do Xylo:  C:\Xylo\aws\xylo-lambda.zip
#
# Como usar (PowerShell, dentro da pasta C:\Xylo):
#     powershell -ExecutionPolicy Bypass -File aws\empacotar.ps1
#
# O mesmo .zip vai nas 4 funções (xylo-api, xylo-ia, xylo-rotinas, xylo-backup).
# NÃO inclui o .env (as senhas ficam nas variáveis de cada função, na AWS).
# Usa o tar do Windows (10 ou mais novo): ele grava as pastas com "/", que é o
# que o Linux da AWS entende. (O Compress-Archive grava com "\" e a função não
# acha os próprios arquivos.)
# =====================================================================
$ErrorActionPreference = 'Stop'
$backend = Join-Path (Split-Path -Parent $PSScriptRoot) 'backend'
$destino = Join-Path $PSScriptRoot 'xylo-lambda.zip'

Push-Location $backend
try {
  Write-Host '1/2 Conferindo as dependências...'
  npm install --no-audit --no-fund | Out-Host
  if ($LASTEXITCODE -ne 0) { throw 'npm install falhou' }

  Write-Host '2/2 Compactando...'
  if (Test-Path $destino) { Remove-Item $destino -Force }
  tar -a -c -f $destino lambda.js server.js package.json src database node_modules
  if ($LASTEXITCODE -ne 0) { throw 'tar falhou' }
} finally {
  Pop-Location
}

# confere: o lambda.js tem que estar na raiz do zip (sem pasta antes)
$primeiros = tar -t -f $destino | Select-Object -First 3
if ($primeiros -notcontains 'lambda.js') { throw "O zip ficou errado: lambda.js não está na raiz ($($primeiros -join ', '))." }

$mb = [math]::Round((Get-Item $destino).Length / 1MB, 1)
Write-Host ""
Write-Host "Pronto: $destino ($mb MB) - lambda.js na raiz: OK" -ForegroundColor Green
Write-Host 'Envie em cada função: Lambda > função > Código > Fazer upload de > Arquivo .zip'
