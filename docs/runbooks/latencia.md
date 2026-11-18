# Alerta «latencia»

**Qué significa.** En las últimas 24 h, el p95 de lo que tardas en ver la primera palabra del tutor (desde que envías) pasa de 20 s, con al menos 10 respuestas. Mide lo que ves tú: los pasos de Magister antes de llamar al modelo más lo que el modelo piensa antes de escribir.

**Qué mirar primero.** Compara `mensajes.ms_primer_token` (lo que ves) con `llamadas.ttft_ms` de la misma traza (lo que tarda el modelo):

- Si la diferencia es grande, se atasca algo nuestro: la búsqueda (¿e5 cargando tras un reinicio?), el reranker o las lecturas antes del prompt.
- Si casi todo es `ttft_ms`, es el modelo pensando. Mira `tokens_salida` de esas llamadas (miles de tokens = pensó mucho) y si el prompt creció: `uv run python -m magister.observar.informes prefijos --dias 1`.

**Qué hacer.** Lo nuestro: baja `k` de la recuperación o el número de turnos; desactiva el reranker. El modelo: un prompt que pida menos razonamiento, o un modelo más rápido para `conversar` en `config/modelos.yaml` (con cuidado: Haiku bajó la calidad en la llamada).
