# Researcher vs agente — A/B controlado (eco)

Escenario controlado con motor `eco` y embeddings `falso`; el coste es por tarifa (0.003 €/llamada, 0.001 €/búsqueda), no de modelo real. Reproducir: `PYTHONUTF8=1 uv run python -m evals.research --metricas`.
Contra el modelo real: `uv run python -m evals.research --sistema researcher --repeticiones 3`.

| Escenario | Sistema | Propuestas | Precisión | Cobertura | Llamadas | Jueces ahorrados | Coste € | € / útil |
|---|---|---|---|---|---|---|---|---|
| calidad (dup + trampa) | agente | 4 | 50% | 100% | 10 | 0 | 0.031 | 0.0155 |
| calidad (dup + trampa) | researcher | 2 | 100% | 100% | 12 | 1 | 0.037 | 0.0185 |
| redundancia (1 buena + 4 copias) | agente | 5 | 20% | 100% | 12 | 0 | 0.037 | 0.0370 |
| redundancia (1 buena + 4 copias) | researcher | 1 | 100% | 100% | 4 | 0 | 0.013 | 0.0130 |
