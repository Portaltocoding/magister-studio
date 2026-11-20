@echo off
rem Magister Studio en Windows sin Docker: doble clic aqui. Todo lo hace sistema\Magister-nativo.ps1.
set "MAGISTER_PS1=%~dp0sistema\Magister-nativo.ps1"
if not exist "%MAGISTER_PS1%" (
  echo.
  echo Primero descomprime el zip: clic derecho sobre Magister-Windows-sin-Docker.zip, "Extraer todo" y "Extraer".
  echo Despues abre la carpeta que sale y haz doble clic en Magister.bat.
  echo.
  pause
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%MAGISTER_PS1%" %*
