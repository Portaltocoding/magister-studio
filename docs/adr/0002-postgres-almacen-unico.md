# ADR-0002. Postgres 16 con pgvector como almacén único

**Estado:** aceptada. **Fecha:** 2026-11-15.

**Contexto.** Magister guarda conversaciones (v0.1), planes (v0.2), fragmentos con embeddings (v0.3), material (v0.4) y el historial de repasos (v0.5). Es una instalación por persona.

**Decisión.** Un solo Postgres 16 con la extensión `vector`, en Docker (`pgvector/pgvector:pg16`), con volumen con nombre `magister-studio-datos` y puerto `127.0.0.1:5433` (el 5432 queda libre para el repo `magister`). Ids `bigint` y `ON DELETE CASCADE` en `mensajes`, `SET NULL` en `conversaciones.tema_id`. Driver `asyncpg`: con el bucle Proactor de Windows, psycopg asíncrono no funciona.

**Alternativas.** SQLite: sin servidor, pero sin pgvector ni texto completo en castellano. Un almacén vectorial aparte (Qdrant, Chroma): dos sistemas que mantener sincronizados. UUID: innecesario con un solo usuario.

**Consecuencias.** Una sola copia de seguridad (`pg_dump`). La imagen ya trae `vector`, así que la Parte III no cambia de imagen. Las bases `magister_pruebas` y `magister_sim` se crean en el primer arranque (`servidor/scripts/crear_bases.sql`).
