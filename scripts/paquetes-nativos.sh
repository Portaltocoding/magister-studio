#!/usr/bin/env bash
# Monta los paquetes SIN Docker: Magister-Mac-sin-Docker.zip y Magister-Windows-sin-Docker.zip. A diferencia de los de
# Docker, llevan el código (servidor/ y web/dist) y el arrancador instala o trae todo lo demás.
# Lo lanza .github/workflows/imagenes.yaml al publicar una etiqueta v*. A mano:
#   bash scripts/paquetes-nativos.sh mac <carpeta>
#   bash scripts/paquetes-nativos.sh windows <carpeta> <herramientas>   (herramientas: la salida de herramientas-windows.sh)
# Necesita web/dist ya construida (npm ci && npm run build en web/). SIN_ZIP=1 deja solo la carpeta montada.
#
# Estructura de cada paquete (como el repo, para que el servidor encuentre web/dist y docs/ donde siempre):
#   LEEME.txt, el arrancador de doble clic y el de parar, servidor/, web/dist/, docs/ (tono, glosario, rúbrica) y sistema/.
set -euo pipefail
cual="${1:?uso: paquetes-nativos.sh mac|windows <carpeta> [herramientas]}"
raiz="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "${2:?falta la carpeta de salida}"
destino="$(cd "$2" && pwd)"
d="$raiz/distribucion/nativo"
test -f "$raiz/web/dist/index.html" || { echo "Falta web/dist: construye la página antes (cd web && npm ci && npm run build)."; exit 1; }

montar_codigo() {
  local p="$1"
  mkdir -p "$p/servidor" "$p/web" "$p/docs" "$p/sistema"
  cp "$raiz/servidor/pyproject.toml" "$raiz/servidor/uv.lock" "$raiz/servidor/README.md" "$raiz/servidor/alembic.ini" "$p/servidor/"
  cp -r "$raiz/servidor/src" "$raiz/servidor/migraciones" "$raiz/servidor/config" "$raiz/servidor/evals" "$p/servidor/"
  rm -rf "$p/servidor/evals/resultados"
  cp -r "$raiz/web/dist" "$p/web/dist"
  cp "$raiz/docs/tono.md" "$raiz/docs/glosario.md" "$raiz/docs/rubrica.md" "$p/docs/"
  cp "$raiz/LICENSE" "$raiz/CREDITOS.md" "$p/" 2>/dev/null || true
  find "$p" -name __pycache__ -type d -prune -exec rm -rf {} +
}

case "$cual" in
  mac)
    p="$destino/Magister-Mac-sin-Docker"
    rm -rf "$p" "$p.zip"
    montar_codigo "$p"
    cp "$d/magister-nativo.sh" "$p/sistema/"
    cp "$d/Magister-sin-Docker.command" "$p/Magister (sin Docker).command"
    cp "$d/Parar-sin-Docker.command" "$p/Parar Magister (sin Docker).command"
    cp "$d/LEEME-Mac-nativo.txt" "$p/LEEME.txt"
    chmod 755 "$p"/*.command "$p/sistema/magister-nativo.sh"
    # -X sin atributos extra; zip guarda los permisos de Unix (el Mac respeta el +x de los .command).
    if [ "${SIN_ZIP:-0}" != "1" ]; then (cd "$p" && zip -qrX "$destino/Magister-Mac-sin-Docker.zip" .); ls -l "$destino/Magister-Mac-sin-Docker.zip"; fi
    ;;
  windows)
    h="$(cd "${3:?falta la carpeta de herramientas}" && pwd)"
    p="$destino/Magister-Windows-sin-Docker"
    rm -rf "$p" "$p.zip"
    montar_codigo "$p"
    # postgres/, ffmpeg/, node/, pandoc/, poppler/, piper/, voces/, uv/ y git/: lo que dejó herramientas-windows.sh.
    cp -r "$h"/. "$p/sistema/"
    cp "$d/Magister-nativo.ps1" "$p/sistema/"
    cp "$d/Magister-nativo.bat" "$p/Magister.bat"
    cp "$d/Parar-nativo.bat" "$p/Parar Magister.bat"
    cp "$d/LEEME-Windows-nativo.txt" "$p/LEEME.txt"
    if [ "${SIN_ZIP:-0}" != "1" ]; then
      # 7z viene en los runners de Windows; zip no.
      (cd "$p" && 7z a -tzip -mx=5 "$destino/Magister-Windows-sin-Docker.zip" . >/dev/null)
      ls -l "$destino/Magister-Windows-sin-Docker.zip"
    fi
    ;;
  *) echo "Se esperaba mac o windows"; exit 1 ;;
esac
