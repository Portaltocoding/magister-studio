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
# ffmpeg: release con fecha de BtbN (inmutable), no «latest».
FFMPEG_TAG=autobuild-2026-11-19-12-39
FFMPEG_ZIP=ffmpeg-N-129130-gcd39c36377-win64-gpl.zip

# SHA-256 esperados, uno por pieza. Si una pieza cambia (otra versión), hay que actualizar aquí su suma.
#   «publisher»: suma publicada por quien la distribuye; «calculada»: la sacamos al descargar la pieza una vez
#   en una máquina de confianza (la fuente no publica suma), así que fija la pieza pero no la autentica de origen.
SHA_PG=6a1bfb6435b13d9563ae481445c70ac2a19846bd8a430b12903b408eec300f9b          # calculada (EDB no publica SHA-256)
PGVECTOR_COMMIT=2627c5ff775ae6d7aef0c430121ccf857842d2f2                          # commit de la etiqueta v0.8.0 (API de GitHub)
SHA_FFMPEG=031313713513cee07de80a0ef27698d90bda703eab3bf09044a4fcb9a21aeb4e       # publisher: digest del asset en la release de GitHub
SHA_PIPER=f3c58906402b24f3a96d92145f58acba6d86c9b5db896d207f78dc80811efcea        # calculada (la release no publica suma)
SHA_VOZ_SHARVARD_ONNX=40febfb1679c69a4505ff311dc136e121e3419a13a290ef264fdf43ddedd0fb1       # calculada (revisión fija de Hugging Face)
SHA_VOZ_SHARVARD_JSON=7438c9b699c72b0c3388dae1b68d3f364dc66a2150fe554a1c11f03372957b2c        # calculada
SHA_VOZ_DAVEFX_ONNX=6658b03b1a6c316ee4c265a9896abc1393353c2d9e1bca7d66c2c442e222a917          # calculada
SHA_VOZ_DAVEFX_JSON=0e0dda87c732f6f38771ff274a6380d9252f327dca77aa2963d5fbdf9ec54842          # calculada
SHA_UV=a2a8820d5eea32f08ef467ef3b7f66883a9b076d5737a2fc2fbb5f458d1bb50f           # publisher: digest del asset en la release de GitHub
SHA_NODE=2b8f2256382f97ad51e29ff71f702961af466c4616393f767455501e6aece9b8         # publisher: SHASUMS256.txt de nodejs.org
SHA_PANDOC=a9f2b30e151eff6c18017151af7aab68f7875e892ff9899dadc9770af228b2a2       # calculada (la release no publica suma)
SHA_POPPLER=58a6f9ae269756231d2f9aa6cba39d75fec6deacaf3c4a50683383b5f3d5a527      # calculada (la release no publica suma)
SHA_GIT=4f3f21f4effcb659566883ee1ed3ae403e5b3d7a0699cee455f6cd765e1ac39c          # publisher: notas de la release v2.47.1.windows.1

# bajar URL DESTINO SHA256: descarga a un fichero y comprueba la suma antes de que nadie lo use; si no coincide, el job falla.
bajar() {
  curl -fsSL --retry 3 -o "$2" "$1"
  echo "$3  $2" | sha256sum -c - >/dev/null || { echo "ERROR: la suma SHA-256 de $1 no coincide con la esperada ($3). No se usa." >&2; rm -f "$2"; exit 1; }
}

# --- Postgres 16 (EDB, portable) sin lo que sobra (pgAdmin, documentación, StackBuilder) ---
bajar "https://get.enterprisedb.com/postgresql/$PG_ZIP" "$tmp/pg.zip" "$SHA_PG"
7z x -y -o"$tmp/pg" "$tmp/pg.zip" >/dev/null
mv "$tmp/pg/pgsql" "$out/postgres"
rm -rf "$out/postgres/pgAdmin 4" "$out/postgres/doc" "$out/postgres/StackBuilder" "$out/postgres/symbols"

# --- pgvector, construido para ese Postgres (Makefile.win de pgvector, con nmake) ---
git clone --quiet --branch "v$PGVECTOR_VERSION" --depth 1 https://github.com/pgvector/pgvector.git "$tmp/pgvector"
# Una etiqueta se puede mover: se exige el commit exacto antes de construir.
test "$(git -C "$tmp/pgvector" rev-parse HEAD)" = "$PGVECTOR_COMMIT" \
  || { echo "ERROR: pgvector v$PGVECTOR_VERSION no apunta al commit esperado ($PGVECTOR_COMMIT). No se construye." >&2; exit 1; }
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
bajar "https://github.com/BtbN/FFmpeg-Builds/releases/download/$FFMPEG_TAG/$FFMPEG_ZIP" "$tmp/ffmpeg.zip" "$SHA_FFMPEG"
7z x -y -o"$tmp/ffmpeg" "$tmp/ffmpeg.zip" >/dev/null
mkdir -p "$out/ffmpeg"
cp "$tmp"/ffmpeg/*/bin/ffmpeg.exe "$out/ffmpeg/"
"$out/ffmpeg/ffmpeg.exe" -hide_banner -encoders 2>/dev/null | grep -q libx264

# --- Piper para Windows y las dos voces en español (fijadas a la misma revisión que el Dockerfile) ---
bajar "https://github.com/rhasspy/piper/releases/download/$PIPER_VERSION/piper_windows_amd64.zip" "$tmp/piper.zip" "$SHA_PIPER"
mkdir -p "$out/piper" "$out/voces"
7z x -y -o"$out/piper" "$tmp/piper.zip" >/dev/null
voces="https://huggingface.co/rhasspy/piper-voices/resolve/$PIPER_VOCES_REV/es/es_ES"
bajar "$voces/sharvard/medium/es_ES-sharvard-medium.onnx" "$out/voces/es_ES-sharvard-medium.onnx" "$SHA_VOZ_SHARVARD_ONNX"
bajar "$voces/sharvard/medium/es_ES-sharvard-medium.onnx.json" "$out/voces/es_ES-sharvard-medium.onnx.json" "$SHA_VOZ_SHARVARD_JSON"
bajar "$voces/davefx/medium/es_ES-davefx-medium.onnx" "$out/voces/es_ES-davefx-medium.onnx" "$SHA_VOZ_DAVEFX_ONNX"
bajar "$voces/davefx/medium/es_ES-davefx-medium.onnx.json" "$out/voces/es_ES-davefx-medium.onnx.json" "$SHA_VOZ_DAVEFX_JSON"
for v in sharvard davefx; do
  echo Hola | "$out/piper/piper/piper.exe" -q --model "$out/voces/es_ES-$v-medium.onnx" --output_file "$tmp/prueba.wav"
  test -s "$tmp/prueba.wav"; rm -f "$tmp/prueba.wav"
done

# --- uv ---
bajar "https://github.com/astral-sh/uv/releases/download/$UV_VERSION/uv-x86_64-pc-windows-msvc.zip" "$tmp/uv.zip" "$SHA_UV"
mkdir -p "$out/uv"; 7z x -y -o"$out/uv" "$tmp/uv.zip" >/dev/null
test -f "$out/uv/uv.exe"

# --- Node (para Marp y el motor del PDF), pandoc y poppler (pdftotext) ---
bajar "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-win-x64.zip" "$tmp/node.zip" "$SHA_NODE"
7z x -y -o"$tmp/node" "$tmp/node.zip" >/dev/null
mv "$tmp/node/node-v$NODE_VERSION-win-x64" "$out/node"
rm -rf "$out/node/node_modules/npm/docs" "$out/node/node_modules/npm/man"
test -f "$out/node/npx.cmd"

bajar "https://github.com/jgm/pandoc/releases/download/$PANDOC_VERSION/pandoc-$PANDOC_VERSION-windows-x86_64.zip" "$tmp/pandoc.zip" "$SHA_PANDOC"
7z x -y -o"$tmp/pandoc" "$tmp/pandoc.zip" >/dev/null
mv "$tmp/pandoc/pandoc-$PANDOC_VERSION" "$out/pandoc"
test -f "$out/pandoc/pandoc.exe"

bajar "https://github.com/oschwartz10612/poppler-windows/releases/download/v$POPPLER_VERSION/Release-$POPPLER_VERSION.zip" "$tmp/poppler.zip" "$SHA_POPPLER"
7z x -y -o"$tmp/poppler" "$tmp/poppler.zip" >/dev/null
mkdir -p "$out/poppler"
mv "$tmp"/poppler/poppler-*/Library/bin "$out/poppler/bin"
test -f "$out/poppler/bin/pdftotext.exe"

# --- Git portable (Claude lo necesita en Windows; el arrancador lo descomprime solo si el equipo no tiene Git) ---
mkdir -p "$out/git"
bajar "https://github.com/git-for-windows/git/releases/download/v$GIT_VERSION.windows.1/PortableGit-$GIT_VERSION-64-bit.7z.exe" "$out/git/PortableGit-$GIT_VERSION-64-bit.7z.exe" "$SHA_GIT"

du -sh "$out"/* | sort -h
