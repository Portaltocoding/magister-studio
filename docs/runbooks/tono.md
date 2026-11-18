# Alerta «tono»

**Qué significa.** El juez online aprueba menos del 70 % de las explicaciones en 7 días. Solo cuentan las notas puestas con la versión actual de `docs/rubrica.md`: al cambiar la rúbrica, la alerta empieza de cero (y hace falta recalibrar el juez).

**Qué mirar primero.** El panel «Triaje del banco»: las críticas del juez dicen qué dimensión cae.

**Qué hacer.** Corrige el prompt en `cerebro/prompts/experimentos/`, compáralo con `evals.tono.correr --variante` y actívalo si gana; o vuelve atrás con `magister prompts activar`.
