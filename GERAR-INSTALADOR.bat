@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Instale o Node.js LTS em https://nodejs.org/ primeiro.
  pause
  exit /b 1
)
if not exist node_modules (
  call npm install
  if errorlevel 1 (
    echo Falha ao instalar dependencias.
    pause
    exit /b 1
  )
)
call npm run dist
if errorlevel 1 (
  echo Falha ao gerar o instalador.
  pause
  exit /b 1
)
echo.
echo Instalador criado na pasta release.
pause
