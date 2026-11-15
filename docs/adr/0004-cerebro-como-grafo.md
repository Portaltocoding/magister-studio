# ADR-0004. El cerebro como grafo de LangGraph con checkpoints en SQLite

**Estado:** aceptada. **Fecha:** 2026-11-15.

**Contexto.** La v0.2 conversa, extrae un perfil, planifica, calendariza y espera tu decisión, que puede llegar en otra petición horas después.

**Decisión.** Un `StateGraph` en `magister/flujo/grafo.py` con un nodo por fichero. Un solo bucle de reintento, el de `estructurar`. La pausa es `interrupt` en `proponer`. El checkpointer es `AsyncSqliteSaver` (`langgraph-checkpoint-sqlite` con `aiosqlite`) en `servidor/checkpoints.sqlite`, fuera de git, abierto una vez en el `lifespan`. Las pruebas y el harness usan `InMemorySaver`.

**Alternativas.** `AsyncPostgresSaver`: necesita psycopg asíncrono, que no funciona con el bucle Proactor que exige `claude -p` en Windows. Una máquina de estados a mano: más código y sin pausas persistentes.

**Consecuencias.** Lo que importa (el plan aceptado) se guarda en Postgres en el nodo `guardar`; el checkpoint es memoria de trabajo. Borrar `checkpoints.sqlite` solo pierde propuestas pendientes.
