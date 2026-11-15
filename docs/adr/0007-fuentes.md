# ADR-0007. Fuentes en un almacén único, con RAG híbrido

**Estado:** aceptada. **Fecha:** 2026-11-15.

**Contexto y decisión.** Hay que citar, y el corpus (apuntes, libros, vault, web) ni cabe en el contexto ni se está quieto. RAG sobre el mismo Postgres 16 con pgvector: `fuentes`, `documentos`, `versiones` y `fragmentos`, con la procedencia en cada fila y la invariante `version.texto[inicio:fin] == fragmento.texto`. Embeddings locales `intfloat/multilingual-e5-small` (384, prefijos `passage:` y `query:`, normalizados), léxico con `tsvector` en castellano, fusión RRF (k = 60) y un reranker local (`cross-encoder/mmarco-mMiniLMv2-L12-H384-v1`) apagado por defecto. La configuración del índice tiene nombre y no se edita: un cambio es una fila nueva (`v2`) indexada al lado.

**Alternativas.** Contexto largo con caché (no cabe y no cita); cada fuente donde vive (no se mide igual); una base vectorial aparte (sin motivo medido).

**Consecuencias.** Hay que mantener la ingesta al día (`magister reingerir`) y el texto del vault se duplica. Con e5-small, una consulta ajena a las fuentes da una similitud de 0,78 a 0,81 y una relacionada de 0,89 a 0,91 (medido con el corpus de prueba): por debajo de 0,85 el tutor dice que no lo encuentra en tus fuentes.
