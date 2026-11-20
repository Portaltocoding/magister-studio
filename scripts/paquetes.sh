#!/usr/bin/env bash
# Monta Magister-Windows.zip y Magister-Mac.zip: lo justo para usar Magister con las imágenes de ghcr.io, sin código.
# Lo lanza .github/workflows/imagenes.yaml al publicar una etiqueta v*; a mano: bash scripts/paquetes.sh [carpeta]
# (por defecto dist/). SIN_ZIP=1 deja solo las carpetas montadas, para mirarlas o validar el compose.
#
# Cada paquete, sin carpeta de primer nivel (al descomprimir, el sistema ya crea una):
#   LEEME.txt, el arrancador de doble clic y el de parar,
#   sistema/: compose.yaml (solo image:), magister.env, crear_bases.sql, seccomp-chromium.json y el arrancador real.
set -euo pipefail
raiz="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "${1:-$raiz/dist}"
destino="$(cd "${1:-$raiz/dist}" && pwd)"
d="$raiz/distribucion"

montar_sistema() {
  mkdir -p "$1/sistema"
  cp "$d/compose.yaml" "$d/magister.env" "$1/sistema/"
  cp "$raiz/servidor/scripts/crear_bases.sql" "$raiz/servidor/seccomp-chromium.json" "$1/sistema/"
}

win="$destino/Magister-Windows"
mac="$destino/Magister-Mac"
rm -rf "$win" "$mac" "$destino/Magister-Windows.zip" "$destino/Magister-Mac.zip"

montar_sistema "$win"
cp "$raiz/Magister-docker.ps1" "$win/sistema/"
cp "$raiz/Magister-docker.bat" "$win/Magister.bat"
cp "$d/Parar Magister.bat" "$win/"
cp "$d/LEEME-Windows.txt" "$win/LEEME.txt"

montar_sistema "$mac"
cp "$raiz/magister.sh" "$mac/sistema/"
cp "$raiz/Magister.command" "$d/Parar Magister.command" "$mac/"
cp "$d/LEEME-Mac.txt" "$mac/LEEME.txt"
chmod 755 "$mac/Magister.command" "$mac/Parar Magister.command" "$mac/sistema/magister.sh"

if [ "${SIN_ZIP:-0}" != "1" ]; then
  # -X sin atributos extra; zip guarda los permisos de Unix (el Mac respeta el +x de los .command).
  (cd "$win" && zip -qrX "$destino/Magister-Windows.zip" .)
  (cd "$mac" && zip -qrX "$destino/Magister-Mac.zip" .)
  ls -l "$destino"/*.zip
fi
