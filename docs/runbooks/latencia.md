# Alerta «latencia»

**Qué significa.** El p95 del primer trozo de las conversaciones pasa de 15 s.

**Qué mirar primero.** `uv run python -m magister.observar.informes prefijos --dias 1`: ¿algún prompt de más de 20.000 tokens?

**Qué hacer.** Baja `k` de la recuperación o el número de turnos; desactiva el reranker; usa un modelo más rápido para `conversar` en `config/modelos.yaml`.
