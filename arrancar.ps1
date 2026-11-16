# Arranca Magister Studio en Windows con un clic (acceso directo «Magister» del escritorio) o con .\arrancar.ps1
# Levanta Docker y la base, aplica las migraciones, hace la copia del día si falta, construye la página si hace falta,
# arranca la API (que sirve también la página) y abre http://localhost:8000.
# Si Magister ya está en marcha, solo abre el navegador.
$ErrorActionPreference = "Stop"
$raiz = $PSScriptRoot
$url = "http://localhost:8000"
$salud = "http://127.0.0.1:8000/api/salud"  # localhost puede ir por IPv6 y la API escucha en 127.0.0.1

function Responde {
    try { (Invoke-WebRequest $salud -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200 } catch { $false }
}

if (Responde) {
    Start-Process $url
    exit 0
}

if (-not (docker info 2>$null)) {
    Write-Host "Abriendo Docker Desktop..."
    Start-Process "C:\Program Files\Docker\Docker\Docker Desktop.exe"
    while (-not (docker info 2>$null)) { Start-Sleep -Seconds 2 }
}
Set-Location $raiz
docker compose up -d db | Out-Null
Write-Host "Esperando a la base..."
while ((docker inspect -f "{{.State.Health.Status}}" magister-studio-db) -ne "healthy") { Start-Sleep -Seconds 1 }

# La copia del día, si aún no está (la tarea programada la hace a las 13:00; esto cubre los días que no estaba encendido).
$hoy = Get-Date -Format "yyyy-MM-dd"
if (-not (Test-Path "$raiz\copias\diarias\magister-$hoy.dump")) {
    Write-Host "Haciendo la copia de hoy..."
    & "C:\Program Files\Git\bin\bash.exe" -lc "cd '$($raiz -replace '\\','/')' && scripts/copia_db.sh" | Out-Host
}

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
# El navegador se abre cuando la API ya responde.
Start-Job -ScriptBlock {
    param($u)
    for ($i = 0; $i -lt 60; $i++) {
        try { if ((Invoke-WebRequest "http://127.0.0.1:8000/api/salud" -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200) { Start-Process $u; break } } catch {}
        Start-Sleep -Seconds 1
    }
} -ArgumentList $url | Out-Null
Write-Host "Magister Studio en $url (cierra esta ventana o pulsa Ctrl+C para pararlo)"
uv run uvicorn magister.api.app:app --host 127.0.0.1 --port 8000
