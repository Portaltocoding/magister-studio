#!/usr/bin/env bash
# Magister Studio en Mac: doble clic aquí. Todo lo hace magister.sh (el mismo arrancador que en Linux): en el paquete
# Magister-Mac.zip está en sistema/; en el repo, al lado de este fichero.
AQUI="$(dirname "$0")"
if [ -f "$AQUI/sistema/magister.sh" ]; then
  exec bash "$AQUI/sistema/magister.sh" "$@"
fi
exec bash "$AQUI/magister.sh" "$@"
