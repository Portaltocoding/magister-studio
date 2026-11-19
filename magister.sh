#!/usr/bin/env bash
# Magister Studio con Docker, para Mac y Linux. En Mac se abre con doble clic en Magister.command; en Linux, con
# ./magister.sh desde una terminal (o «Ejecutar como programa»). ./magister.sh parar lo apaga.
#
# Comprueba Docker, prepara la primera vez los secretos (contraseña de la base, canario y tu token de Claude),
# levanta base, API y web con `docker compose --profile docker up -d --build`, espera a que responda y abre el navegador.
set -u
cd "$(dirname "$0")" || exit 1
export PATH="$PATH:/usr/local/bin:/opt/homebrew/bin:/Applications/Docker.app/Contents/Resources/bin"

PUERTO="${MAGISTER_DOCKER_PUERTO_WEB:-8080}"
URL="http://localhost:$PUERTO"
SALUD="http://127.0.0.1:$PUERTO/api/salud"
# COMPOSE_PROJECT_NAME solo para probar una instalación aparte (ver docs/instalar.md); por defecto, el de compose.yaml.
PROYECTO="${COMPOSE_PROJECT_NAME:-magister-studio}"
VOLUMEN_DATOS="${PROYECTO}_magister-studio-datos"
IMAGEN_API="${PROYECTO}-api"
SISTEMA="$(uname -s)"

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

abrir() {
  if [ "$SISTEMA" = "Darwin" ]; then
    open "$URL"
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$URL" >/dev/null 2>&1 &
  else
    decir "Abre esta dirección en tu navegador: $URL"
  fi
}

aleatorio() { LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c "$1"; }

echo "=== Magister Studio ==="

# 1. Docker instalado
if ! command -v docker >/dev/null 2>&1; then
  if [ "$SISTEMA" = "Darwin" ]; then
    salir "No encuentro Docker. Instala Docker Desktop para Mac desde
  https://www.docker.com/products/docker-desktop/
(elige «Apple Silicon» si tu Mac tiene chip M1, M2, M3 o M4; si no, «Intel»).
Ábrelo una vez, acepta las condiciones y vuelve a abrir Magister."
  else
    salir "No encuentro Docker. Instálalo siguiendo la guía de tu distribución:
  https://docs.docker.com/engine/install/
y vuelve a abrir Magister."
  fi
fi
if ! docker compose version >/dev/null 2>&1; then
  salir "Tu Docker no trae «docker compose». Actualiza Docker Desktop, o en Linux instala el paquete
docker-compose-plugin, y vuelve a abrir Magister."
fi

# 2. Docker en marcha
if ! docker info >/dev/null 2>&1; then
  if [ "$SISTEMA" = "Darwin" ]; then
    decir "Abriendo Docker Desktop (puede tardar un minuto)..."
    open -a Docker >/dev/null 2>&1 || salir "No he podido abrir Docker Desktop. Ábrelo tú desde Aplicaciones y vuelve a abrir Magister."
  elif docker info 2>&1 | grep -qi "permission denied"; then
    salir "Tu usuario no tiene permiso para usar Docker. En una terminal, escribe:
  sudo usermod -aG docker \$USER
cierra la sesión del equipo, vuelve a entrar y abre Magister otra vez."
  else
    decir "Docker no está en marcha. Intento arrancarlo (puede pedirte tu contraseña)..."
    systemctl --user start docker-desktop >/dev/null 2>&1 || sudo systemctl start docker || true
  fi
  for _ in $(seq 1 90); do docker info >/dev/null 2>&1 && break; sleep 2; done
  docker info >/dev/null 2>&1 || salir "Docker no termina de arrancar. Ábrelo tú, espera a que diga que está en marcha
(«Engine running») y vuelve a abrir Magister."
fi

if [ "${1:-}" = "parar" ]; then
  docker compose --profile docker stop && decir "Magister está parado. Tus datos siguen guardados."
  exit 0
fi

# 3. ¿Ya está en marcha?
if responde; then
  decir "Magister ya está en marcha: abro $URL"
  abrir
  exit 0
fi

# 4. Secretos de la primera vez (carpeta secretos/, fuera de git)
mkdir -p secretos && chmod 700 secretos
[ -f .env.compose ] || cp .env.compose.example .env.compose

if [ ! -s secretos/postgres_password ]; then
  if docker volume inspect "$VOLUMEN_DATOS" >/dev/null 2>&1; then
    salir "Ya hay datos de Magister en este equipo, pero falta el fichero secretos/postgres_password
(la contraseña de esa base). Si has descargado Magister de nuevo en otra carpeta, copia aquí la carpeta
«secretos» de la instalación anterior y vuelve a abrir Magister. No borro ni toco nada."
  fi
  aleatorio 32 > secretos/postgres_password
fi
if [ ! -s secretos/canario ]; then
  printf 'mg-%s' "$(LC_ALL=C tr -dc 'a-f0-9' </dev/urandom | head -c 32)" > secretos/canario
fi
chmod 644 secretos/postgres_password secretos/canario  # el contenedor los lee con otro usuario

# 5. El token de Claude (tu cuenta, con tu suscripción)
token_valido() { grep -q '^sk-ant-' secretos/claude_token 2>/dev/null; }
if ! token_valido; then
  decir "------------------------------------------------------------------
Falta tu token de Claude. Magister habla con Claude usando TU cuenta (Pro o Max).
Se hace una sola vez:
  1. Se abrirá un enlace para iniciar sesión en Claude con tu cuenta.
  2. Al terminar, verás en pantalla un token largo que empieza por sk-ant-
  3. Cópialo y pégalo aquí cuando te lo pida.
También puedes pegarlo tú en el fichero secretos/claude_token (dentro de esta carpeta).
------------------------------------------------------------------"
  read -r -p "Pulsa Intro para empezar. " _ || true
  if command -v claude >/dev/null 2>&1; then
    claude setup-token
  else
    decir "Preparando Magister (la primera vez descarga varios GB y puede tardar de 10 a 40 minutos)..."
    docker build -t "$IMAGEN_API" servidor || salir "No he podido preparar Magister. Mira el mensaje de arriba
y comprueba que tienes conexión a internet y espacio en el disco."
    decir "Ahora sigue las instrucciones: abre el enlace que sale, inicia sesión y copia el código que te dan."
    docker run --rm -it --entrypoint claude "$IMAGEN_API" setup-token
  fi
  printf '\n'
  read -r -p "Pega aquí el token (empieza por sk-ant-) y pulsa Intro: " token || true
  token="$(printf '%s' "${token:-}" | tr -d ' \r\n')"
  case "$token" in
    sk-ant-*) printf '%s' "$token" > secretos/claude_token; chmod 644 secretos/claude_token ;;
    *) salir "Eso no parece un token (debe empezar por sk-ant-). Vuelve a abrir Magister para intentarlo otra vez." ;;
  esac
fi

# 6. Levantar todo
MAGISTER_DOCKER_DB_CLAVE="$(cat secretos/postgres_password)"
export MAGISTER_DOCKER_DB_CLAVE
decir "Arrancando Magister (la primera vez tarda bastante: descarga y prepara todo)..."
if ! docker compose --profile docker up -d --build; then
  salir "Magister no ha arrancado. Para ver qué ha pasado, abre una terminal en esta carpeta y escribe:
  docker compose --profile docker logs api"
fi

# 7. Esperar y abrir el navegador
decir "Esperando a que responda..."
for _ in $(seq 1 300); do responde && break; sleep 2; done
responde || salir "Magister no responde en $URL. Para ver qué pasa:
  docker compose --profile docker logs api"
abrir
decir "Magister está en marcha en $URL
Puedes cerrar esta ventana: sigue funcionando hasta que apagues Docker o el equipo.
Para pararlo: ./magister.sh parar"
