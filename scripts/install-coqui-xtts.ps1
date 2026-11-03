$ErrorActionPreference = 'Stop'

$defaultRoot = Join-Path $env:LOCALAPPDATA 'Aurora\coqui-xtts'
$installRoot = if ($env:AURORA_COQUI_HOME) { $env:AURORA_COQUI_HOME } else { $defaultRoot }
$venvPath = Join-Path $installRoot 'venv'
$pythonExe = Join-Path $venvPath 'Scripts\python.exe'
$acceptanceFile = Join-Path $installRoot 'CPML-ACCEPTED.txt'
$readyMarker = Join-Path $installRoot 'ENV-READY.txt'

Write-Host ''
Write-Host 'AURORA - INSTALADOR EXPERIMENTAL COQUI XTTS-v2' -ForegroundColor Cyan
Write-Host 'Este motor será opcional e não substituirá Edge TTS ou Kokoro.'
Write-Host ''
Write-Host 'ATENÇÃO: os pesos XTTS-v2 usam a Coqui Public Model License (CPML).'
Write-Host 'A licença permite somente uso não comercial. Leia os termos:'
Write-Host 'https://coqui.ai/cpml.txt'
Write-Host 'O uso pessoal, estudos e projetos de hobby são contemplados; uso que gere pagamento/receita não é permitido por esta licença.'
Write-Host ''
$answer = Read-Host 'Depois de ler e aceitar a CPML para uso não comercial, digite ACEITO'
if ($answer -cne 'ACEITO') {
  Write-Host 'Instalação cancelada. Nenhuma licença foi aceita.' -ForegroundColor Yellow
  exit 1
}

if (-not (Get-Command py -ErrorAction SilentlyContinue)) {
  throw 'Python Launcher (py) não encontrado. Instale Python 3.11 x64 e marque a opção Python Launcher.'
}

$pythonVersion = & py -3.11 --version 2>&1
if ($LASTEXITCODE -ne 0) {
  throw 'Python 3.11 não encontrado. Instale Python 3.11 x64 e execute este instalador novamente.'
}

New-Item -ItemType Directory -Force -Path $installRoot | Out-Null
Remove-Item -LiteralPath $readyMarker -Force -ErrorAction SilentlyContinue
Set-Content -LiteralPath $acceptanceFile -Value ("CPML ACCEPTED BY USER" + [Environment]::NewLine + "Accepted for non-commercial personal testing on $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')." + [Environment]::NewLine + "License: https://coqui.ai/cpml.txt") -Encoding UTF8

if (-not (Test-Path $pythonExe)) {
  Write-Host "Criando ambiente isolado em: $venvPath" -ForegroundColor Cyan
  & py -3.11 -m venv $venvPath
  if ($LASTEXITCODE -ne 0) { throw 'Falha ao criar o ambiente Python virtual.' }
}

Write-Host 'Atualizando pip…' -ForegroundColor Cyan
& $pythonExe -m pip install --upgrade pip
if ($LASTEXITCODE -ne 0) { throw 'Falha ao atualizar pip.' }

Write-Host 'Instalando PyTorch CPU (sem depender da GT 1030)…' -ForegroundColor Cyan
& $pythonExe -m pip install torch==2.8.0 torchaudio==2.8.0 --index-url https://download.pytorch.org/whl/cpu
if ($LASTEXITCODE -ne 0) { throw 'Falha ao instalar PyTorch CPU.' }

Write-Host 'Instalando Coqui TTS 0.28.0…' -ForegroundColor Cyan
& $pythonExe -m pip install coqui-tts==0.28.0
if ($LASTEXITCODE -ne 0) { throw 'Falha ao instalar coqui-tts.' }

Set-Content -LiteralPath $readyMarker -Value 'Coqui XTTS Python environment installed successfully.' -Encoding UTF8
Write-Host ''
Write-Host 'Ambiente Coqui instalado. Os pesos XTTS-v2 serão baixados somente quando você tocar em "Testar Coqui XTTS" na Aurora.' -ForegroundColor Green
Write-Host "Pasta: $installRoot"
Write-Host 'Feche e reabra a Aurora para ela detectar o ambiente.'
