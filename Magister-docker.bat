@echo off
rem Magister Studio con Docker en Windows: doble clic aqui. Todo lo hace Magister-docker.ps1: en el paquete
rem Magister-Windows.zip (donde este fichero se llama Magister.bat) esta en sistema\; en el repo, al lado.
set "MAGISTER_PS1=%~dp0sistema\Magister-docker.ps1"
if not exist "%MAGISTER_PS1%" set "MAGISTER_PS1=%~dp0Magister-docker.ps1"
if not exist "%MAGISTER_PS1%" (
  echo.
  echo Primero descomprime el zip: clic derecho sobre Magister-Windows.zip, "Extraer todo" y "Extraer".
  echo Despues abre la carpeta que sale y haz doble clic en Magister.bat.
  echo.
  pause
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%MAGISTER_PS1%" %*
