# Arranca Magister Studio en Windows con una orden: .\arrancar.ps1
# Levanta la base en Docker, aplica las migraciones, construye la página si hace falta,
# arranca la API (que sirve también la página) y abre http://localhost:8000.
$ErrorActionPreference = "Stop"
$raiz = $PSScriptRoot

if (-not (docker info 2>$null)) {
    Write-Host "Abriendo Docker Desktop..."
    Start-Process "C:\Program Files\Docker\Docker\Docker Desktop.exe"
    while (-not (docker info 2>$null)) { Start-Sleep -Seconds 2 }
}
Set-Location $raiz
docker compose up -d db | Out-Null
Write-Host "Esperando a la base..."
while ((docker inspect -f "{{.State.Health.Status}}" magister-studio-db) -ne "healthy") { Start-Sleep -Seconds 1 }

Set-Location "$raiz\servidor"
if (-not (Test-Path ".env")) { Copy-Item ".env.example" ".env" }
uv run alembic upgrade head
uv run alembic -x db=pruebas upgrade head | Out-Null

if (-not (Test-Path "$raiz\web\dist\index.html")) {
    Write-Host "Construyendo la página..."
    Set-Location "$raiz\web"
    npm install --silent
    npm run build
    Set-Location "$raiz\servidor"
}

$env:PYTHONUTF8 = "1"
Start-Process "http://localhost:8000"
Write-Host "Magister Studio en http://localhost:8000 (Ctrl+C para parar)"
uv run uvicorn magister.api.app:app --host 127.0.0.1 --port 8000
