# ADR-0006. Cómo guardar el plan y el calendario

**Estado:** aceptada. **Fecha:** 2026-11-15.

**Decisión.** `planes` (versión, estado `propuesto | aceptado | sustituido` con índice único parcial por tema para `aceptado`, perfil en `jsonb` como foto, versión de prompt y modelo), `lecciones` (clave primaria `(plan_id, clave)`, `objetivos text[]`, horas, orden), `conceptos` (clave primaria `(plan_id, id)`, `leccion_clave`), `dependencias` (pares, sin autodependencia) y `sesiones` (fecha, inicio, horas, estado `pendiente | hecha | saltada`). Replanificar crea un plan nuevo y marca el anterior `sustituido`, en una transacción. Recalcular tras un atraso regenera solo las sesiones pendientes.

**Consecuencias.** Las preguntas y los intentos de las Partes IV y V apuntan a `(plan_id, concepto_id)`: al replanificar, lo viejo sigue apuntando a su plan.
