@echo off
setlocal
cd /d "%~dp0"
echo ==========================================
echo       ATUALIZANDO AURORA
echo ==========================================
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js nao encontrado. Instale em https://nodejs.org/
  pause
  exit /b 1
)
echo Instalando as dependencias novas da personagem e da voz...
call npm install
if errorlevel 1 (
  echo.
  echo Falha na atualizacao. Confira a conexao com a internet.
  pause
  exit /b 1
)
if not exist public\models mkdir public\models
if not exist public\models\aurora-anime.vrm (
  echo.
  echo Baixando a personagem anime gratuita da Aurora (aprox. 18 MB)...
  curl.exe -L --fail --retry 3 "https://raw.githubusercontent.com/GY19A/jev-stage/main/static/vrm/anime_girl.vrm" -o "public\models\aurora-anime.vrm"
  if errorlevel 1 (
    del /q "public\models\aurora-anime.vrm" >nul 2>nul
    echo O download do modelo falhou. A Aurora ainda pode iniciar com o avatar alternativo.
  ) else (
    echo Modelo anime instalado com sucesso!
  )
) else (
  echo Modelo anime ja instalado.
)
echo.
echo Aurora atualizada! Agora execute INICIAR-AURORA.bat.
pause
