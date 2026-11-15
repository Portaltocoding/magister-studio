# Afinar un modelo para el tono (laboratorio de la Parte VI)

Fuera del producto: nada de aquí lo usa el tutor hasta que la comparación lo justifique.

| Paso | Orden |
|---|---|
| Contar los parámetros de un modelo | `python afinar/contar.py config.json` (el `config.json` de Qwen2.5-3B-Instruct en Hugging Face) |
| Tokens de tus textos | `python afinar/ollama.py tokens a.txt b.txt c.txt` (con Ollama y `ollama pull qwen2.5:3b`) |
| Temperatura y semilla | `python afinar/ollama.py decodificar "¿Qué es una clave primaria?"` |
| Exportar los datos | `cd servidor && uv run python -m evals.exportar_afinado --salida ../afinar/datos/` |
| Ajustar en Colab | Sube `datos/` a tu Drive y abre `ajuste_qlora.ipynb` en Colab (GPU T4) |
| Llevarlo a Ollama | Copia el GGUF aquí y `ollama create magister-tono -f afinar/Modelfile` |

La comparación honesta (el sistema actual frente a Qwen 3B con tu mejor prompt y frente al afinado) se hace con el harness de tono: `MAGISTER_MODELO_GENERAR=ollama:magister-tono uv run python -m evals.tono.correr`, cuando exista el motor `ollama` (pendiente: ver `docs/decisiones.md`).

`datos/` está fuera de git: son tus apuntes.
