# ADR-0014. Observabilidad sin depender de Langfuse

**Estado:** aceptada. **Fecha:** 2026-11-15.

**Decisión.** El cerebro ofrece ganchos (`registrar_observador`) y contexto (`traza_actual`, `prompt_actual`); `magister.observar` se engancha al arrancar la API y guarda cada llamada en `llamadas`, las métricas deterministas en `puntuaciones` y encola el juez online con probabilidad `MAGISTER_JUEZ_MUESTRA`. Langfuse es opcional: si está configurado, recibe las mismas generaciones y puntuaciones. Las alertas se evalúan al arrancar y cada hora.

**Por qué.** Una instalación personal no debería depender de levantar ClickHouse, Redis y MinIO para ver qué pasa; Postgres ya está.
