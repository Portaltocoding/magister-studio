# ADR-0005. Dos capas nuevas: `flujo` y `plan`

**Estado:** aceptada. **Fecha:** 2026-11-15.

**Decisión.** `magister.plan` es código puro (perfil, reglas, dependencias y calendario): no importa de nadie salvo de sí mismo. `magister.flujo` es el grafo: importa de `cerebro`, `plan`, `datos` y `config`. La API importa de `flujo` y `datos`, no de `cerebro`.

**Por qué.** El calendario y las reglas son algoritmos que se prueban sin modelo ni base; el grafo es el único sitio que decide qué paso toca.
