@echo off
chcp 65001 >nul
title Instalar IA gratuita da Aurora
color 0B

echo ================================================
echo        AURORA - INSTALADOR DE IA GRATUITA
echo =============================================
echo.
where ollama >nul 2>&1
if errorlevel 1 (
  echo Ollama nao encontrado. Tentando instalar pelo Windows Package Manager...
  where winget >nul 2>&1
  if errorlevel 1 goto manual
  winget install --id Ollama.Ollama -e
  if errorlevel 1 goto manual
  echo.
  echo Ollama instalado. Feche nesta janela, abra o Ollama pelo menu Iniciar,
  echo depois execute este arquivo novamente para baixar o modelo.
  pause
  exit /b 0
)
echo Ollama encontrado. Baixando o modelo gratuito Qwen 3.5 9B...
echo O download e maior que o modelo 2B e so precisa ser feito uma vez.
echo.
ollama pull qwen3.5:9b
if errorlevel 1 (
  echo.
  echo Nao consegui baixar o modelo. Confira sua internet e tente novamente.
  pause
  exit /b 1
)
echo.
echo Tudo pronto! Abra ou reinicie a Aurora para conversar localmente.
pause
exit /b 0

:manual
echo.
echo Nao foi possivel instalar automaticamente.
echo Instale o Ollama em https://ollama.com/download/windows
 echo Depois abra o Ollama e execute novamente este arquivo.
pause
exit /b 1
