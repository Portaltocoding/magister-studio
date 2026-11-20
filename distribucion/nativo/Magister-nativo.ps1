# Magister Studio en Windows SIN Docker: doble clic en Magister.bat (paquete Magister-Windows-sin-Docker.zip).
# Todo viene dentro del zip (Postgres con pgvector, ffmpeg, la voz, Node, pandoc, poppler, uv y la página); lo que se
# guarda va a %LOCALAPPDATA%\Magister: datos\ (la base y los ficheros), secretos\ (la contraseña de la base) y venv\.
# La primera vez prepara la base, instala las piezas de Python y la cuenta de Claude; las siguientes, solo arranca.
# Uso: Magister.bat            arranca (o solo abre el navegador si ya está en marcha)
#      Magister.bat parar      lo apaga
# Para probar una instalación aparte: MAGISTER_NATIVO_DATOS (carpeta), MAGISTER_NATIVO_PUERTO (8080) y
# MAGISTER_NATIVO_PUERTO_DB (5434, el primero libre desde ese).
param([string]$Orden = "")

$ErrorActionPreference = "Continue"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$sistema = $PSScriptRoot
$raiz = Split-Path $sistema -Parent
$base = if ($env:MAGISTER_NATIVO_DATOS) { $env:MAGISTER_NATIVO_DATOS } else { Join-Path $env:LOCALAPPDATA "Magister" }
$puerto = if ($env:MAGISTER_NATIVO_PUERTO) { [int]$env:MAGISTER_NATIVO_PUERTO } else { 8080 }
$puertoDbIdeal = if ($env:MAGISTER_NATIVO_PUERTO_DB) { [int]$env:MAGISTER_NATIVO_PUERTO_DB } else { 5434 }
$url = "http://localhost:$puerto"
$salud = "http://127.0.0.1:$puerto/api/salud"

$datos = Join-Path $base "datos"
$secretos = Join-Path $base "secretos"
$herramientas = Join-Path $base "herramientas"
$venv = Join-Path $base "venv"
$cluster = Join-Path $datos "pg"
$registros = Join-Path $base "registros"
$archivoClave = Join-Path $secretos "postgres_password"
$archivoPuertoDb = Join-Path $datos "puerto_db.txt"
$archivoPid = Join-Path $datos "api.pid"

$bin = @{
    pg = Join-Path $sistema "postgres\bin"
    uv = Join-Path $sistema "uv"
    ffmpeg = Join-Path $sistema "ffmpeg"
    node = Join-Path $sistema "node"
    pandoc = Join-Path $sistema "pandoc"
    poppler = Join-Path $sistema "poppler\bin"
}
$piper = Join-Path $sistema "piper\piper\piper.exe"
$voces = Join-Path $sistema "voces"

function Decir([string]$texto) { Write-Host ""; Write-Host $texto }

function Salir([string]$texto) {
    Decir $texto
    Write-Host ""
    Read-Host "Pulsa Intro para cerrar esta ventana" | Out-Null
    exit 1
}

function Responde {
    try { (Invoke-WebRequest $salud -UseBasicParsing -TimeoutSec 3).StatusCode -eq 200 } catch { $false }
}

function Aleatorio([int]$n) {
    $letras = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    $octetos = New-Object byte[] $n
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($octetos)
    -join ($octetos | ForEach-Object { $letras[$_ % $letras.Length] })
}

function PuertoOcupado([int]$p) {
    $null -ne (Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction SilentlyContinue)
}

# La API y la base, con su carpeta de datos, se paran juntas. Los datos se quedan.
function Parar {
    if (Test-Path $archivoPid) {
        $idApi = (Get-Content $archivoPid -ErrorAction SilentlyContinue | Select-Object -First 1)
        if ($idApi) { taskkill /PID $idApi /T /F *> $null }
        Remove-Item $archivoPid -Force -ErrorAction SilentlyContinue
    }
    if (Test-Path (Join-Path $cluster "PG_VERSION")) {
        & (Join-Path $bin.pg "pg_ctl.exe") stop -D $cluster -m fast *> $null
    }
    Write-Host "Magister está apagado. Tus datos se quedan guardados."
}

if ($Orden -eq "parar") { Parar; Start-Sleep -Seconds 2; exit 0 }

if (Responde) { Start-Process $url; exit 0 }

Write-Host "=== Magister Studio ==="
foreach ($c in @($datos, $secretos, $herramientas, $registros, (Join-Path $datos "crudo"), (Join-Path $datos "salidas"), (Join-Path $datos "copias"), (Join-Path $datos "hf"))) {
    New-Item -ItemType Directory -Force $c | Out-Null
}
if (-not (Test-Path (Join-Path $bin.pg "pg_ctl.exe"))) {
    Salir "Primero descomprime el zip: clic derecho sobre Magister-Windows-sin-Docker.zip, «Extraer todo» y «Extraer».`nDespués abre la carpeta que sale y haz doble clic en Magister.bat."
}

# Lo descargado de internet lleva una marca que hace que Windows pregunte por cada programa: se quita la primera vez.
$marca = Join-Path $datos "desbloqueado.txt"
if (-not (Test-Path $marca)) {
    Decir "Preparando los programas de Magister (solo la primera vez, unos minutos)..."
    Get-ChildItem $sistema -Recurse -File -Include *.exe, *.dll, *.bat, *.cmd, *.ps1 -ErrorAction SilentlyContinue | Unblock-File -ErrorAction SilentlyContinue
    Set-Content $marca "ok"
}

$claudeBin = Join-Path $env:USERPROFILE ".local\bin"
$env:PATH = (@($bin.pg, $bin.uv, $bin.ffmpeg, $bin.node, $bin.pandoc, $bin.poppler, $claudeBin) -join ";") + ";" + $env:PATH

# 1. Git (lo necesita Claude en Windows). Si no está en el equipo, viene dentro del zip y se descomprime una vez.
$bash = "C:\Program Files\Git\bin\bash.exe"
if (-not (Test-Path $bash)) {
    $bash = Join-Path $herramientas "git\bin\bash.exe"
    if (-not (Test-Path $bash)) {
        $paquete = Get-ChildItem (Join-Path $sistema "git") -Filter "PortableGit*.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($paquete) {
            Decir "Preparando una herramienta que Claude necesita..."
            Start-Process -FilePath $paquete.FullName -ArgumentList "-o`"$(Join-Path $herramientas 'git')`"", "-y" -Wait -WindowStyle Hidden
        }
    }
}
if (Test-Path $bash) { $env:CLAUDE_CODE_GIT_BASH_PATH = $bash }

# 2. Claude (el programa con el que Magister habla con tu cuenta)
if (-not (Get-Command claude -ErrorAction SilentlyContinue)) {
    Decir "Instalando Claude (con él habla Magister; un par de minutos)..."
    try {
        Invoke-RestMethod "https://claude.ai/install.ps1" | Invoke-Expression
    } catch {
        Salir "No he podido instalar Claude. Comprueba tu conexión a internet y vuelve a hacer doble clic en Magister.bat."
    }
    if (-not (Get-Command claude -ErrorAction SilentlyContinue)) {
        Salir "No he podido instalar Claude. Comprueba tu conexión a internet y vuelve a hacer doble clic en Magister.bat."
    }
}

# 3. La cuenta de Claude. En Windows la página no puede hacer la conexión (no hay terminal virtual), así que se hace
#    aquí, una vez: Claude abre su página de inicio de sesión y guarda la sesión él mismo, sin copiar nada a mano.
claude auth status *> $null
if ($LASTEXITCODE -ne 0) {
    Decir "Ahora vamos a conectar tu cuenta de Claude (la de tu suscripción Pro o Max).
Se abrirá una página de Claude: inicia sesión y pulsa «Autorizar».
Si te pide un código, cópialo, pégalo aquí (clic derecho) y pulsa Intro."
    claude auth login
    claude auth status *> $null
    if ($LASTEXITCODE -ne 0) {
        Decir "No se ha podido conectar tu cuenta. Magister se abre igualmente, pero no podrá hablar con Claude hasta que la conectes:
cierra esta ventana y vuelve a hacer doble clic en Magister.bat para intentarlo otra vez."
        Start-Sleep -Seconds 4
    }
}

# 4. La contraseña de la base (generada la primera vez, en secretos\) y la base
if (-not (Test-Path $archivoClave)) { Set-Content -Path $archivoClave -Value (Aleatorio 28) -NoNewline }
$clave = (Get-Content $archivoClave -Raw).Trim()
$env:PGPASSWORD = $clave
$env:PGCLIENTENCODING = "UTF8"

if (Test-Path $archivoPuertoDb) { $puertoDb = [int](Get-Content $archivoPuertoDb -Raw).Trim() }
else {
    $puertoDb = $puertoDbIdeal
    while (PuertoOcupado $puertoDb) { $puertoDb++ }
    Set-Content $archivoPuertoDb $puertoDb -NoNewline
}

$pgCtl = Join-Path $bin.pg "pg_ctl.exe"
if (-not (Test-Path (Join-Path $cluster "PG_VERSION"))) {
    Decir "Preparando tu base de datos (solo la primera vez)..."
    $archivoClaveTmp = Join-Path $datos "clave.tmp"
    Set-Content -Path $archivoClaveTmp -Value $clave -NoNewline
    $initdb = Join-Path $bin.pg "initdb.exe"
    & $initdb -D $cluster -U magister --pwfile=$archivoClaveTmp -A scram-sha-256 -E UTF8 --locale-provider=icu --icu-locale=es-ES --locale=C *> (Join-Path $registros "initdb.log")
    if ($LASTEXITCODE -ne 0) {
        Remove-Item $cluster -Recurse -Force -ErrorAction SilentlyContinue
        & $initdb -D $cluster -U magister --pwfile=$archivoClaveTmp -A scram-sha-256 -E UTF8 --locale=C *> (Join-Path $registros "initdb.log")
    }
    Remove-Item $archivoClaveTmp -Force -ErrorAction SilentlyContinue
    if ($LASTEXITCODE -ne 0) { Salir "No he podido preparar la base de datos. Hay más detalles en $registros\initdb.log" }
}

& $pgCtl status -D $cluster *> $null
if ($LASTEXITCODE -ne 0) {
    Decir "Arrancando la base de datos..."
    if (PuertoOcupado $puertoDb) { Salir "El puerto $puertoDb está ocupado por otro programa. Ciérralo y vuelve a hacer doble clic en Magister.bat." }
    # Sin -w ni redirecciones: pg_ctl devuelve el control y se espera con pg_isready (con -w, PowerShell se quedaría esperando).
    Start-Process -FilePath $pgCtl -ArgumentList "start", "-D", "`"$cluster`"", "-l", "`"$(Join-Path $registros 'postgres.log')`"", "-o", "`"-p $puertoDb -c listen_addresses=127.0.0.1`"" -WindowStyle Hidden
}
$lista = $false
for ($i = 0; $i -lt 60; $i++) {
    & (Join-Path $bin.pg "pg_isready.exe") -h 127.0.0.1 -p $puertoDb *> $null
    if ($LASTEXITCODE -eq 0) { $lista = $true; break }
    Start-Sleep -Seconds 1
}
if (-not $lista) { Salir "La base de datos no arranca. Hay más detalles en $registros\postgres.log" }

$psql = Join-Path $bin.pg "psql.exe"
$existe = & $psql -h 127.0.0.1 -p $puertoDb -U magister -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='magister'"
if ("$existe".Trim() -ne "1") {
    & (Join-Path $bin.pg "createdb.exe") -h 127.0.0.1 -p $puertoDb -U magister magister
}
& $psql -h 127.0.0.1 -p $puertoDb -U magister -d magister -q -c "CREATE EXTENSION IF NOT EXISTS vector" *> $null
if ($LASTEXITCODE -ne 0) { Salir "A la base de datos le falta una pieza (pgvector). Vuelve a descargar el zip de Magister." }

# 5. Python y las piezas de Magister (la primera vez descarga unos 2 GB: de 5 a 20 minutos)
$env:UV_PROJECT_ENVIRONMENT = $venv
$env:UV_CACHE_DIR = Join-Path $base "cache-uv"
$env:PYTHONUTF8 = "1"
$python = Join-Path $venv "Scripts\python.exe"
Set-Location (Join-Path $raiz "servidor")
if (-not (Test-Path $python)) { Decir "Instalando las piezas de Magister (solo la primera vez: descarga unos 2 GB y puede tardar entre 5 y 20 minutos)..." }
uv sync --frozen --no-dev
if ($LASTEXITCODE -ne 0 -and -not (Test-Path $python)) {
    Salir "No he podido instalar las piezas de Magister. Comprueba tu conexión a internet y vuelve a hacer doble clic en Magister.bat."
}

# 6. Todo lo que lee la API (los mismos ajustes que en Docker, con rutas de este equipo)
$env:MAGISTER_DB_URL = "postgresql+asyncpg://magister:${clave}@127.0.0.1:${puertoDb}/magister"
$env:PGHOST = "127.0.0.1"; $env:PGPORT = "$puertoDb"; $env:PGUSER = "magister"
$env:MAGISTER_CONTENEDOR_DB = ""
$env:MAGISTER_COPIAS = Join-Path $datos "copias"
$env:MAGISTER_COPIA_DIARIA = "true"
$env:MAGISTER_CHECKPOINTS = Join-Path $datos "checkpoints.sqlite"
$env:MAGISTER_CRUDO = Join-Path $datos "crudo"
$env:MAGISTER_SALIDAS = Join-Path $datos "salidas"
$env:MAGISTER_REGISTROS = Join-Path $datos "registros"
$env:MAGISTER_CLAUDE_TOKEN_FICHERO = Join-Path $datos "claude_token"
$env:MAGISTER_DIR_SECRETOS = $secretos
$env:MAGISTER_SERVIR_WEB = "true"
$env:MAGISTER_MOTOR = "cli"
$env:MAGISTER_TRABAJOS_EN_API = "true"
$env:MAGISTER_FFMPEG = Join-Path $bin.ffmpeg "ffmpeg.exe"
$env:HF_HOME = Join-Path $datos "hf"
$env:PYTHONPATH = Join-Path $raiz "servidor\src"   # por si se mueve la carpeta del zip: el código se busca aquí
if (Test-Path $piper) { $env:MAGISTER_VOZ_PIPER = $piper; $env:MAGISTER_VOZ_DIR = $voces }
# El navegador para los PDF: Chrome si está y, si no, Edge (viene con Windows).
foreach ($n in @("C:\Program Files\Google\Chrome\Application\chrome.exe", "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
                 "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe", "C:\Program Files\Microsoft\Edge\Application\msedge.exe")) {
    if (Test-Path $n) { $env:MAGISTER_CHROME = $n; $env:CHROME_PATH = $n; break }
}

# 7. Los modelos locales (unos 600 MB), una vez, para que nadie espere en la primera pregunta
$modelos = Join-Path $datos "modelos_listos.txt"
if (-not (Test-Path $modelos)) {
    Decir "Descargando lo que Magister usa para buscar en tus apuntes (solo la primera vez, unos 600 MB)..."
    & $python -c "from magister.config import ajustes; from sentence_transformers import CrossEncoder, SentenceTransformer; SentenceTransformer(ajustes.embeddings_modelo, device='cpu'); CrossEncoder(ajustes.reranker_modelo, device='cpu')"
    if ($LASTEXITCODE -eq 0) { Set-Content $modelos "ok" }
}

# 8. La base al día y la API
Decir "Poniendo tus datos al día..."
& $python -m alembic upgrade head
if ($LASTEXITCODE -ne 0) { Salir "No he podido poner la base al día. Hay más detalles arriba; si no lo entiendes, abre una issue en GitHub contando qué ves." }
& $python -m magister.cli indexar --al-arrancar

Decir "Arrancando Magister..."
$api = Start-Process -FilePath $python -WorkingDirectory (Join-Path $raiz "servidor") `
    -ArgumentList "-m", "uvicorn", "magister.api.app:app", "--host", "127.0.0.1", "--port", "$puerto" `
    -RedirectStandardOutput (Join-Path $registros "api.log") -RedirectStandardError (Join-Path $registros "api-error.log") `
    -WindowStyle Hidden -PassThru
Set-Content $archivoPid $api.Id -NoNewline

$arriba = $false
for ($i = 0; $i -lt 180; $i++) {
    if (Responde) { $arriba = $true; break }
    if ($api.HasExited) { break }
    Start-Sleep -Seconds 1
}
if (-not $arriba) { Salir "Magister no ha arrancado. Hay más detalles en $registros\api-error.log" }
Start-Process $url
Decir "Magister está abierto en $url
Puedes cerrar esta ventana: Magister sigue funcionando. Para apagarlo, doble clic en «Parar Magister.bat»."
Start-Sleep -Seconds 6
