# ADR-0011. La cola de trabajos en Postgres

**Estado:** aceptada. **Fecha:** 2026-11-15.

**Decisión.** Tabla `trabajos` con clave de idempotencia (lección, versión de fuentes, SHA-256 de los prompts, modelo y tipos), `FOR UPDATE SKIP LOCKED`, lease de 120 s con latido cada 30 s, reintentos con espera exponencial (2 s, factor 2, jitter, 5 intentos) para errores transitorios y `fallido` sin reintento para los permanentes. Cada cambio hace `NOTIFY trabajos`; el SSE de progreso escucha con `LISTEN` en una conexión propia de asyncpg y emite el estado actual al conectar.

**Dónde corre.** Por defecto, el trabajador vive dentro del proceso de la API (`MAGISTER_TRABAJOS_EN_API=true`): un proceso menos que arrancar. Con `false`, se lanza aparte con `uv run magister-trabajador`; la cola es la misma.

**Alternativas.** Celery o arq con Redis: otro servicio que mantener sin motivo medido.
