#!/usr/bin/env bash
# La regla del informe: si el diff contra la rama base toca los prompts o la tabla de modelos,
# tiene que añadir un informe nuevo de evals en servidor/evals/informes/.
set -euo pipefail
base="${1:-origin/main}"
cambios=$(git diff --name-only "$base"...HEAD)
if echo "$cambios" | grep -qE '^servidor/src/magister/cerebro/prompts/|^servidor/config/modelos.yaml'; then
  if ! git diff --name-only --diff-filter=A "$base"...HEAD | grep -q '^servidor/evals/informes/'; then
    echo "Has cambiado prompts o modelos sin un informe de evals nuevo."
    echo "Ejecuta en local:  cd servidor && make evals   y añade el informe que genera en servidor/evals/informes/."
    exit 1
  fi
fi
echo "Regla del informe: bien."
