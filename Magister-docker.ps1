# Magister Studio con Docker en Windows: doble clic en Magister-docker.bat (que lanza este fichero).
# No es arrancar.ps1 (la forma de trabajar del dueño, con uv y la API fuera de Docker): esto lo mete todo en Docker.
# Comprueba Docker, prepara la primera vez los secretos (contraseña de la base, canario y tu token de Claude),
# levanta base, API y web con `docker compose --profile docker up -d --build`, espera y abre el navegador.
# Uso: Magister-docker.bat            arranca (o solo abre el navegador si ya está en marcha)
#      Magister-docker.bat parar      lo apaga
param([string]$Orden = "")

$ErrorActionPreference = "Continue"
Set-Location $PSScriptRoot
$puerto = if ($env:MAGISTER_DOCKER_PUERTO_WEB) { $env:MAGISTER_DOCKER_PUERTO_WEB } else { "8080" }
$url = "http://localhost:$puerto"
$salud = "http://127.0.0.1:$puerto/api/salud"
# COMPOSE_PROJECT_NAME solo para probar una instalación aparte; por defecto, el de compose.yaml.
$proyecto = if ($env:COMPOSE_PROJECT_NAME) { $env:COMPOSE_PROJECT_NAME } else { "magister-studio" }
$volumenDatos = "${proyecto}_magister-studio-datos"
$imagenApi = "$proyecto-api"
$secretos = Join-Path $PSScriptRoot "secretos"

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

function DockerVa {
    docker info *> $null
    return ($LASTEXITCODE -eq 0)
}

function Aleatorio([int]$n, [string]$letras) {
    $bytes = New-Object byte[] $n
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    -join ($bytes | ForEach-Object { $letras[$_ % $letras.Length] })
}

function Escribir([string]$ruta, [string]$valor) {
    # Sin BOM y sin salto de línea al final.
    [System.IO.File]::WriteAllText($ruta, $valor, (New-Object System.Text.UTF8Encoding($false)))
}

Write-Host "=== Magister Studio ==="

# 1. Docker instalado
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Salir ("No encuentro Docker. Instala Docker Desktop para Windows desde`n" +
        "  https://www.docker.com/products/docker-desktop/`n" +
        "Durante la instalación deja marcada la opción de WSL 2. Reinicia si te lo pide,`n" +
        "abre Docker Desktop una vez, acepta las condiciones y vuelve a abrir Magister.")
}
docker compose version *> $null
if ($LASTEXITCODE -ne 0) { Salir "Tu Docker no trae «docker compose». Actualiza Docker Desktop y vuelve a abrir Magister." }

# 2. Docker en marcha
if (-not (DockerVa)) {
    Decir "Abriendo Docker Desktop (puede tardar un par de minutos)..."
    $escritorio = Join-Path $env:ProgramFiles "Docker\Docker\Docker Desktop.exe"
    if (Test-Path $escritorio) { Start-Process $escritorio } else { Salir "No encuentro Docker Desktop. Ábrelo tú desde el menú Inicio y vuelve a abrir Magister." }
    for ($i = 0; $i -lt 90 -and -not (DockerVa); $i++) { Start-Sleep -Seconds 2 }
    if (-not (DockerVa)) {
        Salir ("Docker no termina de arrancar. Ábrelo tú, espera a que diga que está en marcha (`"Engine running`")`n" +
            "y vuelve a abrir Magister. Si es la primera vez, puede que tengas que aceptar sus condiciones.")
    }
}

if ($Orden -eq "parar") {
    docker compose --profile docker stop
    Decir "Magister está parado. Tus datos siguen guardados."
    exit 0
}

# 3. ¿Ya está en marcha?
if (Responde) {
    Decir "Magister ya está en marcha: abro $url"
    Start-Process $url
    exit 0
}

# 4. Secretos de la primera vez (carpeta secretos\, fuera de git)
New-Item -ItemType Directory -Force $secretos | Out-Null
if (-not (Test-Path ".env.compose")) { Copy-Item ".env.compose.example" ".env.compose" }

$clave = Join-Path $secretos "postgres_password"
if (-not (Test-Path $clave) -or (Get-Item $clave).Length -eq 0) {
    docker volume inspect $volumenDatos *> $null
    if ($LASTEXITCODE -eq 0) {
        Salir ("Ya hay datos de Magister en este equipo, pero falta el fichero secretos\postgres_password`n" +
            "(la contraseña de esa base). Si has descargado Magister de nuevo en otra carpeta, copia aquí la carpeta`n" +
            "«secretos» de la instalación anterior y vuelve a abrir Magister. No borro ni toco nada.")
    }
    Escribir $clave (Aleatorio 32 "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789")
}
$canario = Join-Path $secretos "canario"
if (-not (Test-Path $canario) -or (Get-Item $canario).Length -eq 0) {
    Escribir $canario ("mg-" + (Aleatorio 32 "0123456789abcdef"))
}

# 5. El token de Claude (tu cuenta, con tu suscripción)
$fichToken = Join-Path $secretos "claude_token"
function TokenValido { (Test-Path $fichToken) -and ((Get-Content $fichToken -Raw -ErrorAction SilentlyContinue) -match '^\s*sk-ant-') }
if (-not (TokenValido)) {
    Decir ("------------------------------------------------------------------`n" +
        "Falta tu token de Claude. Magister habla con Claude usando TU cuenta (Pro o Max).`n" +
        "Se hace una sola vez:`n" +
        "  1. Se abrirá un enlace para iniciar sesión en Claude con tu cuenta.`n" +
        "  2. Al terminar, verás en pantalla un token largo que empieza por sk-ant-`n" +
        "  3. Cópialo y pégalo aquí cuando te lo pida.`n" +
        "También puedes pegarlo tú en el fichero secretos\claude_token (dentro de esta carpeta).`n" +
        "------------------------------------------------------------------")
    Read-Host "Pulsa Intro para empezar" | Out-Null
    if (Get-Command claude -ErrorAction SilentlyContinue) {
        claude setup-token
    } else {
        Decir "Preparando Magister (la primera vez descarga varios GB y puede tardar de 10 a 40 minutos)..."
        docker compose --profile docker build api
        if ($LASTEXITCODE -ne 0) { Salir "No he podido preparar Magister. Mira el mensaje de arriba y comprueba tu conexión y el espacio en disco." }
        Decir "Ahora sigue las instrucciones: abre el enlace que sale, inicia sesión y copia el código que te dan."
        docker run --rm -it --entrypoint claude $imagenApi setup-token
    }
    Write-Host ""
    $token = (Read-Host "Pega aquí el token (empieza por sk-ant-) y pulsa Intro") -replace '\s', ''
    if ($token -notlike "sk-ant-*") { Salir "Eso no parece un token (debe empezar por sk-ant-). Vuelve a abrir Magister para intentarlo otra vez." }
    Escribir $fichToken $token
}

# 6. Levantar todo
$env:MAGISTER_DOCKER_DB_CLAVE = (Get-Content $clave -Raw).Trim()
Decir "Arrancando Magister (la primera vez tarda bastante: descarga y prepara todo)..."
docker compose --profile docker up -d --build
if ($LASTEXITCODE -ne 0) {
    Salir ("Magister no ha arrancado. Para ver qué ha pasado, abre PowerShell en esta carpeta y escribe:`n" +
        "  docker compose --profile docker logs api")
}

# 7. Esperar y abrir el navegador
Decir "Esperando a que responda..."
for ($i = 0; $i -lt 300 -and -not (Responde); $i++) { Start-Sleep -Seconds 2 }
if (-not (Responde)) { Salir "Magister no responde en $url. Para ver qué pasa: docker compose --profile docker logs api" }
Start-Process $url
Decir ("Magister está en marcha en $url`n" +
    "Puedes cerrar esta ventana: sigue funcionando hasta que apagues Docker o el equipo.`n" +
    "Para pararlo: Magister-docker.bat parar")
Start-Sleep -Seconds 5
