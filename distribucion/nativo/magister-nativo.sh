#!/usr/bin/env bash
# Magister Studio en Mac SIN Docker (paquete Magister-Mac-sin-Docker.zip, en sistema/). Se abre con doble clic en
# «Magister (sin Docker).command» y «bash magister-nativo.sh parar» lo apaga.
# Instala lo que falta con Homebrew (Postgres 16, ffmpeg, uv, Node, pandoc, poppler), construye pgvector para ese
# Postgres, crea una base privada en ~/Magister/datos (puerto libre desde 5434) con la contraseña guardada en
# ~/Magister/secretos, aplica las migraciones y abre Magister en http://localhost:8080.
# Para probar una instalación aparte: MAGISTER_NATIVO_DATOS (carpeta), MAGISTER_NATIVO_PUERTO y MAGISTER_NATIVO_PUERTO_DB.
set -u
AQUI="$(cd "$(dirname "$0")" && pwd)" || exit 1
RAIZ="$(dirname "$AQUI")"
BASE="${MAGISTER_NATIVO_DATOS:-$HOME/Magister}"
PUERTO="${MAGISTER_NATIVO_PUERTO:-8080}"
PUERTO_DB_IDEAL="${MAGISTER_NATIVO_PUERTO_DB:-5434}"
URL="http://localhost:$PUERTO"
SALUD="http://127.0.0.1:$PUERTO/api/salud"
DATOS="$BASE/datos"
SECRETOS="$BASE/secretos"
CLUSTER="$DATOS/pg"
VENV="$DATOS/venv"
REGISTROS="$DATOS/registros"
PGVECTOR_VERSION=0.8.0
PIPER_VERSION=2023.11.14-2
PIPER_VOCES_REV=e7229f7d33a10e145e109b886d661984201ac3c4

# SHA-256 de lo que se descarga (todo fijado a una versión). Todas son «calculadas»: ni GitHub ni Hugging Face
# publican una suma para estos ficheros, así que se sacaron al descargarlos una vez; fijan la pieza, no la autentican.
SHA_PGVECTOR=867a2c328d4928a5a9d6f052cd3bc78c7d60228a9b914ad32aa3db88e9de27b0   # tarball de pgvector v0.8.0
SHA_PIPER_AARCH64=6b1eb03b3735946cb35216e063e7eebcc33a6bbf5dd96ec0217959bf1cdcb0cc
SHA_PIPER_X64=ced85c0a3df13945b1e623b878a48fdc2854d5c485b4b67f62857cf551deaf8b
SHA_VOZ_SHARVARD_ONNX=40febfb1679c69a4505ff311dc136e121e3419a13a290ef264fdf43ddedd0fb1
SHA_VOZ_SHARVARD_JSON=7438c9b699c72b0c3388dae1b68d3f364dc66a2150fe554a1c11f03372957b2c
SHA_VOZ_DAVEFX_ONNX=6658b03b1a6c316ee4c265a9896abc1393353c2d9e1bca7d66c2c442e222a917
SHA_VOZ_DAVEFX_JSON=0e0dda87c732f6f38771ff274a6380d9252f327dca77aa2963d5fbdf9ec54842

# Los instaladores oficiales de Homebrew (install.sh) y de Claude (claude.ai/install.sh) se descargan frescos a propósito:
# están pensados para eso (cambian sin avisar, se firman o actualizan ellos mismos) y no se pueden fijar a una suma sin
# dejar la instalación rota en cuanto el proveedor los actualice. Todo lo demás que se baja aquí sí lleva suma.

decir() { printf '\n%s\n' "$*"; }

salir() {
  decir "$*"
  printf '\n'
  read -r -p "Pulsa Intro para cerrar esta ventana. " _ || true
  exit 1
}

responde() { curl -fsS -m 3 -o /dev/null "$SALUD" 2>/dev/null; }

aleatorio() { LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c "$1"; }

# bajar URL DESTINO SHA256: descarga a un fichero y comprueba la suma; si no coincide, borra el fichero y devuelve 42.
bajar() {
  curl -fsSL -o "$2" "$1" || return 1
  if ! echo "$3  $2" | shasum -a 256 -c - >/dev/null 2>&1; then
    echo "La suma SHA-256 de $1 no coincide con la esperada ($3). No se usa." >&2
    rm -f "$2"
    return 42
  fi
}

puerto_ocupado() { lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }

pon_brew_en_el_path() {
  local b
  for b in /opt/homebrew/bin/brew /usr/local/bin/brew; do
    if [ -x "$b" ]; then eval "$("$b" shellenv)"; return 0; fi
  done
  return 1
}

parar() {
  local pg=""
  if [ -f "$DATOS/api.pid" ]; then
    kill "$(cat "$DATOS/api.pid")" 2>/dev/null
    rm -f "$DATOS/api.pid"
  fi
  pon_brew_en_el_path
  command -v brew >/dev/null 2>&1 && pg="$(brew --prefix postgresql@16 2>/dev/null)/bin"
  if [ -f "$CLUSTER/PG_VERSION" ] && [ -x "$pg/pg_ctl" ]; then
    "$pg/pg_ctl" stop -D "$CLUSTER" -m fast >/dev/null 2>&1
  fi
  echo "Magister está apagado. Tus datos se quedan guardados."
}

if [ "${1:-}" = "parar" ]; then parar; sleep 2; exit 0; fi

export PATH="$PATH:$HOME/.local/bin"
if responde; then open "$URL"; exit 0; fi

echo "=== Magister Studio ==="
mkdir -p "$DATOS/crudo" "$DATOS/salidas" "$DATOS/copias" "$DATOS/hf" "$REGISTROS" "$SECRETOS" || salir "No he podido crear la carpeta $BASE."
chmod 700 "$SECRETOS" 2>/dev/null

# 1. Homebrew (el instalador de programas de los Mac). La primera vez pide tu contraseña del Mac en esta ventana.
if ! pon_brew_en_el_path; then
  decir "Voy a instalar Homebrew, el instalador de programas que Magister necesita.
Te pedirá la contraseña de tu Mac (al escribirla no se ve nada, es normal) y que pulses Intro.
Si el Mac abre una ventana para instalar las «herramientas de desarrollo», acéptala: tarda unos minutos y Magister sigue solo."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" \
    || salir "No he podido instalar Homebrew. Comprueba tu conexión a internet y vuelve a abrir Magister."
  pon_brew_en_el_path || salir "Homebrew no se ha instalado bien. Vuelve a abrir Magister; si sigue igual, reinicia el Mac."
fi
export HOMEBREW_NO_AUTO_UPDATE=1 HOMEBREW_NO_ENV_HINTS=1 HOMEBREW_NO_INSTALL_CLEANUP=1

# 2. Programas: lo que ya esté instalado no se toca
FALTAN=""
for f in postgresql@16 ffmpeg uv node pandoc poppler; do
  brew list --formula "$f" >/dev/null 2>&1 || FALTAN="$FALTAN $f"
done
if [ -n "$FALTAN" ]; then
  decir "Instalando programas que Magister necesita:$FALTAN (la primera vez tarda unos minutos)..."
  # shellcheck disable=SC2086
  brew install $FALTAN || salir "No he podido instalar:$FALTAN. Comprueba tu conexión a internet y vuelve a abrir Magister."
fi
PGBIN="$(brew --prefix postgresql@16)/bin"
export PATH="$PGBIN:$PATH"

# pgvector no tiene paquete de Homebrew para Postgres 16: se construye aquí (las herramientas de desarrollo ya están).
if [ ! -f "$("$PGBIN/pg_config" --sharedir)/extension/vector.control" ]; then
  decir "Preparando la búsqueda en tus apuntes (un minuto)..."
  TMP="$(mktemp -d)" || salir "No he podido preparar la búsqueda en tus apuntes."
  ( set -e
    bajar "https://github.com/pgvector/pgvector/archive/refs/tags/v$PGVECTOR_VERSION.tar.gz" "$TMP/pgvector.tar.gz" "$SHA_PGVECTOR"
    tar -xzf "$TMP/pgvector.tar.gz" -C "$TMP"
    cd "$TMP/pgvector-$PGVECTOR_VERSION"
    make OPTFLAGS="" PG_CONFIG="$PGBIN/pg_config"
    make OPTFLAGS="" PG_CONFIG="$PGBIN/pg_config" install ) >"$REGISTROS/pgvector.log" 2>&1
  RC=$?
  rm -rf "$TMP"
  if [ "$RC" = 42 ]; then
    salir "Lo que he descargado para la búsqueda en tus apuntes no es lo que esperaba (no coincide su huella de seguridad), así que no lo uso y paro aquí. Prueba otra vez en unos minutos; si sigue igual, abre una issue en GitHub."
  elif [ "$RC" != 0 ]; then
    salir "No he podido preparar la búsqueda en tus apuntes. Hay más detalles en $REGISTROS/pgvector.log"
  fi
  rm -rf "$TMP"
fi

# 3. Claude (el programa con el que Magister habla con tu cuenta); la cuenta se conecta en la página
if ! command -v claude >/dev/null 2>&1; then
  decir "Instalando Claude (un par de minutos)..."
  curl -fsSL https://claude.ai/install.sh | bash || salir "No he podido instalar Claude. Comprueba tu conexión a internet y vuelve a abrir Magister."
  command -v claude >/dev/null 2>&1 || salir "Claude no se ha instalado bien. Vuelve a abrir Magister."
fi

# 4. El navegador para los PDF: el que haya (Chrome, Edge, Brave o Chromium) y, si no, Chrome
buscar_navegador() {
  local n
  for n in "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" \
           "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser" "/Applications/Chromium.app/Contents/MacOS/Chromium"; do
    if [ -x "$n" ]; then printf '%s' "$n"; return 0; fi
  done
  return 1
}
NAVEGADOR="$(buscar_navegador)"
if [ -z "$NAVEGADOR" ]; then
  decir "Para los apuntes en PDF hace falta Google Chrome: lo instalo (puede pedir tu contraseña)..."
  brew install --cask google-chrome >"$REGISTROS/chrome.log" 2>&1 \
    || decir "No he podido instalar Chrome. Magister funciona igual, pero los apuntes en PDF no saldrán hasta que lo instales."
  NAVEGADOR="$(buscar_navegador)"
fi

# 5. La voz (Piper y dos voces en español), una vez. Si falla, Magister funciona sin voz.
PIPER_DIR="$DATOS/piper"
if [ ! -x "$PIPER_DIR/piper/piper" ]; then
  decir "Descargando la voz de Magister (unos 150 MB)..."
  ( set -e
    case "$(uname -m)" in arm64) arq=aarch64; sha_piper="$SHA_PIPER_AARCH64" ;; *) arq=x64; sha_piper="$SHA_PIPER_X64" ;; esac
    voces="https://huggingface.co/rhasspy/piper-voices/resolve/$PIPER_VOCES_REV/es/es_ES"
    rm -rf "$PIPER_DIR"; mkdir -p "$PIPER_DIR/voces"
    bajar "https://github.com/rhasspy/piper/releases/download/$PIPER_VERSION/piper_macos_$arq.tar.gz" "$PIPER_DIR/piper.tar.gz" "$sha_piper"
    tar -xzf "$PIPER_DIR/piper.tar.gz" -C "$PIPER_DIR"; rm -f "$PIPER_DIR/piper.tar.gz"
    bajar "$voces/sharvard/medium/es_ES-sharvard-medium.onnx" "$PIPER_DIR/voces/es_ES-sharvard-medium.onnx" "$SHA_VOZ_SHARVARD_ONNX"
    bajar "$voces/sharvard/medium/es_ES-sharvard-medium.onnx.json" "$PIPER_DIR/voces/es_ES-sharvard-medium.onnx.json" "$SHA_VOZ_SHARVARD_JSON"
    bajar "$voces/davefx/medium/es_ES-davefx-medium.onnx" "$PIPER_DIR/voces/es_ES-davefx-medium.onnx" "$SHA_VOZ_DAVEFX_ONNX"
    bajar "$voces/davefx/medium/es_ES-davefx-medium.onnx.json" "$PIPER_DIR/voces/es_ES-davefx-medium.onnx.json" "$SHA_VOZ_DAVEFX_JSON"
    echo Hola | "$PIPER_DIR/piper/piper" -q --model "$PIPER_DIR/voces/es_ES-sharvard-medium.onnx" --output_file "$PIPER_DIR/prueba.wav"
    test -s "$PIPER_DIR/prueba.wav"; rm -f "$PIPER_DIR/prueba.wav" ) >"$REGISTROS/piper.log" 2>&1
  RC=$?
  if [ "$RC" = 42 ]; then
    rm -rf "$PIPER_DIR"; decir "Lo que he descargado para la voz no es lo que esperaba (no coincide su huella de seguridad), así que no lo uso: Magister funcionará sin voz."
  elif [ "$RC" != 0 ]; then
    rm -rf "$PIPER_DIR"; decir "No he podido preparar la voz: Magister funcionará sin ella."
  fi
fi

# 6. La base: contraseña generada la primera vez, en secretos/
[ -s "$SECRETOS/postgres_password" ] || { aleatorio 28 > "$SECRETOS/postgres_password"; chmod 600 "$SECRETOS/postgres_password"; }
CLAVE="$(tr -d '\r\n' < "$SECRETOS/postgres_password")"
export PGPASSWORD="$CLAVE"
if [ -s "$DATOS/puerto_db" ]; then
  PUERTO_DB="$(tr -d '\r\n ' < "$DATOS/puerto_db")"
else
  PUERTO_DB="$PUERTO_DB_IDEAL"
  while puerto_ocupado "$PUERTO_DB"; do PUERTO_DB=$((PUERTO_DB + 1)); done
  printf '%s' "$PUERTO_DB" > "$DATOS/puerto_db"
fi

if [ ! -f "$CLUSTER/PG_VERSION" ]; then
  decir "Preparando tu base de datos (solo la primera vez)..."
  PWF="$(mktemp)"; printf '%s' "$CLAVE" > "$PWF"
  if ! "$PGBIN/initdb" -D "$CLUSTER" -U magister --pwfile="$PWF" -A scram-sha-256 -E UTF8 --locale=en_US.UTF-8 >"$REGISTROS/initdb.log" 2>&1; then
    rm -rf "$CLUSTER"
    "$PGBIN/initdb" -D "$CLUSTER" -U magister --pwfile="$PWF" -A scram-sha-256 -E UTF8 --locale=C >"$REGISTROS/initdb.log" 2>&1 \
      || { rm -f "$PWF"; salir "No he podido preparar la base de datos. Hay más detalles en $REGISTROS/initdb.log"; }
  fi
  rm -f "$PWF"
fi
chmod 700 "$CLUSTER" 2>/dev/null

if ! "$PGBIN/pg_ctl" status -D "$CLUSTER" >/dev/null 2>&1; then
  decir "Arrancando la base de datos..."
  puerto_ocupado "$PUERTO_DB" && salir "El puerto $PUERTO_DB está ocupado por otro programa. Ciérralo y vuelve a abrir Magister."
  "$PGBIN/pg_ctl" start -D "$CLUSTER" -w -t 60 -l "$REGISTROS/postgres.log" -o "-p $PUERTO_DB -c listen_addresses=127.0.0.1" >/dev/null 2>&1 \
    || salir "La base de datos no arranca. Hay más detalles en $REGISTROS/postgres.log"
fi
if [ "$("$PGBIN/psql" -h 127.0.0.1 -p "$PUERTO_DB" -U magister -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='magister'")" != "1" ]; then
  "$PGBIN/createdb" -h 127.0.0.1 -p "$PUERTO_DB" -U magister magister || salir "No he podido crear tu base de datos."
fi
"$PGBIN/psql" -h 127.0.0.1 -p "$PUERTO_DB" -U magister -d magister -q -c "CREATE EXTENSION IF NOT EXISTS vector" >/dev/null 2>&1 \
  || salir "A la base de datos le falta una pieza (pgvector). Vuelve a abrir Magister; si sigue igual, abre una issue en GitHub."

# 7. Python y las piezas de Magister (la primera vez descarga unos 2 GB: de 5 a 20 minutos)
export UV_PROJECT_ENVIRONMENT="$VENV" PYTHONUTF8=1
cd "$RAIZ/servidor" || salir "No encuentro la carpeta servidor. Vuelve a descargar Magister."
[ -x "$VENV/bin/python" ] || decir "Instalando las piezas de Magister (solo la primera vez: descarga unos 2 GB y puede tardar entre 5 y 20 minutos)..."
uv sync --frozen --no-dev || { [ -x "$VENV/bin/python" ] || salir "No he podido instalar las piezas de Magister. Comprueba tu conexión a internet y vuelve a abrir Magister."; }
PY="$VENV/bin/python"

# 8. Lo que lee la API (los mismos ajustes que en Docker, con rutas de este equipo)
export MAGISTER_DB_URL="postgresql+asyncpg://magister:${CLAVE}@127.0.0.1:${PUERTO_DB}/magister"
export PGHOST=127.0.0.1 PGPORT="$PUERTO_DB" PGUSER=magister
export MAGISTER_CONTENEDOR_DB="" MAGISTER_COPIAS="$DATOS/copias" MAGISTER_COPIA_DIARIA=true
export MAGISTER_CHECKPOINTS="$DATOS/checkpoints.sqlite" MAGISTER_CRUDO="$DATOS/crudo" MAGISTER_SALIDAS="$DATOS/salidas"
export MAGISTER_REGISTROS="$DATOS/registros" MAGISTER_CLAUDE_TOKEN_FICHERO="$DATOS/claude_token"
export MAGISTER_DIR_SECRETOS="$SECRETOS" MAGISTER_SERVIR_WEB=true MAGISTER_MOTOR=cli MAGISTER_TRABAJOS_EN_API=true
export HF_HOME="$DATOS/hf" PYTHONPATH="$RAIZ/servidor/src"
[ -x "$PIPER_DIR/piper/piper" ] && export MAGISTER_VOZ_PIPER="$PIPER_DIR/piper/piper" MAGISTER_VOZ_DIR="$PIPER_DIR/voces"
[ -n "$NAVEGADOR" ] && export MAGISTER_CHROME="$NAVEGADOR" CHROME_PATH="$NAVEGADOR"

# 9. Los modelos locales (unos 600 MB), una vez, para que nadie espere en la primera pregunta
if [ ! -f "$DATOS/modelos_listos" ]; then
  decir "Descargando lo que Magister usa para buscar en tus apuntes (solo la primera vez, unos 600 MB)..."
  "$PY" -c "from magister.config import ajustes; from sentence_transformers import CrossEncoder, SentenceTransformer; SentenceTransformer(ajustes.embeddings_modelo, device='cpu'); CrossEncoder(ajustes.reranker_modelo, device='cpu')" \
    && touch "$DATOS/modelos_listos"
fi

# 10. La base al día y la API
decir "Poniendo tus datos al día..."
"$PY" -m alembic upgrade head || salir "No he podido poner la base al día. Hay más detalles arriba; si no lo entiendes, abre una issue en GitHub contando qué ves."
"$PY" -m magister.cli indexar --al-arrancar

decir "Arrancando Magister..."
nohup "$PY" -m uvicorn magister.api.app:app --host 127.0.0.1 --port "$PUERTO" >"$REGISTROS/api.log" 2>&1 &
API=$!
echo "$API" > "$DATOS/api.pid"
disown "$API" 2>/dev/null
for _ in $(seq 1 180); do
  responde && break
  kill -0 "$API" 2>/dev/null || break
  sleep 1
done
responde || salir "Magister no ha arrancado. Hay más detalles en $REGISTROS/api.log"
open "$URL"
decir "Magister está abierto en $URL
Puedes cerrar esta ventana: Magister sigue funcionando. Para apagarlo, doble clic en «Parar Magister (sin Docker).command»."
