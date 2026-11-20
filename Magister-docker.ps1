# Magister Studio con Docker en Windows: doble clic en Magister.bat (paquete) o Magister-docker.bat (repo).
# No es arrancar.ps1 (la forma de trabajar del dueño, con uv y la API fuera de Docker): esto lo mete todo en Docker.
#
# Sirve en dos sitios:
#   - En el paquete Magister-Windows.zip (este fichero va en sistema\, junto a un compose.yaml que solo usa imágenes
#     de ghcr.io): descarga lo nuevo con `docker compose pull` y arranca sin construir nada.
#   - En el repo (raíz, con el compose.yaml de desarrollo): construye las imágenes, como siempre.
# En los dos: instala Docker Desktop si falta (winget), lo arranca, prepara la primera vez los secretos (contraseña de
# la base, canario y tu token de Claude, que saca solo de `claude setup-token`), levanta todo y abre el navegador.
# Uso: Magister.bat            arranca (o solo abre el navegador si ya está en marcha)
#      Magister.bat parar      lo apaga
param([string]$Orden = "")

$ErrorActionPreference = "Continue"
$aqui = $PSScriptRoot
$puerto = if ($env:MAGISTER_DOCKER_PUERTO_WEB) { $env:MAGISTER_DOCKER_PUERTO_WEB } else { "8080" }
$url = "http://localhost:$puerto"
$salud = "http://127.0.0.1:$puerto/api/salud"
# COMPOSE_PROJECT_NAME solo para probar una instalación aparte; por defecto, magister-studio.
$proyecto = if ($env:COMPOSE_PROJECT_NAME) { $env:COMPOSE_PROJECT_NAME } else { "magister-studio" }
$volumenDatos = "${proyecto}_magister-studio-datos"
$etiqueta = if ($env:MAGISTER_ETIQUETA) { $env:MAGISTER_ETIQUETA } else { "estable" }
$binDocker = Join-Path $env:ProgramFiles "Docker\Docker\resources\bin"
$escritorio = Join-Path $env:ProgramFiles "Docker\Docker\Docker Desktop.exe"

if ((Split-Path $aqui -Leaf) -eq "sistema" -and (Test-Path (Join-Path $aqui "compose.yaml"))) {
    # Paquete: se trabaja desde sistema\ (la carpeta del compose) y los secretos van al lado del arrancador.
    $modo = "paquete"
    $secretos = Join-Path (Split-Path $aqui -Parent) "secretos"
    $compose = @("compose", "-f", "compose.yaml")
    $imagenApi = "ghcr.io/portaltocoding/magister-studio-api:$etiqueta"
    $comoParar = "doble clic en «Parar Magister.bat»"
} else {
    $modo = "repo"
    $secretos = Join-Path $aqui "secretos"
    $compose = @("compose", "--profile", "docker")
    $imagenApi = "$proyecto-api"
    $comoParar = "Magister-docker.bat parar"
}
Set-Location $aqui

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

function PuertoOcupado {
    try {
        $c = New-Object System.Net.Sockets.TcpClient
        $c.Connect("127.0.0.1", [int]$puerto)
        $c.Close()
        return $true
    } catch { return $false }
}

Write-Host "=== Magister Studio ==="

# 1. Docker instalado (si no, con winget)
$recienInstalado = $false
if (-not (Get-Command docker -ErrorAction SilentlyContinue) -and (Test-Path (Join-Path $binDocker "docker.exe"))) {
    $env:Path = "$env:Path;$binDocker"
}
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        Salir ("Falta Docker Desktop y este Windows no trae el instalador automático (winget).`n" +
            "Descárgalo de https://www.docker.com/products/docker-desktop/ , instálalo con las opciones que trae`n" +
            "y vuelve a hacer doble clic en Magister.")
    }
    Decir ("Docker no está instalado: lo instalo ahora (unos 600 MB, puede tardar unos minutos).`n" +
        "Si Windows pregunta «¿Quieres permitir que esta aplicación haga cambios?», pulsa «Sí».")
    winget install -e --id Docker.DockerDesktop --accept-package-agreements --accept-source-agreements
    if (-not (Test-Path (Join-Path $binDocker "docker.exe"))) {
        Salir ("No he podido instalar Docker. Comprueba tu conexión a internet y vuelve a hacer doble clic en Magister.`n" +
            "Si Windows te preguntó y pulsaste «No», esta vez pulsa «Sí».")
    }
    $env:Path = "$env:Path;$binDocker"
    $recienInstalado = $true
}

# 2. Docker en marcha
if (-not (DockerVa)) {
    # Docker necesita WSL en Windows. Si falta, se instala y hay que reiniciar una vez.
    if (Get-Command wsl.exe -ErrorAction SilentlyContinue) {
        wsl.exe --status *> $null
        if ($LASTEXITCODE -ne 0) {
            Decir ("Docker necesita un componente de Windows (WSL). Lo instalo ahora.`n" +
                "Si Windows pregunta «¿Quieres permitir que esta aplicación haga cambios?», pulsa «Sí».")
            try {
                Start-Process wsl.exe -ArgumentList "--install", "--no-distribution" -Verb RunAs -Wait -ErrorAction Stop
            } catch {
                Salir "Sin ese permiso no puedo preparar Docker. Vuelve a hacer doble clic en Magister y pulsa «Sí»."
            }
            Salir "Listo. Ahora reinicia el ordenador y, al volver, haz doble clic otra vez en Magister."
        }
    }
    Decir "Abriendo Docker (puede tardar un par de minutos)..."
    if (Test-Path $escritorio) { Start-Process $escritorio } else { Salir "No encuentro Docker Desktop. Ábrelo tú desde el menú Inicio y vuelve a hacer doble clic en Magister." }
    for ($i = 0; $i -lt 300 -and -not (DockerVa); $i++) {
        if ($i -eq 10) {
            Decir ("Esperando a Docker. Si es la primera vez, en la ventana de Docker pulsa «Accept» y, si te pide`n" +
                "iniciar sesión, pulsa «Skip» (no hace falta cuenta). Yo sigo solo.")
        }
        Start-Sleep -Seconds 2
    }
    if (-not (DockerVa)) {
        if ($recienInstalado) {
            Salir "Docker acaba de instalarse y Windows necesita reiniciar. Reinicia el ordenador y, al volver, haz doble clic otra vez en Magister."
        }
        Salir ("Docker no termina de arrancar. Reinicia el ordenador y haz doble clic otra vez en Magister.`n" +
            "Si sigue igual, abre Docker Desktop desde el menú Inicio y mira si te pide algo.")
    }
}
docker compose version *> $null
if ($LASTEXITCODE -ne 0) { Salir "Tu Docker es muy antiguo (no trae «docker compose»). Actualízalo desde Docker Desktop y vuelve a hacer doble clic en Magister." }

if ($Orden -eq "parar") {
    docker @compose stop
    if ($LASTEXITCODE -eq 0) { Decir "Magister está parado. Tus datos siguen guardados." }
    else { Decir "No he podido pararlo. Cierra Docker Desktop (icono de la ballena junto al reloj → Quit) y se apagará." }
    Start-Sleep -Seconds 4
    exit 0
}

# 3. ¿Ya está en marcha?
if (Responde) {
    Decir "Magister ya está en marcha: abro $url"
    Start-Process $url
    exit 0
}

# 4. Secretos de la primera vez (carpeta secretos\, fuera de git y fuera del zip)
New-Item -ItemType Directory -Force $secretos | Out-Null
if ($modo -eq "repo" -and -not (Test-Path ".env.compose")) { Copy-Item ".env.compose.example" ".env.compose" }

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
$fichToken = Join-Path $secretos "claude_token"
if (-not (Test-Path $fichToken)) { Escribir $fichToken "" }

# 5. Lo último de Magister (paquete) o construirlo (repo)
if ($modo -eq "paquete") {
    Decir "Buscando la última versión de Magister (la primera vez descarga unos 3 GB: de 5 a 30 minutos)..."
    docker @compose pull
    if ($LASTEXITCODE -ne 0) {
        docker image inspect $imagenApi *> $null
        if ($LASTEXITCODE -eq 0) {
            Decir "No he podido buscar novedades (¿sin internet?). Arranco la versión que ya tenías."
        } else {
            Salir ("No he podido descargar Magister. Comprueba tu conexión a internet y que te quedan al menos`n" +
                "15 GB libres en el disco, y vuelve a hacer doble clic en Magister.")
        }
    }
} else {
    Decir "Preparando Magister (la primera vez descarga varios GB y puede tardar de 10 a 40 minutos)..."
    docker @compose build
    if ($LASTEXITCODE -ne 0) { Salir "No he podido preparar Magister. Comprueba tu conexión a internet y el espacio en el disco, y vuelve a abrir Magister." }
}

# 6. El token de Claude (tu cuenta, con tu suscripción)
function TokenValido { (Test-Path $fichToken) -and ((Get-Content $fichToken -Raw -ErrorAction SilentlyContinue) -match '^\s*sk-ant-') }
if (-not (TokenValido)) {
    Decir ("------------------------------------------------------------------`n" +
        "Falta conectar Magister con tu cuenta de Claude (Pro o Max). Se hace una sola vez:`n" +
        "  1. Se abrirá el navegador: inicia sesión en Claude y pulsa «Authorize».`n" +
        "  2. Te enseñará un código: cópialo, vuelve a esta ventana, pégalo (Ctrl+V) y pulsa Intro.`n" +
        "Lo demás lo hago yo.`n" +
        "------------------------------------------------------------------")
    Read-Host "Pulsa Intro para empezar" | Out-Null
    $enlace = Join-Path $secretos ".enlace"
    Remove-Item $enlace -Force -ErrorAction SilentlyContinue
    # Abre en el navegador el enlace de inicio de sesión que deja token_claude.py, en cuanto aparece.
    $vigia = Start-Job -ArgumentList $enlace -ScriptBlock {
        param($f)
        for ($i = 0; $i -lt 900; $i++) {
            if (Test-Path $f) {
                $u = (Get-Content $f -Raw).Trim()
                if ($u -match '^https://[^\s"]+$') { Start-Process $u; break }
            }
            Start-Sleep -Seconds 1
        }
    }
    docker run --rm -it -v "${secretos}:/salida" --entrypoint python $imagenApi /app/token_claude.py /salida
    Stop-Job $vigia -ErrorAction SilentlyContinue
    Remove-Job $vigia -Force -ErrorAction SilentlyContinue
    Remove-Item $enlace -Force -ErrorAction SilentlyContinue
    if (TokenValido) {
        Decir "Hecho: Magister ya está conectado con tu cuenta de Claude."
    } else {
        # Plan B: pegarlo a mano.
        Write-Host ""
        $token = (Read-Host "No he visto el token. Si en pantalla hay uno que empieza por sk-ant-, cópialo, pégalo aquí y pulsa Intro") -replace '\s', ''
        if ($token -notlike "sk-ant-*") { Salir "Sin el token no puedo conectar con Claude. Vuelve a hacer doble clic en Magister para intentarlo otra vez." }
        Escribir $fichToken $token
    }
}

# 7. Levantar todo
$env:MAGISTER_DOCKER_DB_CLAVE = (Get-Content $clave -Raw).Trim()
Decir "Arrancando Magister..."
if ($modo -eq "paquete") { docker @compose up -d --no-build } else { docker @compose up -d }
if ($LASTEXITCODE -ne 0) {
    if (PuertoOcupado) {
        Salir "Magister no ha arrancado: otro programa está usando el puerto $puerto. Ciérralo (o reinicia el equipo) y vuelve a hacer doble clic en Magister."
    }
    Salir "Magister no ha arrancado. Reinicia Docker (icono de la ballena junto al reloj → Restart) y vuelve a hacer doble clic en Magister."
}

# 8. Esperar y abrir el navegador
Decir "Esperando a que responda (la primera vez, un par de minutos)..."
for ($i = 0; $i -lt 300 -and -not (Responde); $i++) { Start-Sleep -Seconds 2 }
if (-not (Responde)) {
    Salir ("Magister no responde en $url. Espera un minuto y vuelve a hacer doble clic en Magister.`n" +
        "Si sigue sin responder, reinicia Docker (icono de la ballena junto al reloj → Restart) y prueba otra vez.")
}
Start-Process $url
Decir ("Magister está en marcha en $url`n" +
    "Puedes cerrar esta ventana: sigue funcionando hasta que apagues Docker o el equipo.`n" +
    "Para pararlo: $comoParar")
Start-Sleep -Seconds 5
