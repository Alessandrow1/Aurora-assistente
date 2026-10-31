@echo off
setlocal
cd /d "%~dp0"

rem Informa ao Electron que deve carregar o servidor Vite durante o desenvolvimento.
set "VITE_DEV_SERVER_URL=http://127.0.0.1:5173"
echo ==========================================
echo       AURORA - Assistente Virtual
echo ==========================================
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js nao encontrado. Instale a versao LTS em https://nodejs.org/ e tente novamente.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Instalando dependencias pela primeira vez...
  call npm install
  if errorlevel 1 (
    echo.
    echo Falha ao instalar dependencias. Verifique sua conexao com a internet.
    pause
    exit /b 1
  )
)
if not exist node_modules\node-edge-tts (
  echo Atualizando dependencias para instalar a voz natural da Aurora...
  call npm install
  if errorlevel 1 (
    echo Falha ao instalar a voz neural. Verifique sua conexao com a internet.
    pause
    exit /b 1
  )
)
if not exist node_modules\@pixiv\three-vrm (
  echo Instalando o renderizador de personagem anime VRM...
  call npm install
  if errorlevel 1 (
    echo Falha ao instalar o renderizador VRM. Verifique sua conexao com a internet.
    pause
    exit /b 1
  )
)
if not exist public\models\aurora-anime.vrm (
  if not exist public\models mkdir public\models
  echo Baixando o modelo 3D anime gratuito da Aurora - cerca de 18 MB...
  curl.exe -L --fail --retry 3 "https://raw.githubusercontent.com/GY19A/jev-stage/main/static/vrm/anime_girl.vrm" -o "public\models\aurora-anime.vrm"
  if errorlevel 1 (
    del /q "public\models\aurora-anime.vrm" >nul 2>nul
    echo Nao foi possivel baixar o modelo. A Aurora abrira com o avatar alternativo.
  )
)
call npm run dev
if errorlevel 1 pause
