#!/usr/bin/env bash
# Prepara, en un runner de Windows (bash de Git y 7z), lo que lleva dentro Magister-Windows-sin-Docker.zip:
#   postgres/ (Postgres 16 portable de EDB + pgvector construido con MSVC), ffmpeg/, node/, pandoc/, poppler/, uv/,
#   piper/ y voces/ (la voz), git/ (PortableGit, lo necesita Claude en Windows).
# Uso: bash scripts/herramientas-windows.sh <carpeta de salida>
# Cada pieza se comprueba al terminar (initdb, CREATE EXTENSION vector, «Hola» con cada voz): si algo falla, el job falla.
set -euo pipefail
out="$(mkdir -p "${1:?falta la carpeta de salida}" && cd "$1" && pwd)"
tmp="${RUNNER_TEMP:-/tmp}/herramientas"; mkdir -p "$tmp"

PG_ZIP="postgresql-16.6-1-windows-x64-binaries.zip"
PGVECTOR_VERSION=0.8.0
PIPER_VERSION=2023.11.14-2
PIPER_VOCES_REV=e7229f7d33a10e145e109b886d661984201ac3c4
UV_VERSION=0.13.6
NODE_VERSION=22.12.0
PANDOC_VERSION=3.6.1
POPPLER_VERSION=24.08.0-0
GIT_VERSION=2.47.1

bajar() { curl -fsSL --retry 3 -o "$2" "$1"; }

# --- Postgres 16 (EDB, portable) sin lo que sobra (pgAdmin, documentación, StackBuilder) ---
bajar "https://get.enterprisedb.com/postgresql/$PG_ZIP" "$tmp/pg.zip"
7z x -y -o"$tmp/pg" "$tmp/pg.zip" >/dev/null
mv "$tmp/pg/pgsql" "$out/postgres"
rm -rf "$out/postgres/pgAdmin 4" "$out/postgres/doc" "$out/postgres/StackBuilder" "$out/postgres/symbols"

# --- pgvector, construido para ese Postgres (Makefile.win de pgvector, con nmake) ---
git clone --quiet --branch "v$PGVECTOR_VERSION" --depth 1 https://github.com/pgvector/pgvector.git "$tmp/pgvector"
vcvars="$("/c/Program Files (x86)/Microsoft Visual Studio/Installer/vswhere.exe" -latest -products '*' \
  -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath)/VC/Auxiliary/Build/vcvars64.bat"
test -f "$vcvars" || { echo "No encuentro vcvars64.bat"; exit 1; }
pgroot_win="$(cygpath -w "$out/postgres")"
cat > "$tmp/pgvector/construir.bat" <<EOF
@echo off
call "$(cygpath -w "$vcvars")" || exit /b 1
set "PGROOT=$pgroot_win"
cd /d "$(cygpath -w "$tmp/pgvector")"
nmake /NOLOGO /F Makefile.win || exit /b 1
nmake /NOLOGO /F Makefile.win install || exit /b 1
EOF
cmd //c "$(cygpath -w "$tmp/pgvector/construir.bat")"
test -f "$out/postgres/lib/vector.dll"
test -f "$out/postgres/share/extension/vector.control"

# Prueba: un clúster de usar y tirar, la extensión creada y a apagar (lo mismo que hará el arrancador).
prueba="$tmp/prueba-pg"
echo -n prueba > "$tmp/clave.txt"
"$out/postgres/bin/initdb.exe" -D "$prueba" -U magister --pwfile="$tmp/clave.txt" -A scram-sha-256 -E UTF8 --locale=C >/dev/null
"$out/postgres/bin/pg_ctl.exe" start -D "$prueba" -w -o "-p 5499 -c listen_addresses=127.0.0.1" -l "$tmp/prueba-pg.log" >/dev/null
PGPASSWORD=prueba "$out/postgres/bin/psql.exe" -h 127.0.0.1 -p 5499 -U magister -d postgres -v ON_ERROR_STOP=1 \
  -c "CREATE EXTENSION vector" -c "SELECT '[1,2,3]'::vector <-> '[1,2,4]'::vector"
"$out/postgres/bin/pg_ctl.exe" stop -D "$prueba" -m fast >/dev/null
rm -rf "$prueba"

# --- ffmpeg (build GPL de BtbN: trae libx264, que usa el montaje de vídeos) ---
bajar "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip" "$tmp/ffmpeg.zip"
7z x -y -o"$tmp/ffmpeg" "$tmp/ffmpeg.zip" >/dev/null
mkdir -p "$out/ffmpeg"
cp "$tmp"/ffmpeg/*/bin/ffmpeg.exe "$out/ffmpeg/"
"$out/ffmpeg/ffmpeg.exe" -hide_banner -encoders 2>/dev/null | grep -q libx264

# --- Piper para Windows y las dos voces en español (fijadas a la misma revisión que el Dockerfile) ---
bajar "https://github.com/rhasspy/piper/releases/download/$PIPER_VERSION/piper_windows_amd64.zip" "$tmp/piper.zip"
mkdir -p "$out/piper" "$out/voces"
7z x -y -o"$out/piper" "$tmp/piper.zip" >/dev/null
voces="https://huggingface.co/rhasspy/piper-voices/resolve/$PIPER_VOCES_REV/es/es_ES"
for v in sharvard davefx; do for ext in onnx onnx.json; do
  bajar "$voces/$v/medium/es_ES-$v-medium.$ext" "$out/voces/es_ES-$v-medium.$ext"
done; done
for v in sharvard davefx; do
  echo Hola | "$out/piper/piper/piper.exe" -q --model "$out/voces/es_ES-$v-medium.onnx" --output_file "$tmp/prueba.wav"
  test -s "$tmp/prueba.wav"; rm -f "$tmp/prueba.wav"
done

# --- uv ---
bajar "https://github.com/astral-sh/uv/releases/download/$UV_VERSION/uv-x86_64-pc-windows-msvc.zip" "$tmp/uv.zip"
mkdir -p "$out/uv"; 7z x -y -o"$out/uv" "$tmp/uv.zip" >/dev/null
test -f "$out/uv/uv.exe"

# --- Node (para Marp y el motor del PDF), pandoc y poppler (pdftotext) ---
bajar "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-win-x64.zip" "$tmp/node.zip"
7z x -y -o"$tmp/node" "$tmp/node.zip" >/dev/null
mv "$tmp/node/node-v$NODE_VERSION-win-x64" "$out/node"
rm -rf "$out/node/node_modules/npm/docs" "$out/node/node_modules/npm/man"
test -f "$out/node/npx.cmd"

bajar "https://github.com/jgm/pandoc/releases/download/$PANDOC_VERSION/pandoc-$PANDOC_VERSION-windows-x86_64.zip" "$tmp/pandoc.zip"
7z x -y -o"$tmp/pandoc" "$tmp/pandoc.zip" >/dev/null
mv "$tmp/pandoc/pandoc-$PANDOC_VERSION" "$out/pandoc"
test -f "$out/pandoc/pandoc.exe"

bajar "https://github.com/oschwartz10612/poppler-windows/releases/download/v$POPPLER_VERSION/Release-$POPPLER_VERSION.zip" "$tmp/poppler.zip"
7z x -y -o"$tmp/poppler" "$tmp/poppler.zip" >/dev/null
mkdir -p "$out/poppler"
mv "$tmp"/poppler/poppler-*/Library/bin "$out/poppler/bin"
test -f "$out/poppler/bin/pdftotext.exe"

# --- Git portable (Claude lo necesita en Windows; el arrancador lo descomprime solo si el equipo no tiene Git) ---
mkdir -p "$out/git"
bajar "https://github.com/git-for-windows/git/releases/download/v$GIT_VERSION.windows.1/PortableGit-$GIT_VERSION-64-bit.7z.exe" "$out/git/PortableGit-$GIT_VERSION-64-bit.7z.exe"

du -sh "$out"/* | sort -h
