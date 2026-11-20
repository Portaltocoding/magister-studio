#!/usr/bin/env bash
# Instala Magister Studio en un Mac con una sola línea en Terminal (sin el aviso de «desarrollador no identificado»):
#
#   curl -fsSL https://raw.githubusercontent.com/Portaltocoding/magister-studio/main/instalar-mac.sh | bash
#
# Descarga la última Magister-Mac.zip a ~/Magister (con curl, así no lleva la marca de cuarentena del navegador),
# la descomprime encima de lo que hubiera (tu carpeta secretos/ no está en el zip y no se toca) y arranca Magister.
# Para actualizar se puede volver a pegar la misma línea. MAGISTER_DIR cambia la carpeta.
# Todo va dentro de main(): si la descarga de este script se corta a medias, no se ejecuta nada.
set -u

main() {
  local destino zip_url tmp
  destino="${MAGISTER_DIR:-$HOME/Magister}"
  zip_url="https://github.com/Portaltocoding/magister-studio/releases/latest/download/Magister-Mac.zip"

  echo "=== Instalando Magister Studio en $destino ==="
  mkdir -p "$destino" || { echo "No he podido crear la carpeta $destino."; return 1; }
  tmp="$(mktemp -d)" || return 1
  echo "Descargando Magister..."
  if ! curl -fL --progress-bar -o "$tmp/Magister-Mac.zip" "$zip_url"; then
    rm -rf "$tmp"
    echo "No he podido descargar Magister. Comprueba tu conexión a internet y vuelve a pegar la línea en Terminal."
    return 1
  fi
  if ! unzip -oq "$tmp/Magister-Mac.zip" -d "$destino"; then
    rm -rf "$tmp"
    echo "No he podido descomprimir Magister. Vuelve a pegar la línea en Terminal."
    return 1
  fi
  rm -rf "$tmp"
  chmod +x "$destino"/*.command "$destino/sistema/magister.sh" 2>/dev/null
  # Por si acaso: quita la cuarentena a lo descargado (curl no la pone, pero no molesta).
  xattr -dr com.apple.quarantine "$destino" 2>/dev/null
  echo "Listo. A partir de ahora, para abrir Magister: doble clic en Magister.command, en la carpeta $destino"
  open "$destino" 2>/dev/null
  # Con «curl | bash» la entrada es el propio script: el arrancador lee del teclado de la Terminal.
  exec bash "$destino/sistema/magister.sh" </dev/tty
}

main "$@"
