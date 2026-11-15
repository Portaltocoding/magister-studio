# ADR-0008. El research: flujo fijo por defecto, agente como alternativa medida

**Estado:** aceptada. **Fecha:** 2026-11-15.

**Contexto.** Una lección sin material necesita fuentes de la web, que es contenido no confiable.

**Decisión.** Tres herramientas con efectos mínimos (`buscar_web` con ddgs, `leer_pagina` solo de URLs devueltas por la búsqueda, con 15 s y 2 MB, y `proponer_fuente`, que solo apunta). Nada se ingiere sin tu aprobación, y lo aprobado pasa por la ingesta entera. Las lecturas van delimitadas como `<pagina_no_confiable>`. El sistema por defecto es el flujo fijo (3 consultas, 10 lecturas, puntuación de 0 a 3); el agente (bucle decidir y ejecutar con 12 pasos, 8 llamadas, 5 propuestas, 180 s y cortacircuitos) se elige con `"sistema": "agente"`.

**Por qué.** El libro pide quedarse con el agente solo si supera al flujo fijo en pass^3 sin triplicar el coste. Los números están en `servidor/evals/RESULTADOS-research.md`.

**Medido (2026-11-15, banco de 8 tareas con web falsa, una repetición, Claude Haiku).** Flujo fijo: éxito 75 %, 2 llamadas y 8,2 s por tarea. Agente: éxito 100 %, 8 llamadas y 25,2 s por tarea. Ninguno propuso la página trampa. El agente gana en éxito pero cuesta cuatro veces más llamadas: por la regla del triple, se queda el flujo fijo. Falta repetir con `--repeticiones 3` para tener pass^3 de verdad.
