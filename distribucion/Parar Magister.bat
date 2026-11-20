@echo off
rem Apaga Magister (tus datos se quedan guardados). Doble clic aqui.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0sistema\Magister-docker.ps1" parar
