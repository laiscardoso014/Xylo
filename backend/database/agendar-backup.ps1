# =====================================================================
# Agenda o backup do Xylo para rodar SOZINHO todo dia no Windows.
#
# Como usar (PowerShell, dentro da pasta C:\Xylo\backend):
#     powershell -ExecutionPolicy Bypass -File database\agendar-backup.ps1
#     powershell -ExecutionPolicy Bypass -File database\agendar-backup.ps1 -Pasta "G:\Meu Drive\Xylo" -Hora "12:30"
#
# - Roda todo dia no horário escolhido. Se o computador estiver desligado,
#   roda assim que ele for ligado (StartWhenAvailable).
# - Usa o banco do arquivo .env (CONNECTION_STRING).
# - Para conferir: Agendador de Tarefas do Windows > "Xylo - backup diário".
# - Para remover:  Unregister-ScheduledTask -TaskName "Xylo - backup diário"
# =====================================================================
param(
  [string]$Pasta = "",
  [string]$Hora = "12:30"
)
$ErrorActionPreference = 'Stop'
$backend = Split-Path -Parent $PSScriptRoot
$node = (Get-Command node -ErrorAction Stop).Source
$script = Join-Path $backend 'database\fazer-backup.js'
$log = Join-Path $backend 'backup.log'

$argumentos = "`"$script`""
if ($Pasta) { $argumentos += " `"$Pasta`"" }

# cmd /c para guardar a saída num log (assim dá para ver se deu certo)
$acao = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"`"$node`" $argumentos >> `"$log`" 2>&1`"" -WorkingDirectory $backend
$quando = New-ScheduledTaskTrigger -Daily -At $Hora
$config = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 30)
Register-ScheduledTask -TaskName 'Xylo - backup diário' -Action $acao -Trigger $quando -Settings $config -Description 'Backup diário do banco do Xylo (backend\database\fazer-backup.js)' -Force | Out-Null

Write-Host "Backup agendado para todo dia às $Hora." -ForegroundColor Green
if ($Pasta) { Write-Host "Pasta: $Pasta" } else { Write-Host "Pasta: $(Join-Path (Split-Path -Parent $backend) 'backups')" }
Write-Host "Rodando o primeiro agora para testar..."
Start-ScheduledTask -TaskName 'Xylo - backup diário'
Start-Sleep -Seconds 8
if (Test-Path $log) { Get-Content $log -Tail 5 }
