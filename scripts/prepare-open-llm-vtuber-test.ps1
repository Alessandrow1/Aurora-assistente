[CmdletBinding()]
param(
    [string]$OllamaModel = "qwen3.5:9b",
    [string]$TargetPath = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Require-Command([string]$Name, [string]$InstallHint) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Não encontrei '$Name'. Instale antes de continuar: $InstallHint"
    }
}

function Invoke-Checked([string]$Command, [string[]]$Arguments, [string]$WorkingDirectory) {
    Push-Location $WorkingDirectory
    try {
        & $Command @Arguments
        if ($LASTEXITCODE -ne 0) {
            throw "'$Command $($Arguments -join ' ')' terminou com código $LASTEXITCODE."
        }
    }
    finally {
        Pop-Location
    }
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if ([string]::IsNullOrWhiteSpace($TargetPath)) {
    $parent = Split-Path $repoRoot -Parent
    $TargetPath = Join-Path $parent "Open-LLM-VTuber-Test-v1.2.1"
}
$TargetPath = [System.IO.Path]::GetFullPath($TargetPath)

if ($TargetPath.StartsWith($repoRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Por segurança, o teste precisa ficar fora da pasta do repositório Aurora. Caminho recebido: $TargetPath"
}
if (Test-Path $TargetPath) {
    throw "A pasta de destino já existe e não será sobrescrita: $TargetPath. Apague ou escolha outro -TargetPath."
}

Require-Command "git" "winget install --id Git.Git -e"
Require-Command "uv" "winget install --id astral-sh.uv -e"
Require-Command "ffmpeg" "winget install ffmpeg"

Write-Host "Verificando Ollama em http://127.0.0.1:11434 ..."
try {
    $ollama = Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/tags" -TimeoutSec 5
}
catch {
    throw "O Ollama não respondeu. Inicie o Ollama e tente novamente. Detalhe: $($_.Exception.Message)"
}
$installed = @($ollama.models | ForEach-Object { [string]$_.name })
if ($installed -notcontains $OllamaModel) {
    throw "O modelo '$OllamaModel' não está instalado no Ollama. Execute: ollama pull $OllamaModel"
}

Write-Host ""
Write-Host "Clonando Open-LLM-VTuber v1.2.1 com o submódulo da interface..."
$targetParent = Split-Path $TargetPath -Parent
New-Item -ItemType Directory -Force -Path $targetParent | Out-Null
Invoke-Checked "git" @(
    "clone", "--branch", "v1.2.1", "--depth", "1", "--recursive",
    "https://github.com/Open-LLM-VTuber/Open-LLM-VTuber.git", $TargetPath
) $targetParent

Write-Host ""
Write-Host "Preparando ambiente Python 3.12..."
Invoke-Checked "uv" @("sync", "--python", "3.12") $TargetPath

Write-Host ""
Write-Host "Adicionando Faster-Whisper (CPU int8) apenas ao ambiente de teste..."
Invoke-Checked "uv" @("add", "faster-whisper") $TargetPath

Write-Host ""
Write-Host "Copiando a personagem Aurora para a instalação isolada e criando conf.yaml..."
$configScript = Join-Path $repoRoot "scripts\configure-open-llm-vtuber-test.py"
$avatarSource = Join-Path $repoRoot "public\models\booth-6xb"
Invoke-Checked "uv" @(
    "run", "python", $configScript,
    "--project-root", $TargetPath,
    "--avatar-source", $avatarSource,
    "--ollama-model", $OllamaModel
) $TargetPath

Write-Host ""
Write-Host "Preparação concluída."
Write-Host "Pasta isolada: $TargetPath"
Write-Host ""
Write-Host "Para iniciar:"
Write-Host "  Set-Location '$TargetPath'"
Write-Host "  uv run run_server.py"
Write-Host ""
Write-Host "Depois abra: http://127.0.0.1:12393"
Write-Host "Feche a Aurora antes do teste para não disputar CPU/RAM com o Ollama."
