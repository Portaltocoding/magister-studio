#!/usr/bin/env bash
# Magister Studio con Docker, para Mac y Linux. En Mac se abre con doble clic en Magister.command; en Linux, con
# bash magister.sh desde una terminal. «bash magister.sh parar» lo apaga.
#
# Sirve en dos sitios:
#   - En el paquete Magister-Mac.zip (este fichero va en sistema/, junto a un compose.yaml que solo usa imágenes de
#     ghcr.io): descarga lo nuevo con `docker compose pull` y arranca sin construir nada.
#   - En el repo (raíz, con el compose.yaml de desarrollo): construye las imágenes, como siempre.
# En los dos: instala Docker Desktop si falta (Mac), lo arranca, prepara la primera vez los secretos (contraseña de la
# base, canario y tu token de Claude, que saca solo de `claude setup-token`), levanta todo y abre el navegador.
set -u
AQUI="$(cd "$(dirname "$0")" && pwd)" || exit 1
export PATH="$PATH:/usr/local/bin:/opt/homebrew/bin:/Applications/Docker.app/Contents/Resources/bin:$HOME/.docker/bin"

PUERTO="${MAGISTER_DOCKER_PUERTO_WEB:-8080}"
URL="http://localhost:$PUERTO"
SALUD="http://127.0.0.1:$PUERTO/api/salud"
# COMPOSE_PROJECT_NAME solo para probar una instalación aparte (ver docs/instalar.md); por defecto, magister-studio.
PROYECTO="${COMPOSE_PROJECT_NAME:-magister-studio}"
VOLUMEN_DATOS="${PROYECTO}_magister-studio-datos"
SISTEMA="$(uname -s)"

if [ "$(basename "$AQUI")" = "sistema" ] && [ -f "$AQUI/compose.yaml" ]; then
  # Paquete: se trabaja desde sistema/ (la carpeta del compose) y los secretos van al lado del arrancador.
  MODO=paquete
  cd "$AQUI" || exit 1
  SECRETOS="../secretos"
  COMPOSE=(docker compose -f compose.yaml)
  IMAGEN_API="ghcr.io/portaltocoding/magister-studio-api:${MAGISTER_ETIQUETA:-estable}"
  PARAR="haz doble clic en «Parar Magister.command» o escribe: bash $AQUI/magister.sh parar"
else
  MODO=repo
  cd "$AQUI" || exit 1
  SECRETOS="secretos"
  COMPOSE=(docker compose --profile docker)
  IMAGEN_API="${PROYECTO}-api"
  PARAR="bash magister.sh parar"
fi

decir() { printf '\n%s\n' "$*"; }

salir() {
  decir "$*"
  printf '\n'
  read -r -p "Pulsa Intro para cerrar esta ventana. " _ || true
  exit 1
}

responde() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsS -m 3 -o /dev/null "$SALUD" 2>/dev/null
  else
    wget -q -T 3 -O /dev/null "$SALUD" 2>/dev/null
  fi
}

abrir_enlace() {
  case "$1" in
    https://* | http://localhost:*) ;;
    *) return 0 ;;
  esac
  if [ "$SISTEMA" = "Darwin" ]; then
    open "$1"
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$1" >/dev/null 2>&1 &
  else
    decir "Abre esta dirección en tu navegador: $1"
  fi
}

aleatorio() { LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c "$1"; }

docker_va() { docker info >/dev/null 2>&1; }

# Descarga el Docker Desktop oficial para el chip de este Mac, lo copia a Aplicaciones (con la contraseña del Mac,
# en la ventana del sistema) y lo deja listo para abrirlo.
instalar_docker_mac() {
  local arq tmp
  case "$(uname -m)" in
    arm64) arq=arm64 ;;
    *) arq=amd64 ;;
  esac
  tmp="$(mktemp -d)" || salir "No he podido preparar la instalación de Docker. Vuelve a hacer doble clic en Magister."
  decir "Docker no está instalado: lo descargo (unos 600 MB, puede tardar unos minutos)..."
  curl -fL --progress-bar -o "$tmp/Docker.dmg" "https://desktop.docker.com/mac/main/$arq/Docker.dmg" \
    || { rm -rf "$tmp"; salir "No he podido descargar Docker. Comprueba tu conexión a internet y vuelve a hacer doble clic en Magister."; }
  hdiutil attach -nobrowse -quiet -mountpoint "$tmp/volumen" "$tmp/Docker.dmg" \
    || { rm -rf "$tmp"; salir "No he podido abrir el instalador de Docker. Vuelve a hacer doble clic en Magister."; }
  decir "Copio Docker a Aplicaciones. El Mac te pedirá tu contraseña (la que usas para entrar en el Mac)."
  if ! osascript -e "do shell script \"ditto '$tmp/volumen/Docker.app' '/Applications/Docker.app'\" with administrator privileges" >/dev/null 2>&1; then
    hdiutil detach -quiet "$tmp/volumen" >/dev/null 2>&1
    rm -rf "$tmp"
    salir "Sin tu contraseña no puedo instalar Docker. Vuelve a hacer doble clic en Magister cuando quieras."
  fi
  hdiutil detach -quiet "$tmp/volumen" >/dev/null 2>&1
  rm -rf "$tmp"
  decir "Docker instalado."
}

# Espera a que Docker responda; la primera vez avisa de lo que hay que pulsar en su ventana.
esperar_docker() {
  local i
  for i in $(seq 1 300); do
    docker_va && return 0
    if [ "$i" -eq 10 ]; then
      decir "Esperando a Docker. Si es la primera vez, en la ventana de Docker pulsa «Accept»; si te pide tu
contraseña del Mac, escríbela; y si te pide iniciar sesión, pulsa «Skip» (no hace falta cuenta). Yo sigo solo."
    fi
    sleep 2
  done
  return 1
}

# Abre en el navegador el enlace de inicio de sesión que deja token_claude.py, en cuanto aparece.
vigilar_enlace() {
  local i
  for i in $(seq 1 900); do
    if [ -s "$SECRETOS/.enlace" ]; then
      abrir_enlace "$(cat "$SECRETOS/.enlace")"
      return 0
    fi
    sleep 1
  done
}

echo "=== Magister Studio ==="

# 1. Docker instalado
if ! command -v docker >/dev/null 2>&1; then
  if [ "$SISTEMA" = "Darwin" ]; then
    [ -d /Applications/Docker.app ] || instalar_docker_mac
  else
    salir "No encuentro Docker. Instálalo siguiendo la guía de tu distribución:
  https://docs.docker.com/engine/install/
y vuelve a abrir Magister."
  fi
fi

# 2. Docker en marcha
if ! docker_va; then
  if [ "$SISTEMA" = "Darwin" ]; then
    decir "Abriendo Docker (puede tardar un par de minutos)..."
    open -a Docker >/dev/null 2>&1 || salir "No he podido abrir Docker. Ábrelo tú desde Aplicaciones y vuelve a hacer doble clic en Magister."
  elif command -v docker >/dev/null 2>&1 && docker info 2>&1 | grep -qi "permission denied"; then
    salir "Tu usuario no tiene permiso para usar Docker. En una terminal, escribe:
  sudo usermod -aG docker \$USER
cierra la sesión del equipo, vuelve a entrar y abre Magister otra vez."
  else
    decir "Docker no está en marcha. Intento arrancarlo (puede pedirte tu contraseña)..."
    systemctl --user start docker-desktop >/dev/null 2>&1 || sudo systemctl start docker || true
  fi
  esperar_docker || salir "Docker no termina de arrancar. Ábrelo tú (en Aplicaciones), espera a que diga que está en
marcha («Engine running») y vuelve a hacer doble clic en Magister. Si sigue igual, reinicia el Mac y prueba otra vez."
fi
docker compose version >/dev/null 2>&1 || salir "Tu Docker es muy antiguo (no trae «docker compose»). Actualiza Docker
Desktop desde su menú («Check for updates») y vuelve a hacer doble clic en Magister."

if [ "${1:-}" = "parar" ]; then
  if "${COMPOSE[@]}" stop; then
    decir "Magister está parado. Tus datos siguen guardados."
  else
    decir "No he podido parar Magister. Cierra Docker (en la barra de arriba, el icono de la ballena → Quit) y se apagará."
  fi
  exit 0
fi

# 3. ¿Ya está en marcha?
if responde; then
  decir "Magister ya está en marcha: abro $URL"
  abrir_enlace "$URL"
  exit 0
fi

# 4. Secretos de la primera vez (carpeta secretos/, fuera de git y fuera del zip)
mkdir -p "$SECRETOS" && chmod 700 "$SECRETOS"
if [ "$MODO" = repo ] && [ ! -f .env.compose ]; then cp .env.compose.example .env.compose; fi

if [ ! -s "$SECRETOS/postgres_password" ]; then
  if docker volume inspect "$VOLUMEN_DATOS" >/dev/null 2>&1; then
    salir "Ya hay datos de Magister en este equipo, pero falta el fichero secretos/postgres_password
(la contraseña de esa base). Si has descargado Magister de nuevo en otra carpeta, copia aquí la carpeta
«secretos» de la instalación anterior y vuelve a abrir Magister. No borro ni toco nada."
  fi
  aleatorio 32 > "$SECRETOS/postgres_password"
fi
if [ ! -s "$SECRETOS/canario" ]; then
  printf 'mg-%s' "$(LC_ALL=C tr -dc 'a-f0-9' </dev/urandom | head -c 32)" > "$SECRETOS/canario"
fi
[ -f "$SECRETOS/claude_token" ] || : > "$SECRETOS/claude_token"
chmod 644 "$SECRETOS/postgres_password" "$SECRETOS/canario" "$SECRETOS/claude_token"  # el contenedor los lee con otro usuario

# 5. Lo último de Magister (paquete) o construirlo (repo)
if [ "$MODO" = paquete ]; then
  decir "Buscando la última versión de Magister (la primera vez descarga unos 3 GB: de 5 a 30 minutos)..."
  if ! "${COMPOSE[@]}" pull; then
    if docker image inspect "$IMAGEN_API" >/dev/null 2>&1; then
      decir "No he podido buscar novedades (¿sin internet?). Arranco la versión que ya tenías."
    else
      salir "No he podido descargar Magister. Comprueba tu conexión a internet y que te quedan al menos 15 GB libres
en el disco, y vuelve a hacer doble clic en Magister."
    fi
  fi
else
  decir "Preparando Magister (la primera vez descarga varios GB y puede tardar de 10 a 40 minutos)..."
  "${COMPOSE[@]}" build || salir "No he podido preparar Magister. Comprueba tu conexión a internet y el espacio en el
disco, y vuelve a abrir Magister."
fi

# 6. El token de Claude (tu cuenta, con tu suscripción)
token_valido() { grep -q '^sk-ant-' "$SECRETOS/claude_token" 2>/dev/null; }
if ! token_valido; then
  decir "------------------------------------------------------------------
Falta conectar Magister con tu cuenta de Claude (Pro o Max). Se hace una sola vez:
  1. Se abrirá el navegador: inicia sesión en Claude y pulsa «Authorize».
  2. Te enseñará un código: cópialo, vuelve a esta ventana, pégalo (Cmd+V) y pulsa Intro.
Lo demás lo hago yo.
------------------------------------------------------------------"
  read -r -p "Pulsa Intro para empezar. " _ || true
  rm -f "$SECRETOS/.enlace"
  vigilar_enlace &
  VIGIA=$!
  USUARIO=()
  # En Linux la carpeta montada es de tu usuario: claude corre con tu uid para poder escribir el token en ella.
  if [ "$SISTEMA" = "Linux" ]; then USUARIO=(--user "$(id -u):$(id -g)" -e HOME=/tmp); fi
  # ${USUARIO[@]+...}: el bash de los Mac (3.2) no deja usar un array vacío con set -u.
  docker run --rm -it ${USUARIO[@]+"${USUARIO[@]}"} -v "$(cd "$SECRETOS" && pwd):/salida" \
    --entrypoint python "$IMAGEN_API" /app/token_claude.py /salida
  kill "$VIGIA" >/dev/null 2>&1
  rm -f "$SECRETOS/.enlace"
  if token_valido; then
    decir "Hecho: Magister ya está conectado con tu cuenta de Claude."
  else
    # Plan B: pegarlo a mano.
    printf '\n'
    read -r -p "No he visto el token. Si en pantalla hay uno que empieza por sk-ant-, cópialo, pégalo aquí y pulsa Intro: " token || true
    token="$(printf '%s' "${token:-}" | tr -d ' \r\n')"
    case "$token" in
      sk-ant-*) printf '%s' "$token" > "$SECRETOS/claude_token"; chmod 644 "$SECRETOS/claude_token" ;;
      *) salir "Sin el token no puedo conectar con Claude. Vuelve a hacer doble clic en Magister para intentarlo otra vez." ;;
    esac
  fi
fi

# 7. Levantar todo
MAGISTER_DOCKER_DB_CLAVE="$(cat "$SECRETOS/postgres_password")"
export MAGISTER_DOCKER_DB_CLAVE
decir "Arrancando Magister..."
if [ "$MODO" = paquete ]; then
  "${COMPOSE[@]}" up -d --no-build
else
  "${COMPOSE[@]}" up -d
fi
if [ $? -ne 0 ]; then
  if ! (exec 3<>"/dev/tcp/127.0.0.1/$PUERTO") 2>/dev/null; then
    salir "Magister no ha arrancado. Reinicia Docker (icono de la ballena → Restart) y vuelve a hacer doble clic en Magister."
  fi
  salir "Magister no ha arrancado: otro programa está usando el puerto $PUERTO. Ciérralo (o reinicia el equipo) y
vuelve a hacer doble clic en Magister."
fi

# 8. Esperar y abrir el navegador
decir "Esperando a que responda (la primera vez, un par de minutos)..."
for _ in $(seq 1 300); do responde && break; sleep 2; done
responde || salir "Magister no responde en $URL. Espera un minuto y vuelve a hacer doble clic en Magister.
Si sigue sin responder, reinicia Docker (icono de la ballena → Restart) y prueba otra vez."
abrir_enlace "$URL"
decir "Magister está en marcha en $URL
Puedes cerrar esta ventana: sigue funcionando hasta que apagues Docker o el equipo.
Para pararlo: $PARAR"
