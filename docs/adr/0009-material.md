# ADR-0009. El material: el modelo escribe contenido, el código pone el formato

**Estado:** aceptada. **Fecha:** 2026-11-15.

**Decisión.** Los apuntes se generan con un grafo (contrato, comprobar, escribir bloque, lint, juez, refinar, aceptar, montar, completitud, ampliar). El esqueleto del motor de PDF lo monta el código desde `material/plantillas/apuntes.md`; el modelo solo escribe definiciones, títulos y prosa. Toda salida estructurada (contrato, preguntas, diapositivas, veredictos) pasa por `estructurar`. Límites: 3 contratos, 2 refinados por bloque, 1 ronda de ampliación por completitud. El progreso (contrato y bloques aceptados) se guarda en `materiales` y `bloques_material` con asyncpg; el grafo usa `InMemorySaver` y al reanudar carga lo aceptado. Sin pausa para revisar el contrato: corre en segundo plano y el contrato queda visible en el material.

**Reglas de tono.** Las de `docs/tono.md`: raya y Unicode fuera del básico son veto; metatexto, término inglés sin traducir y frases de más de 40 palabras, aviso; condescendencia y prosa en viñetas, sospecha (decide el juez). Tres más solo para guiones: paréntesis largos, siglas sin decir y fórmulas escritas, aviso.

**Consecuencias.** PDF con el motor de las fichas (`material/motor_pdf/`, copia de `libro/_motor`: pandoc, Chrome y pdftotext); diapositivas con Marp (`npx`); guion por escenas con el formato de clase-magna.
